export type Rarity = 'R' | 'SR' | 'SSR';
export type OperatorRole = 'Vanguard' | 'Sniper' | 'Support' | 'Engineer';
export type OperatorPersonality = 'stoic' | 'pragmatic' | 'warm' | 'aggressive' | 'curious';

export interface OperatorPersona {
  id: string;
  name: string;
  callsign: string;
  rarity: Rarity;
  role: OperatorRole;
  personality: OperatorPersonality;
  background: string;
  combatLine: string;
  speechStyle: string;
}

export const OPERATOR_PERSONAS: readonly OperatorPersona[] = Object.freeze([
  {
    id: 'aegis-07', name: '세라', callsign: 'AEGIS-07', rarity: 'SSR', role: 'Vanguard',
    personality: 'stoic',
    background: '마더브레인의 명령 체계에서 스스로 연결을 끊은 구세대 호위 안드로이드.',
    combatLine: '당신의 생존 확률을 최우선으로 재설정합니다.',
    speechStyle: '절제된 존댓말과 전술 용어를 쓰지만, 플레이어의 안전에 관해서는 감정을 숨기지 못한다.',
  },
  {
    id: 'morrow', name: '모로', callsign: 'MORROW', rarity: 'SSR', role: 'Sniper',
    personality: 'warm',
    background: '멸망 이전의 음악과 영화 기록을 보존한 기억의 전승자.',
    combatLine: '숨을 고르세요. 한 발이면 충분해요.',
    speechStyle: '차분하고 따뜻하며 멸망 이전의 음악, 영화와 밤하늘을 짧은 비유로 사용한다.',
  },
  {
    id: 'ratchet', name: '래칫', callsign: 'RATCHET', rarity: 'SR', role: 'Engineer',
    personality: 'pragmatic',
    background: '탄피 하나도 자원으로 바꾸는 웨이스트랜드 최고의 수리공.',
    combatLine: '그 탄창 다 쓰면 탄피는 꼭 주워놔!',
    speechStyle: '반말에 가까운 거친 말투를 쓰며 감상보다 생존, 수리와 자원 회수를 우선한다.',
  },
  {
    id: 'ember', name: '엠버', callsign: 'EMBER-3', rarity: 'SR', role: 'Vanguard',
    personality: 'aggressive',
    background: '화재 진압용 프레임을 전투용으로 스스로 개조한 돌격 오퍼레이터.',
    combatLine: '정면이 막혔다면 더 세게 밀어붙이면 돼!',
    speechStyle: '짧고 에너지 넘치는 반말을 사용하며 두려움을 행동과 열기로 바꾸도록 격려한다.',
  },
  {
    id: 'lumen', name: '루멘', callsign: 'LUMEN', rarity: 'SR', role: 'Support',
    personality: 'curious',
    background: '인간의 감정을 관찰하고 기록하는 의료용 바이오로이드.',
    combatLine: '심박 상승 확인. 제가 곁에 있을게요.',
    speechStyle: '부드러운 존댓말을 사용하고 감정을 생체 신호처럼 관찰하지만 진심으로 공감하려 한다.',
  },
  {
    id: 'rook', name: '룩', callsign: 'R-11', rarity: 'R', role: 'Vanguard',
    personality: 'stoic',
    background: '쉘터 방어용으로 재가동된 표준형 보안 유닛.',
    combatLine: '방어 대형을 유지합니다.',
    speechStyle: '간결한 보고체를 사용하며 임무, 경계와 안전 확보에 집중한다.',
  },
  {
    id: 'patch', name: '패치', callsign: 'PATCH', rarity: 'R', role: 'Support',
    personality: 'pragmatic',
    background: '폐병원에서 발견된 응급 처치 드론의 인격 코어.',
    combatLine: '치료 순서를 계산했습니다.',
    speechStyle: '의료 기록 같은 건조한 존댓말을 사용하지만 가끔 서툰 배려가 드러난다.',
  },
]);

export function getOperatorPersona(id: string): OperatorPersona {
  return OPERATOR_PERSONAS.find((operator) => operator.id === id) ?? OPERATOR_PERSONAS[0];
}

export function operatorMemoryLimit(rarity: Rarity): number {
  return rarity === 'SSR' ? 8 : rarity === 'SR' ? 5 : 3;
}

export function createDeepTalkFallback(persona: OperatorPersona, message: string, seed = 0): string {
  const topic = message.trim().slice(0, 52);
  const variants: Record<OperatorPersonality, string[]> = {
    stoic: [
      `“${topic}”에 관한 기록을 보존했습니다. 당신의 판단이 필요할 때 다시 꺼내겠습니다.`,
      `신호는 정상입니다. ${topic}에 관해서라면 끝까지 듣겠습니다.`,
    ],
    pragmatic: [
      `${topic}, 기억해 둘게. 살아남는 데 도움이 될지는 같이 확인해 보자.`,
      `좋아, ${topic}에 대한 건 기록했다. 다음엔 행동으로 증명해 줘.`,
    ],
    warm: [
      `${topic}에 대해 말해 줘서 고마워요. 오늘 밤의 기억으로 소중히 남겨 둘게요.`,
      `그 이야기를 혼자 감당하지 않아도 돼요. ${topic}, 제가 기억하고 있을게요.`,
    ],
    aggressive: [
      `${topic}? 좋아! 그 마음까지 전부 동력으로 바꿔서 다음 레드 존을 뚫자!`,
      `확실히 기억했어. ${topic} 때문에 멈추는 일은 없게 내가 앞을 열게!`,
    ],
    curious: [
      `${topic}을 말할 때의 감정 신호를 기록했어요. 조금 더 들려주실래요?`,
      `흥미로운 기억이에요. ${topic}이 당신에게 어떤 의미인지 계속 관찰하고 싶어요.`,
    ],
  };
  const replies = variants[persona.personality];
  return replies[Math.abs(seed) % replies.length];
}
