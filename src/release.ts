import { APP_VERSION, normalizeReleaseChannel } from '../packages/shared/src/release';

const feedbackUrl = safeHttpUrl(import.meta.env.VITE_FEEDBACK_URL);

export const CLIENT_RELEASE = Object.freeze({
  version: APP_VERSION,
  channel: normalizeReleaseChannel(
    import.meta.env.VITE_RELEASE_CHANNEL,
    import.meta.env.DEV ? 'development' : 'alpha',
  ),
  commerceEnabled: import.meta.env.VITE_ENABLE_COMMERCE === 'true',
  feedbackUrl,
});

export function clientPlatform(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): 'android' | 'ios' | 'web' {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  return 'web';
}
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
