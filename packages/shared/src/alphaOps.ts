import type { FunnelEventName, FunnelProperties } from './analytics.js';

export const ALPHA_FEEDBACK_CATEGORIES = [
  'controls',
  'performance',
  'connection',
  'progression',
  'ai',
  'other',
] as const;

export type AlphaFeedbackCategory = typeof ALPHA_FEEDBACK_CATEGORIES[number];

export interface AlphaFeedbackSubmission {
  category: AlphaFeedbackCategory;
  rating: number;
  message: string;
  diagnostics: FunnelProperties;
}

export interface AlphaFeedbackReceipt {
  accepted: true;
  replayed: boolean;
  submittedAt: string;
}

export interface AlphaOpsFunnelMetric {
  event: FunnelEventName;
  events: number;
  uniquePlayers: number;
}

export interface AlphaOpsRetentionMetric {
  eligible: number;
  returned: number;
  rate: number | null;
}

export interface AlphaOpsRecentFeedback {
  category: AlphaFeedbackCategory;
  rating: number;
  message: string;
  createdAt: string;
}

export interface AlphaOpsSnapshot {
  generatedAt: string;
  windowDays: number;
  windowStart: string;
  dataMode: 'consented-alpha-telemetry';
  audience: {
    registeredPlayers: number;
    telemetryActivePlayers: number;
    dailyActivePlayers: number;
    newPlayers: number;
  };
  retention: {
    d1: AlphaOpsRetentionMetric;
    d7: AlphaOpsRetentionMetric;
  };
  funnel: AlphaOpsFunnelMetric[];
  feedback: {
    total: number;
    averageRating: number | null;
    byCategory: Record<AlphaFeedbackCategory, number>;
    recent: AlphaOpsRecentFeedback[];
  };
}
