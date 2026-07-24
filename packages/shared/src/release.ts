export const APP_VERSION = '1.3.0';

export const RELEASE_CHANNELS = ['development', 'alpha', 'beta', 'production'] as const;
export type ReleaseChannel = typeof RELEASE_CHANNELS[number];

export function normalizeReleaseChannel(value: unknown, fallback: ReleaseChannel = 'alpha'): ReleaseChannel {
  return typeof value === 'string' && (RELEASE_CHANNELS as readonly string[]).includes(value)
    ? value as ReleaseChannel
    : fallback;
}
