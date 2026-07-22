import { randomUUID } from 'node:crypto';
import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import { isOperationId } from '../../../packages/shared/src/operations.js';
import { normalizeGearState } from '../../../packages/shared/src/gear.js';

export function createPlayerProfile(deviceId: string, now = new Date()): PlayerProfile {
  return {
    version: 1,
    playerId: randomUUID(),
    deviceId,
    displayName: `SURVIVOR-${Math.floor(Math.random() * 9000 + 1000)}`,
    resources: { scrap: 180, water: 120, data: 45, cores: 10 },
    shelter: { command: 1, purifier: 1, workshop: 1, greenhouse: 0 },
    operators: [
      { id: 'aegis-07', level: 1, bond: 5, memories: ['붉은 구역 첫 링크를 동기화했다.'] },
      { id: 'ratchet', level: 1, bond: 2, memories: [] },
      { id: 'lumen', level: 1, bond: 2, memories: [] },
    ],
    squad: ['aegis-07', 'ratchet', 'lumen'],
    gear: { owned: [], equipped: [] },
    pity: 0,
    accountLevel: 1,
    xp: 0,
    campaign: { completedOperations: [] },
    commerce: { entitlements: [], subscriptionUntil: null, purchases: [] },
    lastSeenAt: now.toISOString(),
    createdAt: now.toISOString(),
  };
}

export function normalizePlayerProfile(profile: PlayerProfile): PlayerProfile {
  const candidate = profile as PlayerProfile & {
    gear?: { owned?: unknown[]; equipped?: unknown[] };
  };
  profile.campaign ??= { completedOperations: [] };
  profile.campaign.completedOperations = [...new Set(
    (profile.campaign.completedOperations ?? []).filter(isOperationId),
  )];
  profile.commerce ??= { entitlements: [], subscriptionUntil: null, purchases: [] };
  profile.commerce.entitlements ??= [];
  profile.commerce.subscriptionUntil ??= null;
  profile.commerce.purchases ??= [];
  profile.commerce.purchases = profile.commerce.purchases.map((purchase) => ({
    ...purchase,
    amountMinor: Number.isFinite(purchase.amountMinor) ? purchase.amountMinor : 0,
    currency: purchase.currency || 'UNKNOWN',
  }));
  profile.gear = normalizeGearState(candidate.gear?.owned, candidate.gear?.equipped);
  return profile;
}
