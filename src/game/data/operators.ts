export type Rarity = 'R' | 'SR' | 'SSR';
export type OperatorRole = 'Vanguard' | 'Sniper' | 'Support' | 'Engineer';

export interface OperatorDefinition {
  id: string;
  name: string;
  callsign: string;
  portrait: string;
  rarity: Rarity;
  role: OperatorRole;
  color: number;
  personality: 'stoic' | 'pragmatic' | 'warm' | 'aggressive' | 'curious';
  background: string;
  combatLine: string;
}

const portrait = (id: string): string => `${import.meta.env.BASE_URL}assets/operators/${id}.webp`;

export const OPERATORS: OperatorDefinition[] = [
  {
    id: 'aegis-07', name: '세라', callsign: 'AEGIS-07', portrait: portrait('aegis-07'), rarity: 'SSR', role: 'Vanguard',
    color: 0xf0b35d, personality: 'stoic',
    background: '마더브레인의 명령 체계에서 스스로 연결을 끊은 구세대 호위 안드로이드.',
    combatLine: '당신의 생존 확률을 최우선으로 재설정합니다.',
  },
  {
    id: 'morrow', name: '모로', callsign: 'MORROW', portrait: portrait('morrow'), rarity: 'SSR', role: 'Sniper',
    color: 0x70a8ff, personality: 'warm',
    background: '멸망 이전의 음악과 영화 기록을 보존한 기억의 전승자.',
    combatLine: '숨을 고르세요. 한 발이면 충분해요.',
  },
  {
    id: 'ratchet', name: '래칫', callsign: 'RATCHET', portrait: portrait('ratchet'), rarity: 'SR', role: 'Engineer',
    color: 0xc9f456, personality: 'pragmatic',
    background: '탄피 하나도 자원으로 바꾸는 웨이스트랜드 최고의 수리공.',
    combatLine: '그 탄창 다 쓰면 탄피는 꼭 주워놔!',
  },
  {
    id: 'ember', name: '엠버', callsign: 'EMBER-3', portrait: portrait('ember'), rarity: 'SR', role: 'Vanguard',
    color: 0xff6f5e, personality: 'aggressive',
    background: '화재 진압용 프레임을 전투용으로 스스로 개조한 돌격 오퍼레이터.',
    combatLine: '정면이 막혔다면 더 세게 밀어붙이면 돼!',
  },
  {
    id: 'lumen', name: '루멘', callsign: 'LUMEN', portrait: portrait('lumen'), rarity: 'SR', role: 'Support',
    color: 0x69e2cf, personality: 'curious',
    background: '인간의 감정을 관찰하고 기록하는 의료용 바이오로이드.',
    combatLine: '심박 상승 확인. 제가 곁에 있을게요.',
  },
  {
    id: 'rook', name: '룩', callsign: 'R-11', portrait: portrait('rook'), rarity: 'R', role: 'Vanguard',
    color: 0x9aa79f, personality: 'stoic',
    background: '쉘터 방어용으로 재가동된 표준형 보안 유닛.',
    combatLine: '방어 대형을 유지합니다.',
  },
  {
    id: 'patch', name: '패치', callsign: 'PATCH', portrait: portrait('patch'), rarity: 'R', role: 'Support',
    color: 0xb79ac8, personality: 'pragmatic',
    background: '폐병원에서 발견된 응급 처치 드론의 인격 코어.',
    combatLine: '치료 순서를 계산했습니다.',
  },
];

export const getOperator = (id: string): OperatorDefinition =>
  OPERATORS.find((operator) => operator.id === id) ?? OPERATORS[0];
