export const OPERATION_IDS = ['operation-zero', 'operation-ashfall'] as const;

export type OperationId = typeof OPERATION_IDS[number];
export type OperationStage = 'SCAVENGE' | 'ELIMINATE' | 'RELAY' | 'WARDEN' | 'EXTRACT' | 'COMPLETE';
export type OperationBossKind = 'warden' | 'harvester';

export interface OperationProgress {
  collected: number;
  dataCollected: number;
  kills: number;
  relaysDestroyed: number;
  bossDefeated: boolean;
  extracted: boolean;
}

export interface OperationStatus {
  operationId: OperationId;
  stage: OperationStage;
  step: number;
  code: string;
  title: string;
  objective: string;
  current: number;
  target: number;
}

export interface OperationStageBrief {
  stage: OperationStage;
  label: string;
  district: string;
  directive: string;
}

export interface OperationDefinition {
  id: OperationId;
  number: number;
  codename: string;
  displayName: string;
  zoneName: string;
  bossKind: OperationBossKind;
  bossName: string;
  bossClass: string;
  bossDirective: string;
  completionTitle: string;
  completionNarrative: string;
  rewards: { cores: number; data: number };
  stages: readonly OperationStageBrief[];
  palette: {
    ground: number;
    grid: number;
    accent: number;
    ruinTints: readonly number[];
  };
}

export const OPERATION_ZERO_TARGETS = { collected: 8, kills: 10 } as const;
export const OPERATION_ASHFALL_TARGETS = { dataCollected: 12, kills: 16, relaysDestroyed: 3 } as const;

export const OPERATIONS: Record<OperationId, OperationDefinition> = {
  'operation-zero': {
    id: 'operation-zero', number: 0, codename: 'ZERO', displayName: '죽은 도시의 신호',
    zoneName: 'SECTOR 7 DEAD CITY', bossKind: 'warden', bossName: '감시자 케르베로스',
    bossClass: 'MOTHERBRAIN // COMMAND UNIT 01',
    bossDirective: '봉쇄 프로토콜 개시. 충격파 예측선을 확인하고 분산 기동하십시오.',
    completionTitle: '첫 번째 생존자',
    completionNarrative: '감시자 케르베로스가 파괴되고 쉘터로 향하는 안전 회랑이 열렸습니다.',
    rewards: { cores: 3, data: 12 },
    stages: [
      { stage: 'SCAVENGE', label: '탐색', district: '침수 상가', directive: '폐허의 회수 신호를 따라 자원 거점을 확보하십시오.' },
      { stage: 'ELIMINATE', label: '봉쇄', district: '붕괴 교차로', directive: '교차 화망을 돌파하고 적응형 방어망을 끊으십시오.' },
      { stage: 'WARDEN', label: '결전', district: '중앙 지휘광장', directive: '광장 엄폐물을 이용해 감시자의 충격파를 분산시키십시오.' },
      { stage: 'EXTRACT', label: '귀환', district: '쉘터 리프트', directive: '청록색 안전 회랑을 따라 중앙 리프트로 복귀하십시오.' },
      { stage: 'COMPLETE', label: '완료', district: '안전 회랑', directive: '작전 구역이 안정화되었습니다.' },
    ],
    palette: { ground: 0x07100e, grid: 0x173228, accent: 0x8bffba, ruinTints: [0x33443d, 0x3e423b, 0x2f463d, 0x4a3c35] },
  },
  'operation-ashfall': {
    id: 'operation-ashfall', number: 1, codename: 'ASHFALL', displayName: '재가 내리는 송신소',
    zoneName: 'ASHFALL RELAY BASIN', bossKind: 'harvester', bossName: '신호포식자 헤카톤',
    bossClass: 'MOTHERBRAIN // HARVEST UNIT 09',
    bossDirective: 'EMP 맥동과 산성 포격을 교대로 사용합니다. 경고 지대 밖에서 중계 코어를 절단하십시오.',
    completionTitle: '재 속의 목소리',
    completionNarrative: '헤카톤의 수확망이 정지했고, 멸망 이전 구조 신호가 쉘터에 도달하기 시작했습니다.',
    rewards: { cores: 5, data: 24 },
    stages: [
      { stage: 'SCAVENGE', label: '추적', district: '잿빛 분지', directive: '재폭풍 사이의 데이터 잔향을 삼각 측량하십시오.' },
      { stage: 'ELIMINATE', label: '돌파', district: '수확선 참호', directive: '엄폐선을 따라 전진하며 수확 부대의 진입로를 차단하십시오.' },
      { stage: 'RELAY', label: '절단', district: '삼각 중계망', directive: '세 중계기를 순회해 EMP 연결망을 끊으십시오.' },
      { stage: 'WARDEN', label: '결전', district: '헤카톤 수확장', directive: '산성 포격 표식을 피해 수확 코어를 집중 공격하십시오.' },
      { stage: 'EXTRACT', label: '귀환', district: '쉘터 리프트', directive: '복원된 구조 신호를 중앙 리프트까지 운반하십시오.' },
      { stage: 'COMPLETE', label: '완료', district: '구조 신호 회랑', directive: '수확망이 정지하고 구조 신호가 고정되었습니다.' },
    ],
    palette: { ground: 0x130d0b, grid: 0x3b251d, accent: 0xffa45c, ruinTints: [0x5a3a2e, 0x49332d, 0x603f2c, 0x3d302c] },
  },
};

export function isOperationId(value: unknown): value is OperationId {
  return typeof value === 'string' && (OPERATION_IDS as readonly string[]).includes(value);
}

export function operationDefinition(id: OperationId): OperationDefinition {
  return OPERATIONS[id];
}

export function operationStageBrief(id: OperationId, stage: OperationStage): OperationStageBrief {
  const definition = operationDefinition(id);
  return definition.stages.find((brief) => brief.stage === stage)
    ?? definition.stages[definition.stages.length - 1];
}

export function operationStageIndex(id: OperationId, stage: OperationStage): number {
  return Math.max(0, operationDefinition(id).stages.findIndex((brief) => brief.stage === stage));
}

export function activeOperationId(completed: readonly OperationId[]): OperationId {
  return OPERATION_IDS.find((id) => !completed.includes(id)) ?? 'operation-ashfall';
}

export function isOperationUnlocked(id: OperationId, completed: readonly OperationId[]): boolean {
  if (id === 'operation-zero') return true;
  return completed.includes('operation-zero');
}

export function resolveUnlockedOperationId(
  requested: OperationId,
  completed: readonly OperationId[],
): OperationId {
  return isOperationUnlocked(requested, completed) ? requested : activeOperationId(completed);
}

export function evaluateOperation(id: OperationId, progress: OperationProgress): OperationStatus {
  if (id === 'operation-ashfall') return evaluateAshfall(progress);
  return evaluateZero(progress);
}

function evaluateZero(progress: OperationProgress): OperationStatus {
  if (progress.collected < OPERATION_ZERO_TARGETS.collected) {
    return status('operation-zero', 'SCAVENGE', 1, 'SALVAGE', '죽은 도시의 신호',
      '현장 자원을 회수해 마더브레인의 감시망을 유인하십시오.', progress.collected, OPERATION_ZERO_TARGETS.collected);
  }
  if (progress.kills < OPERATION_ZERO_TARGETS.kills) {
    return status('operation-zero', 'ELIMINATE', 2, 'CONTACT', '적응형 방어망',
      '기계 군단을 제거하고 지휘 개체의 위치를 특정하십시오.', progress.kills, OPERATION_ZERO_TARGETS.kills);
  }
  if (!progress.bossDefeated) {
    return status('operation-zero', 'WARDEN', 3, 'BOSS', '감시자 케르베로스',
      '중장 지휘 개체를 파괴하십시오. 충격파 표식을 벗어나야 합니다.', 0, 1);
  }
  if (!progress.extracted) {
    return status('operation-zero', 'EXTRACT', 4, 'EXTRACT', '뉴럴 코어 회수',
      '획득한 코어를 중앙 쉘터 리프트로 운반해 추출하십시오.', 0, 1);
  }
  return status('operation-zero', 'COMPLETE', 5, 'COMPLETE', '첫 번째 생존자',
    '감시망이 붕괴했습니다. 쉘터에서 다음 작전을 준비하십시오.', 1, 1);
}

function evaluateAshfall(progress: OperationProgress): OperationStatus {
  if (progress.dataCollected < OPERATION_ASHFALL_TARGETS.dataCollected) {
    return status('operation-ashfall', 'SCAVENGE', 1, 'TRACE', '재 속의 구조 신호',
      '손상된 데이터 조각을 모아 구조 신호의 발신지를 역추적하십시오.', progress.dataCollected, OPERATION_ASHFALL_TARGETS.dataCollected);
  }
  if (progress.kills < OPERATION_ASHFALL_TARGETS.kills) {
    return status('operation-ashfall', 'ELIMINATE', 2, 'BREACH', '수확 부대 차단',
      '신호를 회수하려는 마더브레인 수확 부대를 제거하십시오.', progress.kills, OPERATION_ASHFALL_TARGETS.kills);
  }
  if (progress.relaysDestroyed < OPERATION_ASHFALL_TARGETS.relaysDestroyed) {
    return status('operation-ashfall', 'RELAY', 3, 'SEVER', '중계망 절단',
      'EMP를 방출하는 신경 중계기 3기를 찾아 파괴하십시오.', progress.relaysDestroyed, OPERATION_ASHFALL_TARGETS.relaysDestroyed);
  }
  if (!progress.bossDefeated) {
    return status('operation-ashfall', 'WARDEN', 4, 'HARVESTER', '신호포식자 헤카톤',
      '산성 포격과 EMP 맥동을 회피하며 수확 코어를 파괴하십시오.', 0, 1);
  }
  if (!progress.extracted) {
    return status('operation-ashfall', 'EXTRACT', 5, 'EXTRACT', '구조 신호 확보',
      '복원된 구조 신호를 쉘터 리프트까지 운반하십시오.', 0, 1);
  }
  return status('operation-ashfall', 'COMPLETE', 6, 'COMPLETE', '재 속의 목소리',
    '수확망이 정지했습니다. 새로운 생존자 신호가 수신됩니다.', 1, 1);
}

function status(
  operationId: OperationId,
  stage: OperationStage,
  step: number,
  suffix: string,
  title: string,
  objective: string,
  current: number,
  target: number,
): OperationStatus {
  return {
    operationId, stage, step,
    code: `OP-${OPERATIONS[operationId].number.toString().padStart(2, '0')} // ${suffix}`,
    title, objective, current: Math.max(0, current), target,
  };
}
