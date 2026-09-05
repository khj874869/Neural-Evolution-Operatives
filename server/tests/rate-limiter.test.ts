import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from '../src/rooms/RedZoneRoom.js';

describe('room message rate limiter', () => {
  it('enforces independent fixed windows and resets them on leave cleanup', () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(() => now);

    for (let index = 0; index < 35; index += 1) {
      expect(limiter.allow('session-1', 'input', 35, 1_000)).toBe(true);
    }
    expect(limiter.allow('session-1', 'input', 35, 1_000)).toBe(false);

    for (let index = 0; index < 6; index += 1) {
      expect(limiter.allow('session-1', 'tactical', 6, 10_000)).toBe(true);
      expect(limiter.allow('session-1', 'profile-sync', 6, 60_000)).toBe(true);
    }
    expect(limiter.allow('session-1', 'tactical', 6, 10_000)).toBe(false);
    expect(limiter.allow('session-1', 'profile-sync', 6, 60_000)).toBe(false);
    expect(limiter.allow('session-2', 'input', 35, 1_000)).toBe(true);

    now += 1_000;
    expect(limiter.allow('session-1', 'input', 35, 1_000)).toBe(true);
    expect(limiter.allow('session-1', 'tactical', 6, 10_000)).toBe(false);

    limiter.clearSession('session-1');
    expect(limiter.allow('session-1', 'tactical', 6, 10_000)).toBe(true);
    expect(limiter.allow('session-1', 'profile-sync', 6, 60_000)).toBe(true);
  });
});
