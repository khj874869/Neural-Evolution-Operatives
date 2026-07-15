import { describe, expect, it } from 'vitest';
import type { SaveData } from '../src/game/state/GameState';
import { calculateOfflineRewards } from '../src/game/state/GameState';
import { AdaptiveDirector, freshTelemetry } from '../src/game/systems/AdaptiveDirector';
import { generateMission } from '../src/game/systems/MissionGenerator';
import { parseTacticalCommand } from '../src/game/systems/TacticalCommand';

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
  });
});

describe('mission generator', () => {
  it('targets the most scarce resource deterministically', () => {
    const mission = generateMission(3, { scrap: 100, water: 4, data: 30, cores: 0 }, 42);
    expect(mission.targetResource).toBe('water');
    expect(mission.targetKills).toBe(14);
  });
});
