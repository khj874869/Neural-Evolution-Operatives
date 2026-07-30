import { FUNNEL_EVENTS, type FunnelEventName } from '../../../packages/shared/src/analytics.js';
import {
  ALPHA_FEEDBACK_CATEGORIES,
  type AlphaFeedbackCategory,
  type AlphaFeedbackSubmission,
  type AlphaOpsRetentionMetric,
  type AlphaOpsSnapshot,
} from '../../../packages/shared/src/alphaOps.js';

export interface AlphaOpsProfileFact {
  playerId: string;
  createdAt: string;
}

export interface AlphaOpsEventFact {
  playerId: string;
  event: FunnelEventName;
  createdAt: string;
}

export interface AlphaOpsFeedbackFact extends AlphaFeedbackSubmission {
  createdAt: string;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export function aggregateAlphaOps(
  profiles: AlphaOpsProfileFact[],
  events: AlphaOpsEventFact[],
  feedback: AlphaOpsFeedbackFact[],
  windowDays: number,
  now = new Date(),
): AlphaOpsSnapshot {
  const generatedAt = now.toISOString();
  const windowStartDate = new Date(now.getTime() - windowDays * DAY_MS);
  const windowStart = windowStartDate.toISOString();
  const reportStartDay = kstDay(windowStartDate);
  const today = kstDay(now);
  const windowEvents = events.filter((event) => Date.parse(event.createdAt) >= windowStartDate.getTime());
  const sessionEvents = events.filter((event) => event.event === 'session_start');
  const activePlayers = uniquePlayers(windowEvents.filter((event) => event.event === 'session_start'));
  const dailyPlayers = uniquePlayers(sessionEvents.filter((event) => kstDay(new Date(event.createdAt)) === today));

  const firstSessionByPlayer = new Map<string, string>();
  const sessionDaysByPlayer = new Map<string, Set<string>>();
  for (const event of sessionEvents) {
    const day = kstDay(new Date(event.createdAt));
    const previous = firstSessionByPlayer.get(event.playerId);
    if (!previous || day < previous) firstSessionByPlayer.set(event.playerId, day);
    const days = sessionDaysByPlayer.get(event.playerId) ?? new Set<string>();
    days.add(day);
    sessionDaysByPlayer.set(event.playerId, days);
  }

  const retention = (offsetDays: number): AlphaOpsRetentionMetric => {
    let eligible = 0;
    let returned = 0;
    const latestEligibleDay = addUtcDays(today, -offsetDays);
    for (const [playerId, firstDay] of firstSessionByPlayer) {
      if (firstDay < reportStartDay || firstDay > latestEligibleDay) continue;
      eligible += 1;
      if (sessionDaysByPlayer.get(playerId)?.has(addUtcDays(firstDay, offsetDays))) returned += 1;
    }
    return {
      eligible,
      returned,
      rate: eligible ? round(returned / eligible) : null,
    };
  };

  const recentFeedback = feedback
    .filter((entry) => Date.parse(entry.createdAt) >= windowStartDate.getTime())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const byCategory = Object.fromEntries(
    ALPHA_FEEDBACK_CATEGORIES.map((category) => [
      category,
      recentFeedback.filter((entry) => entry.category === category).length,
    ]),
  ) as Record<AlphaFeedbackCategory, number>;

  return {
    generatedAt,
    windowDays,
    windowStart,
    dataMode: 'consented-alpha-telemetry',
    audience: {
      registeredPlayers: profiles.length,
      telemetryActivePlayers: activePlayers.size,
      dailyActivePlayers: dailyPlayers.size,
      newPlayers: profiles.filter((profile) => Date.parse(profile.createdAt) >= windowStartDate.getTime()).length,
    },
    retention: {
      d1: retention(1),
      d7: retention(7),
    },
    funnel: FUNNEL_EVENTS.map((event) => {
      const matching = windowEvents.filter((entry) => entry.event === event);
      return { event, events: matching.length, uniquePlayers: uniquePlayers(matching).size };
    }),
    feedback: {
      total: recentFeedback.length,
      averageRating: recentFeedback.length
        ? round(recentFeedback.reduce((sum, entry) => sum + entry.rating, 0) / recentFeedback.length)
        : null,
      byCategory,
      recent: recentFeedback.slice(0, 20).map(({ category, rating, message, createdAt }) => ({
        category, rating, message, createdAt,
      })),
    },
  };
}

function uniquePlayers(events: AlphaOpsEventFact[]): Set<string> {
  return new Set(events.map((event) => event.playerId));
}

function kstDay(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function addUtcDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
