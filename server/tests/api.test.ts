import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandaloneHttpApp } from '../src/api/createHttpApp.js';
import { TokenService } from '../src/auth/TokenService.js';
import type { ServerConfig } from '../src/config/env.js';
import { EconomyService } from '../src/economy/EconomyService.js';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';

const config: ServerConfig = {
  host: '127.0.0.1', port: 2567, corsOrigin: 'http://localhost:5173',
  jwtSecret: 'test-secret-that-is-long-enough-for-tests', nodeEnv: 'test',
  releaseChannel: 'alpha', commitSha: 'abcdef0',
  aiModel: 'gpt-5.6-terra', aiDailyTurnLimit: 12, aiTimeoutMs: 8_000, aiModerationEnabled: true,
};

describe('game account API', () => {
  let app: ReturnType<typeof createStandaloneHttpApp>;
  let repository: InMemoryPlayerRepository;

  beforeEach(async () => {
    repository = new InMemoryPlayerRepository();
    await repository.initialize();
    const tokens = new TokenService(config.jwtSecret);
    app = createStandaloneHttpApp({ config, repository, tokens, economy: new EconomyService(repository, () => 0.5) });
  });

  it('creates a guest account and reads it through bearer authentication', async () => {
    const auth = await request(app).post('/api/auth/guest').send({ deviceId: 'web:test-device-0001' }).expect(200);
    expect(auth.body.token).toBeTypeOf('string');
    const profile = await request(app).get('/api/profile').set('authorization', `Bearer ${auth.body.token}`).expect(200);
    expect(profile.body.profile.deviceId).toBe('web:test-device-0001');
    expect(profile.body.profile.campaign).toEqual({ completedOperations: [] });
    expect(profile.body.profile.gear).toEqual({ owned: [], equipped: [] });
    expect(profile.body.profile.ai).toMatchObject({ consentedAt: null, dailyTurnsUsed: 0, lastExchange: null });
  });

  it('rejects economy calls without authentication', async () => {
    await request(app).post('/api/economy/recruit').send({}).expect(401);
  });

  it('exposes health without leaking secrets', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toEqual({
      status: 'ok', service: 'neural-evolution-game-server', version: '1.2.0', channel: 'alpha', storage: 'memory',
    });
    expect(health.headers['x-request-id']).toBeTypeOf('string');
    await request(app).get('/ready').expect(200, { status: 'ready', version: '1.2.0', channel: 'alpha' });
    const release = await request(app).get('/api/release').expect(200);
    expect(release.body).toMatchObject({
      version: '1.2.0', channel: 'alpha', commit: 'abcdef0',
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
    await request(app).post('/api/analytics/events')
      .set('authorization', `Bearer ${auth.body.token}`)
      .send({ event: 'store_view', properties: { source: 'command_dock' } })
      .expect(202);
    expect(repository.analytics).toContainEqual(expect.objectContaining({ event: 'store_view' }));
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
