import {
  evaluateOperation,
  OPERATION_ZERO_TARGETS,
  type OperationProgress as CampaignProgress,
  type OperationStage,
  type OperationStatus,
} from '../../../packages/shared/src/operations';

export type { OperationStage, OperationStatus };
export { OPERATION_ZERO_TARGETS };

export interface OperationProgress {
  collected: number;
  kills: number;
  bossDefeated: boolean;
  extracted: boolean;
}

export function evaluateOperationZero(progress: OperationProgress): OperationStatus {
  const campaignProgress: CampaignProgress = {
    ...progress, dataCollected: 0, relaysDestroyed: 0,
  };
  return evaluateOperation('operation-zero', campaignProgress);
}
