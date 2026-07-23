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
    ai: {
      consentedAt: null,
      dailyUsageDate: now.toISOString().slice(0, 10),
      dailyTurnsUsed: 0,
      lastExchange: null,
    },
    commerce: { entitlements: [], subscriptionUntil: null, purchases: [] },
    lastSeenAt: now.toISOString(),
    createdAt: now.toISOString(),
  };
}

export function normalizePlayerProfile(profile: PlayerProfile): PlayerProfile {
  const candidate = profile as PlayerProfile & {
    gear?: { owned?: unknown[]; equipped?: unknown[] };
    ai?: Partial<PlayerProfile['ai']>;
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
  const today = new Date().toISOString().slice(0, 10);
  profile.ai = {
    consentedAt: typeof candidate.ai?.consentedAt === 'string' ? candidate.ai.consentedAt : null,
    dailyUsageDate: typeof candidate.ai?.dailyUsageDate === 'string' ? candidate.ai.dailyUsageDate : today,
    dailyTurnsUsed: Number.isInteger(candidate.ai?.dailyTurnsUsed) && Number(candidate.ai?.dailyTurnsUsed) >= 0
      ? Math.min(10_000, Number(candidate.ai?.dailyTurnsUsed)) : 0,
    lastExchange: normalizeLastExchange(candidate.ai?.lastExchange),
  };
  return profile;
}

function normalizeLastExchange(value: unknown): PlayerProfile['ai']['lastExchange'] {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.requestId !== 'string'
    || typeof source.operatorId !== 'string'
    || typeof source.reply !== 'string'
    || typeof source.memory !== 'string'
    || (source.source !== 'ai' && source.source !== 'rules')
    || typeof source.createdAt !== 'string'
  ) return null;
  return {
    requestId: source.requestId.slice(0, 128),
    operatorId: source.operatorId.slice(0, 32),
    reply: source.reply.slice(0, 400),
    memory: source.memory.slice(0, 160),
    source: source.source,
    createdAt: source.createdAt,
  } as PlayerProfile['ai']['lastExchange'];
}
