import type { OperatorDefinition } from '../data/operators';
import type { TacticalOrder } from './TacticalCommand';

const orderReplies: Record<TacticalOrder, string[]> = {
  DRAW_AGGRO: ['시선을 고정시키겠습니다. 지금 우회하세요.', '제가 전면을 맡죠. 신호에 맞춰 움직이세요.'],
  FLANK: ['측면 경로 확인. 사각으로 진입합니다.', '발소리를 낮추고 우회할게요.'],
  HOLD: ['현 위치 고정. 사격각을 확보합니다.', '엄폐 유지. 접근하는 적부터 처리하죠.'],
  REGROUP: ['링크 거리 회복 중. 곁으로 복귀합니다.', '대형을 다시 맞추겠습니다.'],
  HEAL: ['생체 신호가 불안정합니다. 응급 처치 시작.', '가만히 있어요. 이번에는 제가 지킬게요.'],
  FOCUS: ['우선 표적 확인. 화력을 집중합니다.', '약점 좌표를 공유합니다. 하나씩 지우죠.'],
  SCAVENGE: ['쓸 만한 부품을 표시하겠습니다.', '자원 탐색 모드. 탄피도 버리지 마세요.'],
  UNKNOWN: ['명령을 전술 언어로 해석하지 못했어요. 짧게 다시 말해 주세요.', '링크에 잡음이 있습니다. 목표를 지정해 주세요.'],
};

export function createPersonaReply(operator: OperatorDefinition, order: TacticalOrder, seed = 0): string {
  const base = orderReplies[order][seed % orderReplies[order].length];
  switch (operator.personality) {
    case 'aggressive': return `${base} 선두는 제가 잡습니다!`;
    case 'pragmatic': return `${base} 그리고 회수품은 놓치지 마.`;
    case 'warm': return `${base} 무리하지는 말아요.`;
    case 'curious': return `${base} 당신의 반응도 기록할게요.`;
    default: return base;
  }
}
