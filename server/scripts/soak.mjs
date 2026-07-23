import { Client } from '@colyseus/sdk';

const endpoint = (process.argv[2] ?? 'http://localhost:2567').replace(/\/$/, '');
const clientCount = boundedNumber(process.argv[3], 16, 1, 128);
const durationMs = boundedNumber(process.argv[4], 120_000, 5_000, 3_600_000);
const readiness = await fetch(`${endpoint}/ready`);
if (!readiness.ok) throw new Error(`Server is not ready: ${readiness.status}`);

let readyFailures = 0;
const readyTimer = setInterval(() => {
  void fetch(`${endpoint}/ready`).then((response) => {
    if (!response.ok) readyFailures += 1;
  }).catch(() => { readyFailures += 1; });
}, 5_000);

const startedAt = performance.now();
const results = await Promise.allSettled(
  Array.from({ length: clientCount }, (_value, index) => runClient(index)),
);
clearInterval(readyTimer);

const successes = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
const failures = results.filter((result) => result.status === 'rejected');
const joinTimes = successes.map((result) => result.joinMs).sort((a, b) => a - b);
const snapshotGaps = successes.map((result) => result.maxSnapshotGapMs).sort((a, b) => a - b);
const unexpectedDisconnects = successes.reduce((sum, result) => sum + result.unexpectedDisconnects, 0);
const status = failures.length || readyFailures || unexpectedDisconnects ? 'failed' : 'ok';

console.log(JSON.stringify({
  status,
  endpoint,
  requestedClients: clientCount,
  connectedClients: successes.length,
  durationMs: Math.round(performance.now() - startedAt),
  stateSnapshots: successes.reduce((sum, result) => sum + result.snapshots, 0),
  joinP95Ms: percentile(joinTimes, 0.95),
  snapshotGapP95Ms: percentile(snapshotGaps, 0.95),
  reconnects: successes.reduce((sum, result) => sum + result.reconnects, 0),
  unexpectedDisconnects,
  readyFailures,
  failures: failures.map((result) => String(result.reason instanceof Error ? result.reason.message : result.reason)).slice(0, 8),
}));

if (status !== 'ok') process.exitCode = 1;

async function runClient(index) {
  const authStartedAt = performance.now();
  const authResponse = await fetch(`${endpoint}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: `soak:${index}:${crypto.randomUUID()}` }),
  });
  if (!authResponse.ok) throw new Error(`client ${index} auth ${authResponse.status}`);
  const auth = await authResponse.json();
  const room = await new Client(endpoint).joinOrCreate('red_zone', { token: auth.token });
  room.onMessage('server-event', () => undefined);
  room.reconnection.minUptime = 0;
  const joinMs = performance.now() - authStartedAt;
  let snapshots = 0;
  let sequence = 0;
  let reconnects = 0;
  let unexpectedDisconnects = 0;
  let lastSnapshotAt = performance.now();
  let maxSnapshotGapMs = 0;
  let finished = false;
  room.onStateChange(() => {
    const now = performance.now();
    if (snapshots > 0) maxSnapshotGapMs = Math.max(maxSnapshotGapMs, now - lastSnapshotAt);
    lastSnapshotAt = now;
    snapshots += 1;
  });
  room.onReconnect(() => { reconnects += 1; });
  room.onLeave(() => { if (!finished) unexpectedDisconnects += 1; });
  const inputTimer = setInterval(() => {
    sequence += 1;
    const angle = sequence * 0.13 + index;
    room.send('input', {
      sequence,
      moveX: Math.cos(angle),
      moveY: Math.sin(angle),
      aimAngle: angle,
      fire: sequence % 2 === 0,
      extract: false,
      weapon: ['carbine', 'scatter', 'rail'][sequence % 3],
      dash: sequence % 19 === 0,
    });
  }, 100);
  try {
    await delay(durationMs);
    if (!snapshots) throw new Error(`client ${index} received no state`);
    return { joinMs, snapshots, maxSnapshotGapMs: Math.round(maxSnapshotGapMs), reconnects, unexpectedDisconnects };
  } finally {
    finished = true;
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
