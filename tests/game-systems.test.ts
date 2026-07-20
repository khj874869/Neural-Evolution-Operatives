import { describe, expect, it } from 'vitest';
import type { SaveData } from '../src/game/state/GameState';
import { calculateOfflineRewards } from '../src/game/state/GameState';
import { AdaptiveDirector, freshTelemetry } from '../src/game/systems/AdaptiveDirector';
import { generateMission } from '../src/game/systems/MissionGenerator';
import { parseTacticalCommand } from '../src/game/systems/TacticalCommand';
import { calculateSquadBonuses, describeSquadBonuses } from '../packages/shared/src/squad';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/game/settings';
import { projectileAngles, WEAPON_SPECS, weaponFromSlot } from '../packages/shared/src/combat';
import { evaluateOperationZero } from '../src/game/systems/OperationZero';
import { addNeuralCharge, neuralLinkLeader, neuralLinkSkill } from '../packages/shared/src/neuralLink';
import { normalizeReleaseChannel } from '../packages/shared/src/release';
import { clientPlatform } from '../src/release';
import { createClientErrorReport, sanitizeErrorMessage } from '../src/game/telemetry/ClientTelemetry';

const save = (lastSeenAt: number): SaveData => ({
  version: 1,
  resources: { scrap: 0, water: 0, data: 0, cores: 0 },
  shelter: { command: 1, purifier: 1, workshop: 1, greenhouse: 0 },
  operators: [], squad: [], accountLevel: 1, xp: 0, pity: 0,
  stats: { raids: 0, kills: 0, extractedScrap: 0 }, lastSeenAt,
});

describe('tactical command parser', () => {
  it('understands Korean natural language orders', () => {
    expect(parseTacticalCommand('방패병 어그로 끌어줘, 내가 뒤치기 할게').order).toBe('DRAW_AGGRO');
    expect(parseTacticalCommand('모두 내 쪽으로 복귀해').order).toBe('REGROUP');
    expect(parseTacticalCommand('루멘, 지금 치료해줘').order).toBe('HEAL');
  });
});

describe('offline shelter economy', () => {
  it('caps gains at eight hours', () => {
    const now = 1_000_000_000;
    const reward = calculateOfflineRewards(save(now - 24 * 60 * 60 * 1000), now);
    expect(reward.elapsedMinutes).toBe(480);
    expect(reward.scrap).toBe(105);
  });
});

describe('adaptive director', () => {
  it('counters accurate stationary play with stalkers', () => {
    const director = new AdaptiveDirector();
    const telemetry = { ...freshTelemetry(), shots: 20, hits: 16, stationarySeconds: 20 };
    const profile = director.evaluate(telemetry, 2);
    expect(profile.weights.stalker).toBeGreaterThan(0.3);
    expect(profile.counterMessage).toContain('장거리');
    expect(profile.weights.jammer).toBeGreaterThan(0);
  });
});

describe('mission generator', () => {
  it('targets the most scarce resource deterministically', () => {
    const mission = generateMission(3, { scrap: 100, water: 4, data: 30, cores: 0 }, 42);
    expect(mission.targetResource).toBe('water');
    expect(mission.targetKills).toBe(14);
  });
});

describe('operator squad links', () => {
  it('combines unique operator bonuses and ignores duplicate ids', () => {
    const bonuses = calculateSquadBonuses(['aegis-07', 'ratchet', 'ratchet']);
    expect(bonuses.radiationGainMultiplier).toBe(0.82);
    expect(bonuses.pickupRadius).toBe(42);
    expect(describeSquadBonuses(['aegis-07', 'ratchet'])).toContain('방사선 저항 +18%');
  });
});

describe('player settings', () => {
  it('repairs incomplete or invalid persisted settings', () => {
    expect(sanitizeSettings({ sound: false, haptics: 'invalid', reducedMotion: true })).toEqual({
      ...DEFAULT_SETTINGS,
      sound: false,
      reducedMotion: true,
    });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ uiScale: 'large', colorVision: 'deuteranopia', analyticsConsent: true })).toMatchObject({
      version: 2, uiScale: 'large', colorVision: 'deuteranopia', analyticsConsent: true,
    });
  });
});

describe('weapon loadout', () => {
  it('maps three slots and creates a deterministic scatter pattern', () => {
    expect(weaponFromSlot(3)).toBe('rail');
    expect(WEAPON_SPECS.rail.range).toBeGreaterThan(WEAPON_SPECS.carbine.range);
    const angles = projectileAngles(0, 'scatter');
    expect(angles).toHaveLength(5);
    expect(angles[0]).toBeCloseTo(-angles[4]);
  });
});

describe('operation zero progression', () => {
  it('gates the boss and extraction into a complete first-session arc', () => {
    expect(evaluateOperationZero({ collected: 0, kills: 0, bossDefeated: false, extracted: false }).stage).toBe('SCAVENGE');
    expect(evaluateOperationZero({ collected: 8, kills: 4, bossDefeated: false, extracted: false }).stage).toBe('ELIMINATE');
    expect(evaluateOperationZero({ collected: 8, kills: 10, bossDefeated: false, extracted: false }).stage).toBe('WARDEN');
    expect(evaluateOperationZero({ collected: 8, kills: 11, bossDefeated: true, extracted: false }).stage).toBe('EXTRACT');
    expect(evaluateOperationZero({ collected: 8, kills: 11, bossDefeated: true, extracted: true }).stage).toBe('COMPLETE');
  });
});

describe('neural link rules', () => {
  it('uses the first valid squad operator as leader and caps combat charge', () => {
    expect(neuralLinkLeader(['lumen', 'ratchet', 'rook'])).toBe('lumen');
    expect(neuralLinkSkill('lumen').role).toBe('Support');
    expect(neuralLinkSkill('morrow').name).toBe('LAST LIGHT');
    expect(addNeuralCharge(94, 12)).toBe(100);
  });
});

describe('private alpha release diagnostics', () => {
  it('normalizes release channels and coarse client platforms', () => {
    expect(normalizeReleaseChannel('beta')).toBe('beta');
    expect(normalizeReleaseChannel('nightly')).toBe('alpha');
    expect(clientPlatform('Mozilla/5.0 (Linux; Android 16)')).toBe('android');
    expect(clientPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe('ios');
  });

  it('removes URLs and identifiers from consented error reports', () => {
    const message = sanitizeErrorMessage(
      'Failed https://example.com/player/123 123e4567-e89b-12d3-a456-426614174000',
    );
    expect(message).toBe('Failed [url] [id]');
    expect(createClientErrorReport('promise', new Error(message))).toMatchObject({
      type: 'promise', message, fingerprint: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
  });
});
