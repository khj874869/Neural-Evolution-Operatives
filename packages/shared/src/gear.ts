import { calculateSquadBonuses, type SquadBonuses } from './squad.js';

export const GEAR_IDS = [
  'sealed-filter', 'salvage-harness', 'trauma-weave', 'coil-governor',
] as const;

export type GearId = typeof GEAR_IDS[number];
export type GearCategory = 'SURVIVAL' | 'SCAVENGE' | 'ARMOR' | 'WEAPON';

export interface GearDefinition {
  id: GearId;
  name: string;
  category: GearCategory;
  mark: string;
  description: string;
  effectLabel: string;
  requiredWorkshop: number;
  cost: { scrap: number; water: number; data: number; cores: number };
}

export const MAX_EQUIPPED_GEAR = 2;

export const GEAR_DEFINITIONS: Readonly<Record<GearId, GearDefinition>> = Object.freeze({
  'sealed-filter': Object.freeze({
    id: 'sealed-filter', name: '밀폐형 정화 필터', category: 'SURVIVAL', mark: '◒',
    description: '폐병원에서 회수한 흡착막을 재가공한 전술 방독면 필터입니다.',
    effectLabel: '방사선 축적 -20%', requiredWorkshop: 1,
    cost: { scrap: 70, water: 25, data: 12, cores: 0 },
  }),
  'salvage-harness': Object.freeze({
    id: 'salvage-harness', name: '자력 회수 하네스', category: 'SCAVENGE', mark: '⌁',
    description: '근처 전리품을 끌어당기고 장거리 이동 부담을 줄이는 외골격 하네스입니다.',
    effectLabel: '회수 반경 +18 · 기동 +3%', requiredWorkshop: 1,
    cost: { scrap: 95, water: 10, data: 18, cores: 0 },
  }),
  'trauma-weave': Object.freeze({
    id: 'trauma-weave', name: '트라우마 위브', category: 'ARMOR', mark: '▣',
    description: '충격을 분산하고 미세 손상을 봉합하는 바이오섬유 내피입니다.',
    effectLabel: '피해 저항 +14% · 재생 0.25/초', requiredWorkshop: 2,
    cost: { scrap: 125, water: 35, data: 25, cores: 0 },
  }),
  'coil-governor': Object.freeze({
    id: 'coil-governor', name: '코일 거버너', category: 'WEAPON', mark: '◎',
    description: '반동 예측과 전력 배분을 보정하는 구시대 화기관제 모듈입니다.',
    effectLabel: '화력 +12% · 연사 +4%', requiredWorkshop: 2,
    cost: { scrap: 145, water: 0, data: 32, cores: 0 },
  }),
});

export function isGearId(value: unknown): value is GearId {
  return typeof value === 'string' && (GEAR_IDS as readonly string[]).includes(value);
}

export function calculateCombatBonuses(operatorIds: string[], gearIds: readonly GearId[]): SquadBonuses {
  const bonuses = calculateSquadBonuses(operatorIds);
  const equipped = [...new Set(gearIds.filter(isGearId))].slice(0, MAX_EQUIPPED_GEAR);
  for (const id of equipped) {
    switch (id) {
      case 'sealed-filter':
        bonuses.radiationGainMultiplier *= 0.8;
        break;
      case 'salvage-harness':
        bonuses.pickupRadius += 18;
        bonuses.moveSpeedMultiplier *= 1.03;
        break;
      case 'trauma-weave':
        bonuses.damageTakenMultiplier *= 0.86;
        bonuses.regenPerSecond += 0.25;
        break;
      case 'coil-governor':
        bonuses.damageMultiplier *= 1.12;
        bonuses.fireCooldownMultiplier *= 0.96;
        break;
    }
  }
  return bonuses;
}

export function describeGearBonuses(gearIds: readonly GearId[]): string[] {
  return [...new Set(gearIds.filter(isGearId))].slice(0, MAX_EQUIPPED_GEAR)
    .map((id) => GEAR_DEFINITIONS[id].effectLabel);
}

export function normalizeGearState(
  ownedValues: readonly unknown[] = [],
  equippedValues: readonly unknown[] = [],
): { owned: GearId[]; equipped: GearId[] } {
  const owned = [...new Set(ownedValues.filter(isGearId))];
  const ownedSet = new Set(owned);
  const equipped = [...new Set(equippedValues.filter(isGearId))]
    .filter((id) => ownedSet.has(id))
    .slice(0, MAX_EQUIPPED_GEAR);
  return { owned, equipped };
}
