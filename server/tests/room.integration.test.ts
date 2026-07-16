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
    await room.leave();
  });
});
