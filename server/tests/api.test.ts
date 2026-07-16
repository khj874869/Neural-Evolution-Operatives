import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStandaloneHttpApp } from '../src/api/createHttpApp.js';
import { TokenService } from '../src/auth/TokenService.js';
import type { ServerConfig } from '../src/config/env.js';
import { EconomyService } from '../src/economy/EconomyService.js';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';

const config: ServerConfig = {
  host: '127.0.0.1', port: 2567, corsOrigin: 'http://localhost:5173',
  jwtSecret: 'test-secret-that-is-long-enough-for-tests', nodeEnv: 'test',
};

describe('game account API', () => {
  let app: ReturnType<typeof createStandaloneHttpApp>;

  beforeEach(async () => {
    const repository = new InMemoryPlayerRepository();
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
    expect(health.body).toEqual({ status: 'ok', service: 'neural-evolution-game-server', storage: 'memory' });
  });
});
