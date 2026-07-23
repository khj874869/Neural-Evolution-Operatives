import {
  getOperatorPersona, OPERATOR_PERSONAS, type OperatorPersona,
} from '../../../packages/shared/src/persona';

export type { OperatorRole, Rarity } from '../../../packages/shared/src/persona';

export interface OperatorDefinition extends OperatorPersona {
  portrait: string;
  color: number;
}

const portrait = (id: string): string => `${import.meta.env.BASE_URL}assets/operators/${id}.webp`;

const COLORS: Record<string, number> = {
  'aegis-07': 0xf0b35d,
  morrow: 0x70a8ff,
  ratchet: 0xc9f456,
  ember: 0xff6f5e,
  lumen: 0x69e2cf,
  rook: 0x9aa79f,
  patch: 0xb79ac8,
};

export const OPERATORS: OperatorDefinition[] = OPERATOR_PERSONAS.map((operator) => ({
  ...operator,
  portrait: portrait(operator.id),
  color: COLORS[operator.id] ?? 0x9aa79f,
}));

export const getOperator = (id: string): OperatorDefinition =>
  OPERATORS.find((operator) => operator.id === id)
  ?? { ...getOperatorPersona(id), portrait: portrait('aegis-07'), color: COLORS['aegis-07'] };
