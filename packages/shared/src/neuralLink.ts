export type NeuralLinkRole = 'Vanguard' | 'Sniper' | 'Support' | 'Engineer';

export interface NeuralLinkSkill {
  role: NeuralLinkRole;
  name: string;
  description: string;
  color: number;
}

export const NEURAL_LINK_MAX = 100;

export const NEURAL_LINK_SKILLS: Record<NeuralLinkRole, NeuralLinkSkill> = {
  Vanguard: {
    role: 'Vanguard', name: 'AEGIS OVERDRIVE',
    description: '보호막을 전개하고 근접한 적대 신호를 강제 붕괴시킵니다.', color: 0xffb75d,
  },
  Sniper: {
    role: 'Sniper', name: 'LAST LIGHT',
    description: '가장 위험한 적대 신호 세 개를 정밀 소거합니다.', color: 0x70a8ff,
  },
  Support: {
    role: 'Support', name: 'PULSE RESTORE',
    description: '생체 신호와 방사능 오염을 긴급 복원합니다.', color: 0x69e2cf,
  },
  Engineer: {
    role: 'Engineer', name: 'SCRAPSTORM',
    description: '전장 잔해를 즉시 회수 가능한 보급 자원으로 변환합니다.', color: 0xc9f456,
  },
};

const OPERATOR_ROLES: Record<string, NeuralLinkRole> = {
  'aegis-07': 'Vanguard', morrow: 'Sniper', ratchet: 'Engineer', ember: 'Vanguard',
  lumen: 'Support', rook: 'Vanguard', patch: 'Support',
};

export function neuralLinkLeader(squad: string[]): string {
  return squad.find((operatorId) => operatorId in OPERATOR_ROLES) ?? 'aegis-07';
}

export function neuralLinkSkill(operatorId: string): NeuralLinkSkill {
  return NEURAL_LINK_SKILLS[OPERATOR_ROLES[operatorId] ?? 'Vanguard'];
}

export function addNeuralCharge(current: number, amount: number): number {
  return Math.min(NEURAL_LINK_MAX, Math.max(0, current + amount));
}
