export type OperationStage = 'SCAVENGE' | 'ELIMINATE' | 'WARDEN' | 'EXTRACT' | 'COMPLETE';

export interface OperationProgress {
  collected: number;
  kills: number;
  bossDefeated: boolean;
  extracted: boolean;
}

export interface OperationStatus {
  stage: OperationStage;
  step: number;
  code: string;
  title: string;
  objective: string;
  current: number;
  target: number;
}

export const OPERATION_ZERO_TARGETS = { collected: 8, kills: 10 } as const;

export function evaluateOperationZero(progress: OperationProgress): OperationStatus {
  if (progress.collected < OPERATION_ZERO_TARGETS.collected) {
    return {
      stage: 'SCAVENGE', step: 1, code: 'OP-00 // SALVAGE', title: '죽은 도시의 신호',
      objective: '현장 자원을 회수해 마더브레인의 감시망을 유인하십시오.',
      current: Math.max(0, progress.collected), target: OPERATION_ZERO_TARGETS.collected,
    };
  }
  if (progress.kills < OPERATION_ZERO_TARGETS.kills) {
    return {
      stage: 'ELIMINATE', step: 2, code: 'OP-00 // CONTACT', title: '적응형 방어망',
      objective: '기계 군단을 제거하고 지휘 개체의 위치를 특정하십시오.',
      current: Math.max(0, progress.kills), target: OPERATION_ZERO_TARGETS.kills,
    };
  }
  if (!progress.bossDefeated) {
    return {
      stage: 'WARDEN', step: 3, code: 'OP-00 // BOSS', title: '감시자 케르베로스',
      objective: '중장 지휘 개체를 파괴하십시오. 충격파 표식을 벗어나야 합니다.',
      current: 0, target: 1,
    };
  }
  if (!progress.extracted) {
    return {
      stage: 'EXTRACT', step: 4, code: 'OP-00 // EXTRACT', title: '뉴럴 코어 회수',
      objective: '획득한 코어를 중앙 쉘터 리프트로 운반해 추출하십시오.',
      current: 0, target: 1,
    };
  }
  return {
    stage: 'COMPLETE', step: 5, code: 'OP-00 // COMPLETE', title: '첫 번째 생존자',
    objective: '감시망이 붕괴했습니다. 쉘터에서 다음 작전을 준비하십시오.',
    current: 1, target: 1,
  };
}
