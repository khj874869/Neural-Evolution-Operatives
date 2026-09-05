import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandaloneHttpApp } from '../src/api/createHttpApp.js';
import { TokenService } from '../src/auth/TokenService.js';
import type { ServerConfig } from '../src/config/env.js';
import { EconomyService } from '../src/economy/EconomyService.js';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';

const config: ServerConfig = {
  host: '127.0.0.1', port: 2567, corsOrigin: 'http://localhost:5173',
  trustProxyHops: 1,
  jwtSecret: 'test-secret-that-is-long-enough-for-tests', nodeEnv: 'test',
  releaseChannel: 'alpha', commitSha: 'abcdef0',
  aiModel: 'gpt-5.6-terra', aiDailyTurnLimit: 12, aiTimeoutMs: 8_000, aiModerationEnabled: true,
  opsAdminToken: 'test-ops-token-that-is-at-least-32-characters',
};

describe('game account API', () => {
  let app: ReturnType<typeof createStandaloneHttpApp>;
  let repository: InMemoryPlayerRepository;
  let economy: EconomyService;

  beforeEach(async () => {
    repository = new InMemoryPlayerRepository();
    await repository.initialize();
    const tokens = new TokenService(config.jwtSecret);
    economy = new EconomyService(repository, () => 0.5, () => new Date('2026-07-21T00:00:00.000Z'));
    app = createStandaloneHttpApp({ config, repository, tokens, economy });
  });

  it('creates a guest account and reads it through bearer authentication', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:test-device-0001' }).expect(200);
    expect(auth.body.token).toBeTypeOf('string');
    const profile = await request(app).get('/api/profile').set('authorization', `Bearer ${auth.body.token}`).expect(200);
    expect(profile.body.profile.deviceId).toBe('web:test-device-0001');
    expect(profile.body.profile.campaign).toEqual({ completedOperations: [] });
    expect(profile.body.profile.gear).toEqual({ owned: [], equipped: [] });
    expect(profile.body.profile.ai).toMatchObject({ consentedAt: null, dailyTurnsUsed: 0, lastExchange: null });
    expect(profile.body.profile.contracts.daily).toHaveLength(3);
    expect(profile.body.profile.contracts.weekly).toHaveLength(2);
  });

  it('rejects economy calls without authentication', async () => {
    await request(app).post('/api/economy/recruit').send({}).expect(401);
  });

  it('exposes health without leaking secrets', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toEqual({
      status: 'ok', service: 'neural-evolution-game-server', version: '1.4.0', channel: 'alpha', storage: 'memory',
    });
    expect(health.headers['x-request-id']).toBeTypeOf('string');
    await request(app).get('/ready').expect(200, { status: 'ready', version: '1.4.0', channel: 'alpha' });
    const release = await request(app).get('/api/release').expect(200);
    expect(release.body).toMatchObject({
      version: '1.4.0', channel: 'alpha', commit: 'abcdef0',
      commerceAvailable: false, aiAvailable: false, aiDailyTurnLimit: 12,
    });
    expect(new Date(release.body.serverTime).getTime()).not.toBeNaN();
    vi.spyOn(repository, 'healthCheck').mockRejectedValueOnce(new Error('storage unavailable'));
    const unavailable = await request(app).get('/ready').expect(503);
    expect(unavailable.body).toMatchObject({ status: 'unavailable', requestId: expect.any(String) });
  });

  it('validates and saves an authenticated squad formation', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:squad-device-0001' }).expect(200);
    const response = await request(app).post('/api/profile/squad')
      .set('authorization', `Bearer ${auth.body.token}`)
      .set('idempotency-key', 'squad:api:0001')
      .send({ squad: ['lumen', 'aegis-07', 'ratchet'] })
      .expect(200);
    expect(response.body.profile.squad).toEqual(['lumen', 'aegis-07', 'ratchet']);
  });

  it('serves and claims server-authoritative survival contracts', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:contract-device-01' }).expect(200);
    const authorization = `Bearer ${auth.body.token}`;
    const initial = await request(app).get('/api/contracts').set('authorization', authorization).expect(200);
    expect(initial.body.board.daily).toHaveLength(3);
    expect(initial.body.board.weekly).toHaveLength(2);
    await request(app).post(`/api/contracts/${initial.body.board.daily[0].id}/claim`)
      .set('authorization', authorization)
      .expect(409, { error: 'CONTRACT_NOT_COMPLETE' });

    for (let extraction = 1; extraction <= 5; extraction += 1) {
      await economy.grantExtraction(
        auth.body.profile.playerId,
        { scrap: 60, water: 0, data: 12, cores: 0 },
        `api-contract-room:${extraction}`,
        { kills: 25, operationComplete: true },
      );
    }
    const completed = await request(app).get('/api/contracts').set('authorization', authorization).expect(200);
    const contractId = completed.body.board.daily[0].id;
    const claimed = await request(app).post(`/api/contracts/${contractId}/claim`)
      .set('authorization', authorization)
      .set('idempotency-key', 'contract:api:claim:0001')
      .expect(200);
    expect(claimed.body.board.daily.find((contract: { id: string }) => contract.id === contractId).claimed).toBe(true);
    expect(claimed.body.profile.contracts.streak).toBe(1);
  });

  it('crafts and equips tactical gear through authenticated APIs', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:gear-device-0001' }).expect(200);
    const authorization = `Bearer ${auth.body.token}`;
    const crafted = await request(app).post('/api/economy/gear/craft')
      .set('authorization', authorization)
      .set('idempotency-key', 'gear:api:craft:0001')
      .send({ gearId: 'sealed-filter' })
      .expect(200);
    expect(crafted.body.profile.gear).toEqual({ owned: ['sealed-filter'], equipped: ['sealed-filter'] });
    const unequipped = await request(app).post('/api/profile/gear')
      .set('authorization', authorization)
      .set('idempotency-key', 'gear:api:equip:0001')
      .send({ equipped: [] })
      .expect(200);
    expect(unequipped.body.profile.gear.equipped).toEqual([]);
    await request(app).post('/api/profile/gear')
      .set('authorization', authorization)
      .send({ equipped: ['coil-governor'] })
      .expect(409, { error: 'GEAR_NOT_OWNED' });
  });

  it('publishes a transparent store catalog and records funnel events', async () => {
    const catalog = await request(app).get('/api/store/catalog').expect(200);
    expect(catalog.body.products).toHaveLength(3);
    expect(catalog.body.recruitOdds).toEqual({ SSR: 0.04, SR: 0.24, R: 0.72, pityAt: 20 });
    expect(catalog.body.checkoutAvailable).toBe(false);

    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:analytics-device-01' }).expect(200);
    const authorization = `Bearer ${auth.body.token}`;
    await request(app).post('/api/analytics/events')
      .set('authorization', authorization)
      .send({ event: 'store_view', properties: { source: 'before_consent' } })
      .expect(403, { error: 'ANALYTICS_CONSENT_REQUIRED' });
    await request(app).put('/api/profile/analytics-consent')
      .set('authorization', authorization)
      .set('idempotency-key', 'analytics:consent:0001')
      .send({ consent: true })
      .expect(200);
    await request(app).post('/api/analytics/events')
      .set('authorization', authorization)
      .send({ event: 'store_view', properties: { source: 'command_dock' } })
      .expect(202);
    expect(repository.analytics).toContainEqual(expect.objectContaining({ event: 'store_view' }));
  });

  it('rate limits guest account authentication by client address', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app).post('/api/auth/guest')
        .send({ deviceId: `web:rate-limit-${String(attempt).padStart(4, '0')}` })
        .expect(200);
    }
    const limited = await request(app).post('/api/auth/guest')
      .send({ deviceId: 'web:rate-limit-blocked' })
      .expect(429);
    expect(limited.body).toMatchObject({ error: 'RATE_LIMITED', requestId: expect.any(String) });
    expect(limited.headers['retry-after']).toBeTypeOf('string');
    await request(app).post('/api/auth/guest')
      .set('x-forwarded-for', '203.0.113.42')
      .send({ deviceId: 'web:rate-limit-different-client' })
      .expect(200);
  });

  it('accepts explicit alpha feedback idempotently and protects the operations console', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:feedback-device-01' }).expect(200);
    const authorization = `Bearer ${auth.body.token}`;
    await request(app).post('/api/alpha/feedback').send({
      category: 'controls', rating: 5, message: '인증 없는 피드백', diagnostics: {},
    }).expect(401);
    await request(app).post('/api/alpha/feedback')
      .set('authorization', authorization)
      .send({ category: 'controls', rating: 9, message: '범위 밖 평가', diagnostics: {} })
      .expect(400);

    const payload = {
      category: 'performance',
      rating: 3,
      message: '전투 후반부 프레임 저하가 보입니다.',
      diagnostics: { appVersion: '1.4.0', platform: 'android', fps: 31 },
    };
    const created = await request(app).post('/api/alpha/feedback')
      .set('authorization', authorization)
      .set('idempotency-key', 'feedback:api:0001')
      .send(payload)
      .expect(201);
    expect(created.body).toMatchObject({ accepted: true, replayed: false, submittedAt: expect.any(String) });
    const replayed = await request(app).post('/api/alpha/feedback')
      .set('authorization', authorization)
      .set('idempotency-key', 'feedback:api:0001')
      .send(payload)
      .expect(200);
    expect(replayed.body).toMatchObject({ accepted: true, replayed: true, submittedAt: created.body.submittedAt });

    const consolePage = await request(app).get('/ops').expect(200);
    expect(consolePage.text).toContain('Operations Console');
    expect(consolePage.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await request(app).get('/api/ops/alpha?days=7').expect(401, { error: 'OPS_AUTH_REQUIRED' });
    await request(app).get('/api/ops/alpha?days=7').set('x-ops-token', 'wrong-token').expect(401);
    const snapshot = await request(app).get('/api/ops/alpha?days=7')
      .set('x-ops-token', config.opsAdminToken!)
      .expect(200);
    expect(snapshot.body).toMatchObject({
      windowDays: 7,
      dataMode: 'consented-alpha-telemetry',
      feedback: { total: 1, averageRating: 3 },
    });
    expect(JSON.stringify(snapshot.body)).not.toContain(auth.body.profile.playerId);
  });

  it('does not expose the operations surface when its secret is not configured', async () => {
    const disabledConfig = { ...config, opsAdminToken: undefined };
    const disabledRepository = new InMemoryPlayerRepository();
    const disabledTokens = new TokenService(disabledConfig.jwtSecret);
    const disabledApp = createStandaloneHttpApp({
      config: disabledConfig,
      repository: disabledRepository,
      tokens: disabledTokens,
      economy: new EconomyService(disabledRepository),
    });
    await request(disabledApp).get('/ops').expect(404);
    await request(disabledApp).get('/api/ops/alpha?days=7').expect(404, { error: 'NOT_FOUND' });
  });

  it('never grants a purchase while platform receipt verification is not configured', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:purchase-device-01' }).expect(200);
    await request(app).post('/api/store/verify')
      .set('authorization', `Bearer ${auth.body.token}`)
      .send({ platform: 'google', productId: 'core_cache_s', receipt: 'unverified-receipt' })
      .expect(503, { error: 'PLATFORM_BILLING_NOT_CONFIGURED' });
  });

  it('provides consent-controlled persona chat and deletable long-term memories', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:persona-device-0001' }).expect(200);
    const authorization = `Bearer ${auth.body.token}`;
    const local = await request(app).post('/api/persona/chat')
      .set('authorization', authorization)
      .set('idempotency-key', 'persona:chat:0001')
      .send({ operatorId: 'aegis-07', message: '첫 작전 기억나?', useExternalAi: false })
      .expect(200);
    expect(local.body.exchange).toMatchObject({ operatorId: 'aegis-07', source: 'rules' });
    expect(local.body.profile.operators[0].memories[0]).toContain('첫 작전');

    const consented = await request(app).put('/api/profile/ai-consent')
      .set('authorization', authorization)
      .set('idempotency-key', 'persona:consent:01')
      .send({ consent: true })
      .expect(200);
    expect(consented.body.profile.ai.consentedAt).toBeTypeOf('string');

    const cleared = await request(app).delete('/api/persona/aegis-07/memories')
      .set('authorization', authorization)
      .set('idempotency-key', 'persona:memory:01')
      .expect(200);
    expect(cleared.body.profile.operators[0].memories).toEqual([]);
    await request(app).post('/api/persona/chat')
      .set('authorization', authorization)
      .send({ operatorId: 'morrow', message: '보유하지 않은 링크', useExternalAi: false })
      .expect(409, { error: 'OPERATOR_NOT_OWNED' });
  });

  it('exports account data and deletes the authenticated guest profile', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:privacy-device-001' }).expect(200);
    const authorization = `Bearer ${auth.body.token}`;
    const exported = await request(app).get('/api/account/export').set('authorization', authorization).expect(200);
    expect(exported.body.profile.playerId).toBe(auth.body.profile.playerId);
    expect(exported.body.dataUse.ai).toContain('기기');
    await request(app).delete('/api/account').set('authorization', authorization)
      .send({ confirmation: 'WRONG' }).expect(400);
    await request(app).delete('/api/account').set('authorization', authorization)
      .send({ confirmation: 'DELETE' }).expect(200, { deleted: true });
    await request(app).get('/api/profile').set('authorization', authorization).expect(404);
  });
});
