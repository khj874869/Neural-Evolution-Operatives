export interface PlayerSettings {
  version: 3;
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  tutorialComplete: boolean;
  analyticsConsent: boolean;
  consentReviewed: boolean;
  uiScale: 'compact' | 'standard' | 'large';
  colorVision: 'standard' | 'deuteranopia' | 'high-contrast';
  graphicsQuality: 'auto' | 'high' | 'balanced' | 'low';
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  version: 3,
  sound: true,
  haptics: true,
  reducedMotion: false,
  tutorialComplete: false,
  analyticsConsent: false,
  consentReviewed: false,
  uiScale: 'standard',
  colorVision: 'standard',
  graphicsQuality: 'auto',
};

const SETTINGS_KEY = 'neo-settings-v3';
const PREVIOUS_SETTINGS_KEY = 'neo-settings-v2';
const LEGACY_SETTINGS_KEY = 'neo-settings-v1';

export function sanitizeSettings(value: unknown): PlayerSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const source = value as Partial<PlayerSettings>;
  return {
    version: 3,
    sound: typeof source.sound === 'boolean' ? source.sound : DEFAULT_SETTINGS.sound,
    haptics: typeof source.haptics === 'boolean' ? source.haptics : DEFAULT_SETTINGS.haptics,
    reducedMotion: typeof source.reducedMotion === 'boolean' ? source.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    tutorialComplete: typeof source.tutorialComplete === 'boolean' ? source.tutorialComplete : DEFAULT_SETTINGS.tutorialComplete,
    analyticsConsent: typeof source.analyticsConsent === 'boolean' ? source.analyticsConsent : DEFAULT_SETTINGS.analyticsConsent,
    consentReviewed: typeof source.consentReviewed === 'boolean' ? source.consentReviewed : DEFAULT_SETTINGS.consentReviewed,
    uiScale: source.uiScale === 'compact' || source.uiScale === 'large' ? source.uiScale : 'standard',
    colorVision: source.colorVision === 'deuteranopia' || source.colorVision === 'high-contrast'
      ? source.colorVision : 'standard',
    graphicsQuality: source.graphicsQuality === 'high' || source.graphicsQuality === 'balanced' || source.graphicsQuality === 'low'
      ? source.graphicsQuality : 'auto',
  };
}

export function loadSettings(storage = availableStorage()): PlayerSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const value = storage.getItem(SETTINGS_KEY) ?? storage.getItem(PREVIOUS_SETTINGS_KEY)
      ?? storage.getItem(LEGACY_SETTINGS_KEY);
    return value ? sanitizeSettings(JSON.parse(value)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: PlayerSettings, storage = availableStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
  } catch {
    // Restricted browser storage must not prevent play.
  }
}

function availableStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}
