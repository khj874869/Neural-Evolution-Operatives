import { describe, expect, it } from 'vitest';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';

describe('private alpha operations aggregation', () => {
  it('computes consented D1/D7 cohorts, funnels, and feedback without exposing player ids', async () => {
    const repository = new InMemoryPlayerRepository();
    const first = await repository.getOrCreateGuest('web:ops-first-player');
    const second = await repository.getOrCreateGuest('web:ops-second-player');
    const third = await repository.getOrCreateGuest('web:ops-third-player');

    await repository.recordAnalytics(first.playerId, 'session_start', {}, new Date('2026-07-20T03:00:00.000Z'));
    await repository.recordAnalytics(first.playerId, 'session_start', {}, new Date('2026-07-21T03:00:00.000Z'));
    await repository.recordAnalytics(first.playerId, 'session_start', {}, new Date('2026-07-27T03:00:00.000Z'));
    await repository.recordAnalytics(first.playerId, 'operation_complete', {}, new Date('2026-07-21T03:20:00.000Z'));
    await repository.recordAnalytics(second.playerId, 'session_start', {}, new Date('2026-07-21T04:00:00.000Z'));
    await repository.recordAnalytics(second.playerId, 'session_start', {}, new Date('2026-07-28T04:00:00.000Z'));
    await repository.recordAnalytics(second.playerId, 'contract_view', {}, new Date('2026-07-28T04:10:00.000Z'));
    await repository.recordAnalytics(third.playerId, 'session_start', {}, new Date('2026-07-29T05:00:00.000Z'));
    await repository.recordAlphaFeedback(first.playerId, 'feedback:first:0001', {
      category: 'controls',
      rating: 4,
      message: '모바일 조준 감도 조절이 필요합니다.',
      diagnostics: { version: '1.4.0', platform: 'android' },
    }, new Date('2026-07-29T06:00:00.000Z'));
    await repository.recordAlphaFeedback(second.playerId, 'feedback:second:001', {
      category: 'progression',
      rating: 2,
      message: '첫 계약 보상을 더 빠르게 받고 싶습니다.',
      diagnostics: { version: '1.4.0', platform: 'web' },
    }, new Date('2026-07-29T07:00:00.000Z'));

    const snapshot = await repository.getAlphaOpsSnapshot(14, new Date('2026-07-30T12:00:00.000Z'));
    expect(snapshot.audience).toMatchObject({
      registeredPlayers: 3,
      telemetryActivePlayers: 3,
      dailyActivePlayers: 0,
    });
    expect(snapshot.retention.d1).toEqual({ eligible: 3, returned: 1, rate: 0.333 });
    expect(snapshot.retention.d7).toEqual({ eligible: 2, returned: 2, rate: 1 });
    expect(snapshot.funnel.find((metric) => metric.event === 'session_start')).toMatchObject({
      events: 6,
      uniquePlayers: 3,
    });
    expect(snapshot.feedback).toMatchObject({ total: 2, averageRating: 3 });
    expect(JSON.stringify(snapshot)).not.toContain(first.playerId);
    expect(JSON.stringify(snapshot)).not.toContain(second.playerId);
  });

  it('deduplicates feedback and removes it with the player account', async () => {
    const repository = new InMemoryPlayerRepository();
    const profile = await repository.getOrCreateGuest('web:ops-delete-player');
    const submission = {
      category: 'other' as const,
      rating: 5,
      message: '분위기와 사운드가 좋았습니다.',
      diagnostics: {},
    };
    const first = await repository.recordAlphaFeedback(
      profile.playerId,
      'feedback:delete:001',
      submission,
      new Date('2026-07-29T00:00:00.000Z'),
    );
    const replay = await repository.recordAlphaFeedback(
      profile.playerId,
      'feedback:delete:001',
      submission,
      new Date('2026-07-30T00:00:00.000Z'),
    );
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, submittedAt: first.submittedAt });

    await repository.deletePlayer(profile.playerId);
    const snapshot = await repository.getAlphaOpsSnapshot(7, new Date('2026-07-30T12:00:00.000Z'));
    expect(snapshot.audience.registeredPlayers).toBe(0);
    expect(snapshot.feedback.total).toBe(0);
  });
});
