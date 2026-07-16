export const WEAPON_IDS = ['carbine', 'scatter', 'rail'] as const;

export type WeaponId = typeof WEAPON_IDS[number];

export interface WeaponSpec {
  id: WeaponId;
  slot: 1 | 2 | 3;
  name: string;
  shortName: string;
  description: string;
  damage: number;
  cooldownMs: number;
  range: number;
  projectileSpeed: number;
  projectiles: number;
  spreadRadians: number;
  tint: number;
}

export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  carbine: {
    id: 'carbine', slot: 1, name: 'KX-7 카빈', shortName: 'CARBINE',
    description: '중거리 자동소총 · 균형형', damage: 19, cooldownMs: 180, range: 650,
    projectileSpeed: 760, projectiles: 1, spreadRadians: 0, tint: 0xc9f456,
  },
  scatter: {
    id: 'scatter', slot: 2, name: 'SG-4 파쇄포', shortName: 'SCATTER',
    description: '근거리 산탄 · 돌파형', damage: 10, cooldownMs: 560, range: 380,
    projectileSpeed: 650, projectiles: 5, spreadRadians: 0.34, tint: 0xffa45c,
  },
  rail: {
    id: 'rail', slot: 3, name: 'VX-9 코일건', shortName: 'COIL',
    description: '장거리 고화력 · 정밀형', damage: 48, cooldownMs: 880, range: 940,
    projectileSpeed: 1_080, projectiles: 1, spreadRadians: 0, tint: 0x62dcff,
  },
};

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && (WEAPON_IDS as readonly string[]).includes(value);
}

export function weaponFromSlot(slot: number): WeaponId | undefined {
  return WEAPON_IDS.find((id) => WEAPON_SPECS[id].slot === slot);
}

export function projectileAngles(aimAngle: number, weapon: WeaponId): number[] {
  const spec = WEAPON_SPECS[weapon];
  if (spec.projectiles === 1) return [aimAngle];
  return Array.from({ length: spec.projectiles }, (_value, index) => {
    const ratio = index / (spec.projectiles - 1);
    return aimAngle - spec.spreadRadians / 2 + ratio * spec.spreadRadians;
  });
}
