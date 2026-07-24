export const FUNNEL_EVENTS = [
  'session_start',
  'tutorial_complete',
  'operation_complete',
  'contract_view',
  'contract_claim',
  'store_view',
  'checkout_intent',
  'purchase_complete',
  'client_error',
] as const;

export type FunnelEventName = typeof FUNNEL_EVENTS[number];
export type FunnelProperties = Record<string, string | number | boolean>;

export function limitFunnelProperties(properties: FunnelProperties, maximum = 12): FunnelProperties {
  return Object.fromEntries(Object.entries(properties).slice(0, Math.max(0, maximum)));
}
