export const CONTRACT_IDS = [
  'daily-extract',
  'daily-scrap',
  'daily-data',
  'daily-kills',
  'daily-operation',
  'weekly-extract',
  'weekly-kills',
  'weekly-operations',
] as const;

export type ContractId = typeof CONTRACT_IDS[number];
export type ContractCadence = 'daily' | 'weekly';
export type ContractMetric = 'extractions' | 'scrapExtracted' | 'dataExtracted' | 'kills' | 'operationsCompleted';

export interface ContractReward {
  scrap: number;
  water: number;
  data: number;
  cores: number;
}

export interface ContractDefinition {
  id: ContractId;
  cadence: ContractCadence;
  metric: ContractMetric;
  title: string;
  description: string;
  target: number;
  reward: ContractReward;
}

export interface ContractProgress {
  id: ContractId;
  progress: number;
  claimed: boolean;
}

export interface ContractState {
  dayKey: string;
  weekKey: string;
  daily: ContractProgress[];
  weekly: ContractProgress[];
  streak: number;
  lastActiveDay: string | null;
}

export interface ContractCard extends ContractDefinition {
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface ContractBoard {
  dayKey: string;
  weekKey: string;
  streak: number;
  daily: ContractCard[];
  weekly: ContractCard[];
  nextDailyResetAt: string;
  nextWeeklyResetAt: string;
}

export type ContractDelta = Partial<Record<ContractMetric, number>>;

const ZERO_REWARD: ContractReward = { scrap: 0, water: 0, data: 0, cores: 0 };

export const CONTRACT_DEFINITIONS: Record<ContractId, ContractDefinition> = {
  'daily-extract': {
    id: 'daily-extract', cadence: 'daily', metric: 'extractions',
    title: '안전 귀환', description: '레드 존 화물을 1회 추출하십시오.',
    target: 1, reward: { ...ZERO_REWARD, data: 8 },
  },
  'daily-scrap': {
    id: 'daily-scrap', cadence: 'daily', metric: 'scrapExtracted',
    title: '정크 러너', description: '고철 60개를 쉘터로 반입하십시오.',
    target: 60, reward: { ...ZERO_REWARD, water: 20, data: 5 },
  },
  'daily-data': {
    id: 'daily-data', cadence: 'daily', metric: 'dataExtracted',
    title: '잃어버린 기록', description: '구시대 데이터 12개를 추출하십시오.',
    target: 12, reward: { ...ZERO_REWARD, scrap: 60 },
  },
  'daily-kills': {
    id: 'daily-kills', cadence: 'daily', metric: 'kills',
    title: '감시망 절단', description: '적대 개체 20기를 제거하십시오.',
    target: 20, reward: { ...ZERO_REWARD, data: 10 },
  },
  'daily-operation': {
    id: 'daily-operation', cadence: 'daily', metric: 'operationsCompleted',
    title: '작전 완수', description: '보스를 격파하고 작전을 완료하십시오.',
    target: 1, reward: { ...ZERO_REWARD, cores: 1 },
  },
  'weekly-extract': {
    id: 'weekly-extract', cadence: 'weekly', metric: 'extractions',
    title: '생존 회랑', description: '한 주 동안 화물을 5회 추출하십시오.',
    target: 5, reward: { ...ZERO_REWARD, data: 20, cores: 3 },
  },
  'weekly-kills': {
    id: 'weekly-kills', cadence: 'weekly', metric: 'kills',
    title: '기계 군단 소탕', description: '한 주 동안 적대 개체 100기를 제거하십시오.',
    target: 100, reward: { ...ZERO_REWARD, scrap: 200, cores: 3 },
  },
  'weekly-operations': {
    id: 'weekly-operations', cadence: 'weekly', metric: 'operationsCompleted',
    title: '베테랑 오퍼레이티브', description: '한 주 동안 작전을 3회 완료하십시오.',
    target: 3, reward: { ...ZERO_REWARD, data: 30, cores: 4 },
  },
};

const DAILY_POOL = CONTRACT_IDS.filter((id) => CONTRACT_DEFINITIONS[id].cadence === 'daily');
const WEEKLY_POOL = CONTRACT_IDS.filter((id) => CONTRACT_DEFINITIONS[id].cadence === 'weekly');
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1_000;

export function createContractState(now = new Date()): ContractState {
  const { dayKey, weekKey } = contractPeriodKeys(now);
  return {
    dayKey,
    weekKey,
    daily: assignedProgress(DAILY_POOL, dayKey, 3),
    weekly: assignedProgress(WEEKLY_POOL, weekKey, 2),
    streak: 0,
    lastActiveDay: null,
  };
}

export function normalizeContractState(value: unknown, now = new Date()): ContractState {
  const base = createContractState(now);
  if (!value || typeof value !== 'object') return base;
  const candidate = value as Partial<ContractState>;
  const normalized: ContractState = {
    dayKey: typeof candidate.dayKey === 'string' ? candidate.dayKey : base.dayKey,
    weekKey: typeof candidate.weekKey === 'string' ? candidate.weekKey : base.weekKey,
    daily: normalizeProgress(candidate.daily, 'daily'),
    weekly: normalizeProgress(candidate.weekly, 'weekly'),
    streak: Number.isInteger(candidate.streak) ? Math.max(0, Math.min(365, Number(candidate.streak))) : 0,
    lastActiveDay: typeof candidate.lastActiveDay === 'string' ? candidate.lastActiveDay : null,
  };
  return refreshContractState(normalized, now);
}

export function refreshContractState(state: ContractState, now = new Date()): ContractState {
  const { dayKey, weekKey } = contractPeriodKeys(now);
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.daily = assignedProgress(DAILY_POOL, dayKey, 3);
  } else {
    state.daily = reconcileAssignedProgress(state.daily, DAILY_POOL, dayKey, 3);
  }
  if (state.weekKey !== weekKey) {
    state.weekKey = weekKey;
    state.weekly = assignedProgress(WEEKLY_POOL, weekKey, 2);
  } else {
    state.weekly = reconcileAssignedProgress(state.weekly, WEEKLY_POOL, weekKey, 2);
  }
  return state;
}

export function advanceContracts(state: ContractState, delta: ContractDelta, now = new Date()): ContractState {
  refreshContractState(state, now);
  for (const progress of [...state.daily, ...state.weekly]) {
    if (progress.claimed) continue;
    const definition = CONTRACT_DEFINITIONS[progress.id];
    const amount = Math.max(0, Math.floor(delta[definition.metric] ?? 0));
    if (amount > 0) progress.progress = Math.min(definition.target, progress.progress + amount);
  }
  return state;
}

export function claimContract(
  state: ContractState,
  contractId: ContractId,
  now = new Date(),
): { reward: ContractReward; streakBonus: ContractReward | null } {
  refreshContractState(state, now);
  const progress = [...state.daily, ...state.weekly].find((item) => item.id === contractId);
  if (!progress) throw new Error('CONTRACT_NOT_ACTIVE');
  const definition = CONTRACT_DEFINITIONS[contractId];
  if (progress.progress < definition.target) throw new Error('CONTRACT_NOT_COMPLETE');
  if (progress.claimed) throw new Error('CONTRACT_ALREADY_CLAIMED');
  progress.claimed = true;

  let streakBonus: ContractReward | null = null;
  if (definition.cadence === 'daily' && state.lastActiveDay !== state.dayKey) {
    const consecutive = state.lastActiveDay !== null && dayDistance(state.lastActiveDay, state.dayKey) === 1;
    state.streak = consecutive ? Math.min(365, state.streak + 1) : 1;
    state.lastActiveDay = state.dayKey;
    if (state.streak % 7 === 0) streakBonus = { ...ZERO_REWARD, cores: 2 };
    else if (state.streak % 3 === 0) streakBonus = { ...ZERO_REWARD, data: 15 };
  }
  return { reward: { ...definition.reward }, streakBonus };
}

export function buildContractBoard(state: ContractState, now = new Date()): ContractBoard {
  refreshContractState(state, now);
  const toCard = (progress: ContractProgress): ContractCard => {
    const definition = CONTRACT_DEFINITIONS[progress.id];
    return {
      ...definition,
      reward: { ...definition.reward },
      progress: progress.progress,
      completed: progress.progress >= definition.target,
      claimed: progress.claimed,
    };
  };
  return {
    dayKey: state.dayKey,
    weekKey: state.weekKey,
    streak: state.streak,
    daily: state.daily.map(toCard),
    weekly: state.weekly.map(toCard),
    nextDailyResetAt: nextDailyReset(now).toISOString(),
    nextWeeklyResetAt: nextWeeklyReset(now).toISOString(),
  };
}

export function contractPeriodKeys(now = new Date()): { dayKey: string; weekKey: string } {
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS);
  const dayKey = seoul.toISOString().slice(0, 10);
  const weekday = seoul.getUTCDay() || 7;
  const monday = new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() - weekday + 1));
  return { dayKey, weekKey: monday.toISOString().slice(0, 10) };
}

function assignedProgress(pool: readonly ContractId[], key: string, count: number): ContractProgress[] {
  const offset = stableHash(key) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_unused, index) => ({
    id: pool[(offset + index) % pool.length],
    progress: 0,
    claimed: false,
  }));
}

function reconcileAssignedProgress(
  current: ContractProgress[],
  pool: readonly ContractId[],
  key: string,
  count: number,
): ContractProgress[] {
  const previous = new Map(current.map((progress) => [progress.id, progress]));
  return assignedProgress(pool, key, count).map((assigned) => {
    const saved = previous.get(assigned.id);
    return saved ? { id: saved.id, progress: saved.progress, claimed: saved.claimed } : assigned;
  });
}

function normalizeProgress(value: unknown, cadence: ContractCadence): ContractProgress[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ContractId>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<ContractProgress>;
    if (
      !CONTRACT_IDS.includes(candidate.id as ContractId)
      || CONTRACT_DEFINITIONS[candidate.id as ContractId].cadence !== cadence
      || seen.has(candidate.id as ContractId)
    ) return [];
    seen.add(candidate.id as ContractId);
    const definition = CONTRACT_DEFINITIONS[candidate.id as ContractId];
    return [{
      id: candidate.id as ContractId,
      progress: Number.isFinite(candidate.progress)
        ? Math.max(0, Math.min(definition.target, Math.floor(Number(candidate.progress)))) : 0,
      claimed: candidate.claimed === true,
    }];
  });
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dayDistance(previous: string, current: string): number {
  const previousTime = Date.parse(`${previous}T00:00:00.000Z`);
  const currentTime = Date.parse(`${current}T00:00:00.000Z`);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return Number.POSITIVE_INFINITY;
  return Math.round((currentTime - previousTime) / 86_400_000);
}

function nextDailyReset(now: Date): Date {
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS);
  return new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() + 1) - SEOUL_OFFSET_MS);
}

function nextWeeklyReset(now: Date): Date {
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS);
  const weekday = seoul.getUTCDay() || 7;
  const daysUntilMonday = 8 - weekday;
  return new Date(Date.UTC(
    seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() + daysUntilMonday,
  ) - SEOUL_OFFSET_MS);
}
