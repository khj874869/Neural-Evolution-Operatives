export interface SquadBonuses {
  damageMultiplier: number;
  fireCooldownMultiplier: number;
  moveSpeedMultiplier: number;
  radiationGainMultiplier: number;
  damageTakenMultiplier: number;
  regenPerSecond: number;
  pickupRadius: number;
}

const BASE_BONUSES: SquadBonuses = {
  damageMultiplier: 1,
  fireCooldownMultiplier: 1,
  moveSpeedMultiplier: 1,
  radiationGainMultiplier: 1,
  damageTakenMultiplier: 1,
  regenPerSecond: 0,
  pickupRadius: 28,
};

export function calculateSquadBonuses(operatorIds: string[]): SquadBonuses {
  const bonuses = { ...BASE_BONUSES };
  for (const id of new Set(operatorIds)) {
    switch (id) {
      case 'aegis-07':
        bonuses.radiationGainMultiplier *= 0.82;
        break;
      case 'morrow':
        bonuses.damageMultiplier *= 1.18;
        break;
      case 'ratchet':
        bonuses.pickupRadius += 14;
        break;
      case 'ember':
        bonuses.fireCooldownMultiplier *= 0.86;
        bonuses.moveSpeedMultiplier *= 1.05;
        break;
      case 'lumen':
        bonuses.regenPerSecond += 0.8;
        break;
      case 'rook':
        bonuses.damageTakenMultiplier *= 0.88;
        break;
      case 'patch':
        bonuses.regenPerSecond += 0.4;
        bonuses.pickupRadius += 6;
        break;
    }
  }
  return bonuses;
}

export function describeSquadBonuses(operatorIds: string[]): string[] {
  const bonuses = calculateSquadBonuses(operatorIds);
  const descriptions: string[] = [];
  if (bonuses.damageMultiplier > 1) descriptions.push(`화력 +${percent(bonuses.damageMultiplier - 1)}%`);
  if (bonuses.fireCooldownMultiplier < 1) descriptions.push(`연사 +${percent(1 / bonuses.fireCooldownMultiplier - 1)}%`);
  if (bonuses.moveSpeedMultiplier > 1) descriptions.push(`기동 +${percent(bonuses.moveSpeedMultiplier - 1)}%`);
  if (bonuses.radiationGainMultiplier < 1) descriptions.push(`방사선 저항 +${percent(1 - bonuses.radiationGainMultiplier)}%`);
  if (bonuses.damageTakenMultiplier < 1) descriptions.push(`피해 저항 +${percent(1 - bonuses.damageTakenMultiplier)}%`);
  if (bonuses.regenPerSecond > 0) descriptions.push(`재생 ${bonuses.regenPerSecond.toFixed(1)}/초`);
  if (bonuses.pickupRadius > BASE_BONUSES.pickupRadius) descriptions.push(`회수 반경 +${bonuses.pickupRadius - BASE_BONUSES.pickupRadius}`);
  return descriptions;
}

function percent(value: number): number {
  return Math.round(value * 100);
}
