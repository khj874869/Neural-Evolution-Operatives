export interface PlayerSettings {
  version: 1;
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  tutorialComplete: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  version: 1,
  sound: true,
  haptics: true,
  reducedMotion: false,
  tutorialComplete: false,
};

const SETTINGS_KEY = 'neo-settings-v1';

export function sanitizeSettings(value: unknown): PlayerSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const source = value as Partial<PlayerSettings>;
  return {
    version: 1,
    sound: typeof source.sound === 'boolean' ? source.sound : DEFAULT_SETTINGS.sound,
    haptics: typeof source.haptics === 'boolean' ? source.haptics : DEFAULT_SETTINGS.haptics,
    reducedMotion: typeof source.reducedMotion === 'boolean' ? source.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    tutorialComplete: typeof source.tutorialComplete === 'boolean' ? source.tutorialComplete : DEFAULT_SETTINGS.tutorialComplete,
  };
}

export function loadSettings(storage = availableStorage()): PlayerSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const value = storage.getItem(SETTINGS_KEY);
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
