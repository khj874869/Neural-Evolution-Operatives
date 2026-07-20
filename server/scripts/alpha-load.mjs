import { Client } from '@colyseus/sdk';

const endpoint = (process.argv[2] ?? 'http://localhost:2567').replace(/\/$/, '');
const clientCount = boundedNumber(process.argv[3], 8, 1, 32);
const durationMs = boundedNumber(process.argv[4], 5_000, 1_000, 60_000);

const readiness = await fetch(`${endpoint}/ready`);
if (!readiness.ok) throw new Error(`Server is not ready: ${readiness.status}`);

const startedAt = performance.now();
const results = await Promise.allSettled(
  Array.from({ length: clientCount }, (_value, index) => runClient(index)),
);
const successes = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
const failures = results.filter((result) => result.status === 'rejected');
const joinTimes = successes.map((result) => result.joinMs).sort((a, b) => a - b);

console.log(JSON.stringify({
  status: failures.length ? 'failed' : 'ok',
  endpoint,
  requestedClients: clientCount,
  connectedClients: successes.length,
  durationMs: Math.round(performance.now() - startedAt),
  stateSnapshots: successes.reduce((sum, result) => sum + result.snapshots, 0),
  joinP95Ms: percentile(joinTimes, 0.95),
  failures: failures.map((result) => String(result.reason instanceof Error ? result.reason.message : result.reason)).slice(0, 5),
}));

if (failures.length) process.exitCode = 1;

async function runClient(index) {
  const authStartedAt = performance.now();
  const authResponse = await fetch(`${endpoint}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: `alpha:${index}:${crypto.randomUUID()}` }),
  });
  if (!authResponse.ok) throw new Error(`client ${index} auth ${authResponse.status}`);
  const auth = await authResponse.json();
  const room = await new Client(endpoint).joinOrCreate('red_zone', { token: auth.token });
  const joinMs = performance.now() - authStartedAt;
  let snapshots = 0;
  let sequence = 0;
  room.onStateChange(() => { snapshots += 1; });
  const inputTimer = setInterval(() => {
    sequence += 1;
    const angle = sequence * 0.17 + index;
    room.send('input', {
      sequence,
      moveX: Math.cos(angle),
      moveY: Math.sin(angle),
      aimAngle: angle,
      fire: sequence % 2 === 0,
      extract: false,
      weapon: ['carbine', 'scatter', 'rail'][sequence % 3],
      dash: sequence % 17 === 0,
    });
  }, 100);
  try {
    await delay(durationMs);
    if (!snapshots) throw new Error(`client ${index} received no state`);
    return { joinMs, snapshots };
  } finally {
    clearInterval(inputTimer);
    await room.leave().catch(() => undefined);
  }
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  return Math.round(values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)]);
}

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
