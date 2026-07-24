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
const contractsResponse = await fetch(`${endpoint}/api/contracts`, {
  headers: { authorization: `Bearer ${auth.token}` },
});
if (!contractsResponse.ok) throw new Error(`Contract board failed: ${contractsResponse.status}`);
const contracts = await contractsResponse.json();
if (contracts.board?.daily?.length !== 3 || contracts.board?.weekly?.length !== 2) {
  throw new Error('Contract rotation did not return three daily and two weekly objectives');
}
const personaResponse = await fetch(`${endpoint}/api/persona/chat`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${auth.token}`,
    'content-type': 'application/json',
    'idempotency-key': `smoke-talk:${deviceId}`,
  },
  body: JSON.stringify({
    operatorId: 'aegis-07',
    message: '작전 준비 상태를 보고해 줘.',
    useExternalAi: false,
  }),
});
if (!personaResponse.ok) throw new Error(`Persona chat failed: ${personaResponse.status}`);
const persona = await personaResponse.json();
if (persona.exchange?.source !== 'rules' || !persona.profile?.operators?.[0]?.memories?.length) {
  throw new Error('Persona fallback or authoritative memory persistence failed');
}
const craftResponse = await fetch(`${endpoint}/api/economy/gear/craft`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${auth.token}`,
    'content-type': 'application/json',
    'idempotency-key': `smoke-craft:${deviceId}`,
  },
  body: JSON.stringify({ gearId: 'sealed-filter' }),
});
if (!craftResponse.ok) throw new Error(`Gear craft failed: ${craftResponse.status}`);
const crafted = await craftResponse.json();
if (!crafted.profile?.gear?.owned?.includes('sealed-filter')) {
  throw new Error('Crafted gear missing from authoritative profile');
}
const client = new Client(endpoint);
const room = await client.joinOrCreate('red_zone', { token: auth.token });
room.onMessage('server-event', () => undefined);

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

const sessionId = room.sessionId;
room.reconnection.minUptime = 0;
room.reconnection.delay = 10;
room.reconnection.minDelay = 10;
room.reconnection.maxDelay = 20;
room.reconnection.maxRetries = 3;
const restored = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Session reconnection timeout')), 5_000);
  room.onReconnect.once(() => {
    clearTimeout(timeout);
    resolve(room.sessionId === sessionId);
  });
});
void room.leave(false);
if (!await restored) throw new Error('Session id changed after reconnection');

console.log(JSON.stringify({
  status: 'ok', roomId: room.roomId, sessionRestored: true,
  personaSource: persona.exchange.source,
  personaMemorySaved: true,
  contracts: `${contracts.board.daily.length}/${contracts.board.weekly.length}`,
  equippedGear: crafted.profile.gear.equipped, ...snapshot,
}));
await room.leave();
