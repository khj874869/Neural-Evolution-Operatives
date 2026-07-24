import { randomInt, randomUUID } from 'node:crypto';
import type { PlayerProfile, ResourceWallet } from '../../../packages/shared/src/protocol.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';
import {
  isOperationUnlocked, operationDefinition, type OperationId,
} from '../../../packages/shared/src/operations.js';
import {
  GEAR_DEFINITIONS, MAX_EQUIPPED_GEAR, type GearId,
} from '../../../packages/shared/src/gear.js';
import {
  advanceContracts, buildContractBoard, claimContract, CONTRACT_DEFINITIONS, normalizeContractState,
  type ContractBoard, type ContractId, type ContractReward,
} from '../../../packages/shared/src/contracts.js';

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
    private readonly now: () => Date = () => new Date(),
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

  async setSquad(playerId: string, squad: string[], idempotencyKey: string = randomUUID()) {
    return this.repository.mutate(playerId, idempotencyKey, 'SQUAD_UPDATE', (profile) => {
      if (squad.length !== 3 || new Set(squad).size !== 3) {
        throw new EconomyError('SQUAD_REQUIRES_THREE_UNIQUE_OPERATORS', 400);
      }
      const owned = new Set(profile.operators.map((operator) => operator.id));
      if (squad.some((operatorId) => !owned.has(operatorId))) {
        throw new EconomyError('OPERATOR_NOT_OWNED', 409);
      }
      profile.squad = [...squad];
    });
  }

  async craftGear(playerId: string, gearId: GearId, idempotencyKey: string = randomUUID()) {
    return this.repository.mutate(playerId, idempotencyKey, 'GEAR_CRAFT', (profile) => {
      if (profile.gear.owned.includes(gearId)) throw new EconomyError('GEAR_ALREADY_OWNED', 409);
      const definition = GEAR_DEFINITIONS[gearId];
      if (profile.shelter.workshop < definition.requiredWorkshop) {
        throw new EconomyError('WORKSHOP_LEVEL_REQUIRED', 409);
      }
      for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
        if (profile.resources[key] < definition.cost[key]) {
          throw new EconomyError('INSUFFICIENT_RESOURCES', 409);
        }
      }
      for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
        profile.resources[key] -= definition.cost[key];
      }
      profile.gear.owned.push(gearId);
      if (profile.gear.equipped.length < MAX_EQUIPPED_GEAR) profile.gear.equipped.push(gearId);
    });
  }

  async setGearLoadout(playerId: string, equipped: GearId[], idempotencyKey: string = randomUUID()) {
    return this.repository.mutate(playerId, idempotencyKey, 'GEAR_LOADOUT_UPDATE', (profile) => {
      if (equipped.length > MAX_EQUIPPED_GEAR || new Set(equipped).size !== equipped.length) {
        throw new EconomyError('INVALID_GEAR_LOADOUT', 400);
      }
      const owned = new Set(profile.gear.owned);
      if (equipped.some((gearId) => !owned.has(gearId))) throw new EconomyError('GEAR_NOT_OWNED', 409);
      profile.gear.equipped = [...equipped];
    });
  }

  async claimOffline(playerId: string, idempotencyKey: string = randomUUID(), now = new Date()) {
    let reward: ResourceWallet & { elapsedMinutes: number } | undefined;
    const mutation = await this.repository.mutate(playerId, idempotencyKey, 'OFFLINE_CLAIM', (profile) => {
      const lastSeen = new Date(profile.lastSeenAt).getTime();
      const elapsedMinutes = Math.min(480, Math.max(0, Math.floor((now.getTime() - lastSeen) / 60_000)));
      const syncMultiplier = profile.commerce?.subscriptionUntil
        && new Date(profile.commerce.subscriptionUntil).getTime() > now.getTime() ? 1.5 : 1;
      const scrap = Math.floor(elapsedMinutes * 0.22 * (1 + (profile.shelter.workshop - 1) * 0.35) * syncMultiplier);
      const water = Math.floor(elapsedMinutes * 0.14 * (1 + (profile.shelter.purifier - 1) * 0.3) * syncMultiplier);
      const data = Math.floor(elapsedMinutes * 0.025 * (1 + profile.shelter.command * 0.1) * syncMultiplier);
      reward = { scrap, water, data, cores: 0, elapsedMinutes };
      profile.resources.scrap += scrap;
      profile.resources.water += water;
      profile.resources.data += data;
    });
    return { ...mutation, reward };
  }

  async grantExtraction(
    playerId: string,
    cargo: ResourceWallet,
    sessionId: string,
    metrics: { kills?: number; operationComplete?: boolean } = {},
  ) {
    const now = this.now();
    return this.repository.mutate(playerId, `extract:${sessionId}`, 'RED_ZONE_EXTRACTION', (profile) => {
      for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
        const amount = Math.floor(cargo[key]);
        if (!Number.isFinite(amount) || amount < 0 || amount > 10_000) throw new EconomyError('INVALID_CARGO', 400);
        profile.resources[key] += amount;
      }
      profile.contracts = normalizeContractState(profile.contracts, now);
      advanceContracts(profile.contracts, {
        extractions: 1,
        scrapExtracted: cargo.scrap,
        dataExtracted: cargo.data,
        kills: metrics.kills ?? 0,
        operationsCompleted: metrics.operationComplete ? 1 : 0,
      }, now);
    });
  }

  async getContractBoard(playerId: string): Promise<ContractBoard> {
    const profile = await this.repository.getById(playerId);
    if (!profile) throw new EconomyError('PLAYER_NOT_FOUND', 404);
    const now = this.now();
    return buildContractBoard(normalizeContractState(profile.contracts, now), now);
  }

  async claimContract(playerId: string, contractId: ContractId, idempotencyKey: string = randomUUID()) {
    let reward: ContractReward | undefined;
    let streakBonus: ContractReward | null = null;
    const now = this.now();
    const mutation = await this.repository.mutate(playerId, idempotencyKey, 'CONTRACT_CLAIM', (profile) => {
      profile.contracts = normalizeContractState(profile.contracts, now);
      try {
        const claimed = claimContract(profile.contracts, contractId, now);
        reward = claimed.reward;
        streakBonus = claimed.streakBonus;
        addReward(profile.resources, claimed.reward);
        if (claimed.streakBonus) addReward(profile.resources, claimed.streakBonus);
      } catch (error) {
        throw new EconomyError(error instanceof Error ? error.message : 'CONTRACT_CLAIM_FAILED', 409);
      }
    });
    return {
      ...mutation,
      reward: reward ?? { ...CONTRACT_DEFINITIONS[contractId].reward },
      streakBonus,
      board: buildContractBoard(mutation.profile.contracts, now),
    };
  }

  async completeOperation(playerId: string, operationId: OperationId, sessionId: string) {
    let completedNow = false;
    const mutation = await this.repository.mutate(
      playerId,
      `operation:${operationId}:${sessionId}`,
      'OPERATION_COMPLETE',
      (profile) => {
        profile.campaign ??= { completedOperations: [] };
        if (!isOperationUnlocked(operationId, profile.campaign.completedOperations)) {
          throw new EconomyError('OPERATION_LOCKED', 409);
        }
        if (profile.campaign.completedOperations.includes(operationId)) return;
        const definition = operationDefinition(operationId);
        profile.campaign.completedOperations.push(operationId);
        profile.resources.cores += definition.rewards.cores;
        profile.resources.data += definition.rewards.data;
        completedNow = true;
      },
    );
    return { ...mutation, completedNow };
  }
}

export class EconomyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function addReward(wallet: ResourceWallet, reward: ContractReward): void {
  for (const key of ['scrap', 'water', 'data', 'cores'] as const) wallet[key] += reward[key];
}
