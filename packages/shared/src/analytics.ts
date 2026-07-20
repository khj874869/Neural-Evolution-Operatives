export const FUNNEL_EVENTS = [
  'session_start',
  'tutorial_complete',
  'operation_complete',
  'store_view',
  'checkout_intent',
  'purchase_complete',
  'client_error',
] as const;

export type FunnelEventName = typeof FUNNEL_EVENTS[number];
export type FunnelProperties = Record<string, string | number | boolean>;
