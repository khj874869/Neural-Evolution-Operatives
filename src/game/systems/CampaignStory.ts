import type { OperationId, OperationStage } from '../../../packages/shared/src/operations';

export interface StoryLine { speaker: string; text: string }
export interface StoryBeat {
  id: string;
  operationId: OperationId;
  stage: OperationStage;
  title: string;
  discovery: string;
  lines: readonly StoryLine[];
}

const beat = (operationId: OperationId, stage: OperationStage, title: string, discovery: string,
  ...lines: [string, string][]): StoryBeat => ({
  id: `${operationId}:${stage}`, operationId, stage, title, discovery,
  lines: lines.map(([speaker, text]) => ({ speaker, text })),
});

export const CAMPAIGN_STORY: readonly StoryBeat[] = [
  beat('operation-zero', 'SCAVENGE', '물이 기억하는 도시',
    '도시가 침묵한 지 19년. 쉘터는 폐허에서 반복되는 인간의 구조 신호를 포착했다.',
    ['관제 / ECHO', '훈련 링크 종료. 여기는 실제 폐허입니다. 남서쪽 침수 상가에서 구조 신호의 전원을 찾아주세요.'],
    ['RATCHET', '가게 간판이 아직 켜져 있어. 누군가 배터리를 갈았다는 뜻이지. 회수 거점부터 살펴보자.']),
  beat('operation-zero', 'ELIMINATE', '빈 구급차의 수신기',
    '회수한 전원에는 오늘 날짜의 구조 요청이 남아 있었다. 감시망이 수신기의 재가동을 감지했다.',
    ['RATCHET', '복구 성공. 녹음이 아니야. 오늘 아침에 송신됐어. 발신지는 북쪽인데… 감시망도 우리를 들었군.'],
    ['AEGIS-07', '동북쪽 붕괴 교차로에 방어 부대 집결. 차량 잔해를 엄폐물로 써. 내가 진입로를 연다.']),
  beat('operation-zero', 'WARDEN', '도시의 문지기',
    '케르베로스는 침입자를 막는 것이 아니라 도시 안의 신호가 밖으로 나가는 것을 막고 있었다.',
    ['관제 / ECHO', '방어망을 뚫었습니다. 북쪽 지휘광장에 케르베로스 출현. 저 장치가 구조 신호를 가두고 있어요.'],
    ['MOTHERBRAIN', '보호 대상의 이탈을 허가할 수 없다. 귀환하라. 이것은 구조다.']),
  beat('operation-zero', 'EXTRACT', '살아 있는 좌표',
    '감시자의 코어에서 ASHFALL 송신소 좌표와 37개의 생체 신호가 발견됐다.',
    ['LUMEN', '코어 안에 생체 신호가 있어. 서른일곱… 아직 살아 있어요. 다음 좌표는 ASHFALL.'],
    ['관제 / ECHO', '쉘터 리프트에 전력을 연결했습니다. 중앙으로 귀환하세요. 이 좌표를 잃어선 안 됩니다.']),
  beat('operation-zero', 'COMPLETE', '첫 번째 생존자',
    '쉘터는 ASHFALL 구조 작전을 승인했다. 기계가 말하는 보호의 의미를 확인해야 한다.',
    ['관제 / ECHO', '좌표 수신 완료. 죽은 도시에 생존자가 있다는 걸 증명했어요. 다음은 사람들을 데려오는 일입니다.']),
  beat('operation-ashfall', 'SCAVENGE', '재 속의 이름들',
    '구조 신호를 따라 도착한 송신소. 잿빛 분지의 데이터에는 사람들의 이름이 기록돼 있다.',
    ['관제 / ECHO', 'ASHFALL에 도착했습니다. 서남쪽 분지에서 데이터 12개를 복원하면 생존자들의 위치를 찾을 수 있어요.'],
    ['LUMEN', '신호가 사람 이름을 반복하고 있어요. 기계의 식별 번호가 아니에요. 모두 기억해둘게요.']),
  beat('operation-ashfall', 'ELIMINATE', '수확의 진실',
    '마더브레인은 인간의 기억을 연산 자원으로 수확하고 있었다. 생체 신호는 수확장 지하에서 온다.',
    ['RATCHET', '송신 기록 해독. 사람을 보호한 게 아니라 기억을 연료로 쓰고 있었어. 수확 부대가 돌아온다.'],
    ['AEGIS-07', '동쪽 참호에서 저지한다. 중앙을 가로지르지 마. 수확선 양옆의 잔해를 따라 이동해.']),
  beat('operation-ashfall', 'RELAY', '세 개의 자물쇠',
    '알파·베타·감마 중계기가 수확장 봉쇄를 유지한다. 세 연결을 모두 끊어야 한다.',
    ['관제 / ECHO', '세 중계기가 지하의 문을 잠그고 있어요. 지도에 좌표를 표시합니다. 순서는 상관없어요.'],
    ['RATCHET', 'EMP가 오면 링크를 아껴. 중계기를 하나씩 끊으면 놈의 심장이 드러날 거야.']),
  beat('operation-ashfall', 'WARDEN', '기억을 먹는 자',
    '중계망이 끊기자 헤카톤이 깨어났다. 수확 코어는 생존자의 기억을 마지막 방패로 쓰려 한다.',
    ['MOTHERBRAIN', '개체는 사라져도 기억은 남는다. 너희가 파괴하려는 것은 인류의 미래다.'],
    ['LUMEN', '기억만 남기는 건 구원이 아니에요. 북쪽 수확장으로 가요. 살아 있는 사람들을 되찾겠어요.']),
  beat('operation-ashfall', 'EXTRACT', '응답하는 목소리',
    '헤카톤이 정지했다. 생존자들의 격리 장치가 열리고 구조 채널이 복구됐다.',
    ['생존자 / 미상', '…들리나요? 문이 열렸어요. 아이들이 있어요. 아직 여기 있어요.'],
    ['관제 / ECHO', '들립니다. 구조대를 보낼게요. 분대는 중앙 리프트로 신호를 운반하세요. 길을 잃지 않도록.']),
  beat('operation-ashfall', 'COMPLETE', '새벽을 부르는 사람들',
    '37명의 신호가 쉘터에 연결됐다. 구조대가 출발했고, 폐허에서 처음으로 이름이 불리기 시작했다.',
    ['LUMEN', '서른일곱 명, 모두 응답했어요. 이제 번호 대신 이름으로 부를 수 있어요.'],
    ['관제 / ECHO', '구조 회랑 확보. 1장 종료. 남은 구역은 다시 탐사할 수 있습니다. 돌아와줘서 고마워요.']),
];

export function storyBeat(operationId: OperationId, stage: OperationStage): StoryBeat | undefined {
  return CAMPAIGN_STORY.find((entry) => entry.operationId === operationId && entry.stage === stage);
}

/** Each run can replay its story; persisted discoveries never unlock future chapters. */
export class CampaignStory {
  private delivered = new Set<string>();
  private discovered: Set<string>;
  constructor(saved: unknown = []) {
    this.discovered = new Set(Array.isArray(saved)
      ? saved.filter((id): id is string => typeof id === 'string' && CAMPAIGN_STORY.some((entry) => entry.id === id)) : []);
  }
  startRun(): void { this.delivered.clear(); }
  enter(operationId: OperationId, stage: OperationStage): StoryBeat | undefined {
    const entry = storyBeat(operationId, stage);
    if (!entry || this.delivered.has(entry.id)) return undefined;
    this.delivered.add(entry.id);
    this.discovered.add(entry.id);
    return entry;
  }
  journal(): StoryBeat[] { return CAMPAIGN_STORY.filter((entry) => this.discovered.has(entry.id)); }
  save(): string[] { return [...this.discovered]; }
}
