import { getOperator, OPERATORS, type Rarity } from '../data/operators';

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
  accountLevel: number;
  xp: number;
  pity: number;
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
  accountLevel: 1,
  xp: 0,
  pity: 0,
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
        if (parsed.version === 1) return parsed;
      }
    } catch {
      // Corrupt or privacy-restricted storage falls back to a safe fresh save.
    }
    return initialSave();
  }

  snapshot(): SaveData {
    return structuredClone(this.data);
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
    this.data.xp += 3;
    const required = this.data.accountLevel * 120;
    if (this.data.xp >= required) {
      this.data.xp -= required;
      this.data.accountLevel += 1;
      this.data.resources.cores += 2;
    }
    this.save();
  }

  recordExtraction(scrap: number): void {
    this.data.stats.raids += 1;
    this.data.stats.extractedScrap += scrap;
    this.addResources({ scrap });
  }

  remember(operatorId: string, memory: string): void {
    const owned = this.data.operators.find((operator) => operator.id === operatorId);
    if (!owned) return;
    owned.memories = [memory, ...owned.memories.filter((item) => item !== memory)].slice(0, 8);
    owned.bond = Math.min(100, owned.bond + 1);
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

  getSquad() {
    return this.data.squad.map((id) => ({ definition: getOperator(id), owned: this.data.operators.find((operator) => operator.id === id)! }));
  }
}
