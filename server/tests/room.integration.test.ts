import { Client } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import type { ServerConfig } from '../src/config/env.js';
import { createGameServer } from '../src/createServer.js';

const port = 28991;
const endpoint = `http://127.0.0.1:${port}`;
let server: Server;

describe('real game room transport', () => {
  beforeAll(async () => {
    const config: ServerConfig = {
      host: '127.0.0.1', port, corsOrigin: 'http://localhost:5173',
      jwtSecret: 'integration-secret-that-is-long-enough', nodeEnv: 'test',
      releaseChannel: 'alpha', commitSha: 'abcdef0',
      aiModel: 'gpt-5.6-terra', aiDailyTurnLimit: 12, aiTimeoutMs: 8_000, aiModerationEnabled: true,
    };
    server = createGameServer(config).gameServer;
    await server.listen(port, '127.0.0.1');
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('authenticates, joins a room, sends input and receives synchronized state', async () => {
    const authResponse = await fetch(`${endpoint}/api/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'integration:room-client-0001' }),
    });
    expect(authResponse.ok).toBe(true);
    const auth = await authResponse.json() as { token: string };
    const client = new Client(endpoint);
    const room = await client.joinOrCreate('red_zone', { token: auth.token });
    room.onMessage('server-event', () => undefined);
    const snapshot = await new Promise<{ players: number; enemies: number }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('state timeout')), 4_000);
      room.onStateChange((state: { players: Map<string, unknown>; enemies: Map<string, unknown> }) => {
        if (!state.players?.size || !state.enemies?.size) return;
        clearTimeout(timeout);
        resolve({ players: state.players.size, enemies: state.enemies.size });
      });
      room.send('input', { sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: true, extract: false, weapon: 'carbine' });
    });
    expect(snapshot.players).toBe(1);
    expect(snapshot.enemies).toBeGreaterThan(0);
    const sessionId = room.sessionId;
    room.reconnection.minUptime = 0;
    room.reconnection.delay = 10;
    room.reconnection.minDelay = 10;
    room.reconnection.maxDelay = 20;
    room.reconnection.maxRetries = 3;
    const reconnected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('reconnection timeout')), 4_000);
      room.onReconnect.once(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    void room.leave(false);
    await reconnected;
    expect(room.sessionId).toBe(sessionId);
    room.send('input', {
      sequence: 2, moveX: 0, moveY: 1, aimAngle: 1, fire: false, extract: false, weapon: 'carbine',
    });
    await room.leave();
  });
});
