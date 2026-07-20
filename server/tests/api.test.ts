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
  });

  it('rejects economy calls without authentication', async () => {
    await request(app).post('/api/economy/recruit').send({}).expect(401);
  });

  it('exposes health without leaking secrets', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toEqual({
      status: 'ok', service: 'neural-evolution-game-server', version: '1.1.0', channel: 'alpha', storage: 'memory',
    });
    expect(health.headers['x-request-id']).toBeTypeOf('string');
    await request(app).get('/ready').expect(200, { status: 'ready', version: '1.1.0', channel: 'alpha' });
    const release = await request(app).get('/api/release').expect(200);
    expect(release.body).toMatchObject({
      version: '1.1.0', channel: 'alpha', commit: 'abcdef0', commerceAvailable: false,
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
