import { Client } from '@colyseus/sdk';

const endpoint = process.argv[2] ?? 'http://localhost:2567';
const deviceId = `smoke:${crypto.randomUUID()}`;
const authResponse = await fetch(`${endpoint}/api/auth/guest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ deviceId }),
});
if (!authResponse.ok) throw new Error(`Guest auth failed: ${authResponse.status}`);
const auth = await authResponse.json();
const client = new Client(endpoint);
const room = await client.joinOrCreate('red_zone', { token: auth.token });

const snapshot = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('State synchronization timeout')), 5_000);
  room.onStateChange((state) => {
    const own = state.players?.get(room.sessionId);
    if (!own || state.enemies?.size < 1 || own.dashCooldownMs <= 0) return;
    clearTimeout(timeout);
    resolve({
      players: state.players.size, enemies: state.enemies.size, resources: state.resources.size,
      dashCooldownMs: own.dashCooldownMs,
    });
  });
  room.send('input', {
    sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: true, extract: false, weapon: 'carbine', dash: true,
  });
});

console.log(JSON.stringify({ status: 'ok', roomId: room.roomId, ...snapshot }));
await room.leave();
