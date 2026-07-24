import { getOperator, OPERATORS, type Rarity } from '../data/operators';
import type { PlayerProfile } from '../../../packages/shared/src/protocol';
import {
  activeOperationId, isOperationId, type OperationId,
} from '../../../packages/shared/src/operations';
import {
  GEAR_DEFINITIONS, MAX_EQUIPPED_GEAR, normalizeGearState, type GearId,
} from '../../../packages/shared/src/gear';
import { operatorMemoryLimit } from '../../../packages/shared/src/persona';
import {
  advanceContracts, buildContractBoard, claimContract, createContractState, normalizeContractState,
  type ContractBoard, type ContractId, type ContractReward, type ContractState,
} from '../../../packages/shared/src/contracts';

export interface Resources {
  scrap: number;
  water: number;
  data: number;
  cores: number;
}

export interface OwnedOperator {
  id: string;
  level: number;
  bond: number;
  memories: string[];
}

export interface ShelterModules {
  command: number;
  purifier: number;
  workshop: number;
  greenhouse: number;
}

export interface SaveData {
  version: 1;
  resources: Resources;
  shelter: ShelterModules;
  operators: OwnedOperator[];
  squad: string[];
  gear: { owned: GearId[]; equipped: GearId[] };
  accountLevel: number;
  xp: number;
  pity: number;
  campaign: { completedOperations: OperationId[] };
  contracts: ContractState;
  stats: { raids: number; kills: number; extractedScrap: number };
  lastSeenAt: number;
}

export interface OfflineReward extends Resources {
  elapsedMinutes: number;
}

const STORAGE_KEY = 'neo-save-v1';
const MAX_OFFLINE_HOURS = 8;

const initialSave = (): SaveData => ({
  version: 1,
  resources: { scrap: 180, water: 120, data: 45, cores: 10 },
  shelter: { command: 1, purifier: 1, workshop: 1, greenhouse: 0 },
  operators: [
    { id: 'aegis-07', level: 1, bond: 5, memories: ['붉은 구역 첫 링크를 동기화했다.'] },
    { id: 'ratchet', level: 1, bond: 2, memories: [] },
    { id: 'lumen', level: 1, bond: 2, memories: [] },
  ],
  squad: ['aegis-07', 'ratchet', 'lumen'],
  gear: { owned: [], equipped: [] },
  accountLevel: 1,
  xp: 0,
  pity: 0,
  campaign: { completedOperations: [] },
  contracts: createContractState(),
  stats: { raids: 0, kills: 0, extractedScrap: 0 },
  lastSeenAt: Date.now(),
});

export function calculateOfflineRewards(save: SaveData, now = Date.now()): OfflineReward {
  const elapsedMs = Math.max(0, now - save.lastSeenAt);
  const elapsedMinutes = Math.min(MAX_OFFLINE_HOURS * 60, Math.floor(elapsedMs / 60_000));
  const workshopRate = 1 + (save.shelter.workshop - 1) * 0.35;
  const purifierRate = 1 + (save.shelter.purifier - 1) * 0.3;
  return {
    elapsedMinutes,
    scrap: Math.floor(elapsedMinutes * 0.22 * workshopRate),
    water: Math.floor(elapsedMinutes * 0.14 * purifierRate),
    data: Math.floor(elapsedMinutes * 0.025 * (1 + save.shelter.command * 0.1)),
    cores: 0,
  };
}

export class GameState {
  private data: SaveData;
  readonly offlineReward: OfflineReward;

  constructor() {
    this.data = this.load();
    this.offlineReward = calculateOfflineRewards(this.data);
    if (this.offlineReward.elapsedMinutes >= 2) {
      this.addResources(this.offlineReward);
    }
    this.data.lastSeenAt = Date.now();
    this.save();
  }

  private load(): SaveData {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value) {
        const parsed = JSON.parse(value) as SaveData;
        if (parsed.version === 1) return normalizeSave(parsed);
      }
    } catch {
      // Corrupt or privacy-restricted storage falls back to a safe fresh save.
    }
    return initialSave();
  }

  snapshot(): SaveData {
    return structuredClone(this.data);
  }

  applyServerProfile(profile: PlayerProfile): void {
    this.data.resources = { ...profile.resources };
    this.data.shelter = { ...profile.shelter };
    this.data.operators = structuredClone(profile.operators);
    this.data.squad = [...profile.squad];
    this.data.gear = normalizeGearState(profile.gear?.owned, profile.gear?.equipped);
    this.data.pity = profile.pity;
    this.data.accountLevel = profile.accountLevel;
    this.data.xp = profile.xp;
    this.data.campaign = {
      completedOperations: [...(profile.campaign?.completedOperations ?? this.data.campaign.completedOperations)],
    };
    this.data.contracts = normalizeContractState(profile.contracts);
    this.save();
  }

  save(): void {
    this.data.lastSeenAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // The game remains playable when persistent storage is unavailable.
    }
  }

  addResources(gain: Partial<Resources>): void {
    for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
      this.data.resources[key] = Math.max(0, this.data.resources[key] + (gain[key] ?? 0));
    }
    this.save();
  }

  recordKill(): void {
    this.data.stats.kills += 1;
    advanceContracts(this.data.contracts, { kills: 1 });
    this.data.xp += 3;
    const required = this.data.accountLevel * 120;
    if (this.data.xp >= required) {
      this.data.xp -= required;
      this.data.accountLevel += 1;
      this.data.resources.cores += 2;
    }
    this.save();
  }

  recordExtraction(cargo: Resources): void {
    this.data.stats.raids += 1;
    this.data.stats.extractedScrap += cargo.scrap;
    for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
      this.data.resources[key] += Math.max(0, Math.floor(cargo[key]));
    }
    advanceContracts(this.data.contracts, {
      extractions: 1,
      scrapExtracted: cargo.scrap,
      dataExtracted: cargo.data,
    });
    this.save();
  }

  activeOperationId(): OperationId {
    return activeOperationId(this.data.campaign.completedOperations);
  }

  completeOperation(operationId: OperationId): boolean {
    advanceContracts(this.data.contracts, { operationsCompleted: 1 });
    if (this.data.campaign.completedOperations.includes(operationId)) {
      this.save();
      return false;
    }
    this.data.campaign.completedOperations.push(operationId);
    this.save();
    return true;
  }

  contractBoard(now = new Date()): ContractBoard {
    this.data.contracts = normalizeContractState(this.data.contracts, now);
    this.save();
    return buildContractBoard(this.data.contracts, now);
  }

  claimContract(contractId: ContractId, now = new Date()): {
    board: ContractBoard;
    reward: ContractReward;
    streakBonus: ContractReward | null;
  } | null {
    this.data.contracts = normalizeContractState(this.data.contracts, now);
    try {
      const result = claimContract(this.data.contracts, contractId, now);
      for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
        this.data.resources[key] += result.reward[key] + (result.streakBonus?.[key] ?? 0);
      }
      this.save();
      return { ...result, board: buildContractBoard(this.data.contracts, now) };
    } catch {
      return null;
    }
  }

  remember(operatorId: string, memory: string): void {
    const owned = this.data.operators.find((operator) => operator.id === operatorId);
    if (!owned) return;
    const limit = operatorMemoryLimit(getOperator(operatorId).rarity);
    owned.memories = [memory, ...owned.memories.filter((item) => item !== memory)].slice(0, limit);
    owned.bond = Math.min(100, owned.bond + 1);
    this.save();
  }

  clearMemories(operatorId: string): void {
    const owned = this.data.operators.find((operator) => operator.id === operatorId);
    if (!owned) return;
    owned.memories = [];
    this.save();
  }

  upgrade(module: keyof ShelterModules): boolean {
    const level = this.data.shelter[module];
    const scrapCost = 80 + level * 90;
    const dataCost = 12 + level * 9;
    if (this.data.resources.scrap < scrapCost || this.data.resources.data < dataCost || level >= 5) return false;
    this.data.resources.scrap -= scrapCost;
    this.data.resources.data -= dataCost;
    this.data.shelter[module] += 1;
    this.save();
    return true;
  }

  recruit(random = Math.random): { operatorId: string; rarity: Rarity; duplicate: boolean } | null {
    if (this.data.resources.cores < 5) return null;
    this.data.resources.cores -= 5;
    this.data.pity += 1;
    const roll = random();
    const rarity: Rarity = this.data.pity >= 20 || roll < 0.04 ? 'SSR' : roll < 0.28 ? 'SR' : 'R';
    if (rarity === 'SSR') this.data.pity = 0;
    const pool = OPERATORS.filter((operator) => operator.rarity === rarity);
    const picked = pool[Math.floor(random() * pool.length)] ?? pool[0];
    const existing = this.data.operators.find((operator) => operator.id === picked.id);
    if (existing) {
      existing.level += 1;
      existing.bond = Math.min(100, existing.bond + 3);
      this.data.resources.data += rarity === 'SSR' ? 35 : rarity === 'SR' ? 15 : 6;
    } else {
      this.data.operators.push({ id: picked.id, level: 1, bond: 0, memories: [] });
    }
    this.save();
    return { operatorId: picked.id, rarity, duplicate: Boolean(existing) };
  }

  setSquad(squad: string[]): boolean {
    if (squad.length !== 3 || new Set(squad).size !== 3) return false;
    const owned = new Set(this.data.operators.map((operator) => operator.id));
    if (squad.some((operatorId) => !owned.has(operatorId))) return false;
    this.data.squad = [...squad];
    this.save();
    return true;
  }

  craftGear(gearId: GearId): boolean {
    if (this.data.gear.owned.includes(gearId)) return false;
    const definition = GEAR_DEFINITIONS[gearId];
    if (this.data.shelter.workshop < definition.requiredWorkshop) return false;
    for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
      if (this.data.resources[key] < definition.cost[key]) return false;
    }
    for (const key of ['scrap', 'water', 'data', 'cores'] as const) {
      this.data.resources[key] -= definition.cost[key];
    }
    this.data.gear.owned.push(gearId);
    if (this.data.gear.equipped.length < MAX_EQUIPPED_GEAR) this.data.gear.equipped.push(gearId);
    this.save();
    return true;
  }

  setGearLoadout(equipped: GearId[]): boolean {
    if (equipped.length > MAX_EQUIPPED_GEAR || new Set(equipped).size !== equipped.length) return false;
    const owned = new Set(this.data.gear.owned);
    if (equipped.some((gearId) => !owned.has(gearId))) return false;
    this.data.gear.equipped = [...equipped];
    this.save();
    return true;
  }

  getSquad() {
    return this.data.squad.flatMap((id) => {
      const owned = this.data.operators.find((operator) => operator.id === id);
      return owned ? [{ definition: getOperator(id), owned }] : [];
    });
  }
}

function normalizeSave(save: SaveData): SaveData {
  const candidate = save as SaveData & {
    campaign?: { completedOperations?: unknown[] };
    gear?: { owned?: unknown[]; equipped?: unknown[] };
    contracts?: unknown;
  };
  const completedOperations = (candidate.campaign?.completedOperations ?? []).filter(isOperationId);
  return {
    ...save,
    campaign: { completedOperations: [...new Set(completedOperations)] },
    gear: normalizeGearState(candidate.gear?.owned, candidate.gear?.equipped),
    contracts: normalizeContractState(candidate.contracts),
  };
}
