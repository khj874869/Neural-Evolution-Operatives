import { randomInt, randomUUID } from 'node:crypto';
import type { PlayerProfile, ResourceWallet } from '../../../packages/shared/src/protocol.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';

const OPERATOR_POOLS = {
  R: ['rook', 'patch'],
  SR: ['ratchet', 'ember', 'lumen'],
  SSR: ['aegis-07', 'morrow'],
} as const;

export type ShelterModule = keyof PlayerProfile['shelter'];

export class EconomyService {
  constructor(
    private readonly repository: PlayerRepository,
    private readonly random: () => number = () => randomInt(0, 1_000_000) / 1_000_000,
  ) {}

  async upgradeShelter(playerId: string, module: ShelterModule, idempotencyKey: string = randomUUID()) {
    return this.repository.mutate(playerId, idempotencyKey, 'SHELTER_UPGRADE', (profile) => {
      const level = profile.shelter[module];
      if (level >= 5) throw new EconomyError('MODULE_MAX_LEVEL', 409);
      const scrapCost = 80 + level * 90;
      const dataCost = 12 + level * 9;
      if (profile.resources.scrap < scrapCost || profile.resources.data < dataCost) {
        throw new EconomyError('INSUFFICIENT_RESOURCES', 409);
      }
      profile.resources.scrap -= scrapCost;
      profile.resources.data -= dataCost;
      profile.shelter[module] += 1;
    });
  }

  async recruit(playerId: string, idempotencyKey: string = randomUUID()) {
    let result: { operatorId: string; rarity: 'R' | 'SR' | 'SSR'; duplicate: boolean } | undefined;
    const mutation = await this.repository.mutate(playerId, idempotencyKey, 'OPERATOR_RECRUIT', (profile) => {
      if (profile.resources.cores < 5) throw new EconomyError('INSUFFICIENT_CORES', 409);
      profile.resources.cores -= 5;
      profile.pity += 1;
      const roll = this.random();
      const rarity = profile.pity >= 20 || roll < 0.04 ? 'SSR' : roll < 0.28 ? 'SR' : 'R';
      if (rarity === 'SSR') profile.pity = 0;
      const pool = OPERATOR_POOLS[rarity];
      const operatorId = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
      const owned = profile.operators.find((operator) => operator.id === operatorId);
      if (owned) {
        owned.level += 1;
        owned.bond = Math.min(100, owned.bond + 3);
        profile.resources.data += rarity === 'SSR' ? 35 : rarity === 'SR' ? 15 : 6;
      } else {
        profile.operators.push({ id: operatorId, level: 1, bond: 0, memories: [] });
      }
      result = { operatorId, rarity, duplicate: Boolean(owned) };
    });
    return { ...mutation, result };
  }

  async claimOffline(playerId: string, idempotencyKey: string = randomUUID(), now = new Date()) {
    let reward: ResourceWallet & { elapsedMinutes: number } | undefined;
    const mutation = await this.repository.mutate(playerId, idempotencyKey, 'OFFLINE_CLAIM', (profile) => {
      const lastSeen = new Date(profile.lastSeenAt).getTime();
      const elapsedMinutes = Math.min(480, Math.max(0, Math.floor((now.getTime() - lastSeen) / 60_000)));
      const scrap = Math.floor(elapsedMinutes * 0.22 * (1 + (profile.shelter.workshop - 1) * 0.35));
      const water = Math.floor(elapsedMinutes * 0.14 * (1 + (profile.shelter.purifier - 1) * 0.3));
      const data = Math.floor(elapsedMinutes * 0.025 * (1 + profile.shelter.command * 0.1));
      reward = { scrap, water, data, cores: 0, elapsedMinutes };
      profile.resources.scrap += scrap;
      profile.resources.water += water;
      profile.resources.data += data;
    });
    return { ...mutation, reward };
  }

  async grantExtraction(playerId: string, cargo: ResourceWallet, sessionId: string) {
    return this.repository.mutate(playerId, `extract:${sessionId}`, 'RED_ZONE_EXTRACTION', (profile) => {
      for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
        const amount = Math.floor(cargo[key]);
        if (!Number.isFinite(amount) || amount < 0 || amount > 10_000) throw new EconomyError('INVALID_CARGO', 400);
        profile.resources[key] += amount;
      }
    });
  }
}

export class EconomyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
