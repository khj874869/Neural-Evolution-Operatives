export type TacticalOrder =
  | 'DRAW_AGGRO'
  | 'FLANK'
  | 'HOLD'
  | 'REGROUP'
  | 'HEAL'
  | 'FOCUS'
  | 'SCAVENGE'
  | 'UNKNOWN';

export interface ParsedCommand {
  order: TacticalOrder;
  confidence: number;
  targetHint?: string;
}

export interface TacticalCommandFeedback {
  order: TacticalOrder;
  applied: boolean;
  message: string;
  source: 'local' | 'server';
  durationMs?: number;
  cooldownMs?: number;
}

export interface TacticalCommandPreset {
  order: Exclude<TacticalOrder, 'UNKNOWN'>;
  label: string;
  hint: string;
  command: string;
}

export const TACTICAL_ORDER_DURATION_MS = 9_000;
export const TACTICAL_HEAL_AMOUNT = 24;
export const TACTICAL_HEAL_COOLDOWN_MS = 40_000;
export const TACTICAL_FOCUS_DAMAGE_MULTIPLIER = 1.15;
export const TACTICAL_SCAVENGE_RADIUS = 180;

export const TACTICAL_COMMAND_PRESETS: readonly TacticalCommandPreset[] = [
  { order: 'REGROUP', label: '집결', hint: '분대가 플레이어에게 복귀', command: '모두 내 쪽으로 복귀해' },
  { order: 'FOCUS', label: '집중', hint: '강적에게 화력 집중', command: '강한 적을 집중 공격해' },
  { order: 'SCAVENGE', label: '회수', hint: '주변 자원 탐색·수집', command: '주변 자원을 찾아 회수해' },
  { order: 'HEAL', label: '회복', hint: 'Support 응급 치료 요청', command: '루멘, 지금 치료해줘' },
] as const;

const TACTICAL_ORDERS: readonly TacticalOrder[] = [
  'DRAW_AGGRO', 'FLANK', 'HOLD', 'REGROUP', 'HEAL', 'FOCUS', 'SCAVENGE', 'UNKNOWN',
] as const;

export function isTacticalOrder(value: unknown): value is TacticalOrder {
  return typeof value === 'string' && TACTICAL_ORDERS.includes(value as TacticalOrder);
}

const PATTERNS: ReadonlyArray<readonly [TacticalOrder, RegExp]> = [
  ['DRAW_AGGRO', /어그로|시선.*끌|도발|draw.*(aggro|fire)|distract/i],
  ['FLANK', /우회|뒤치|측면|포위|flank|go around/i],
  ['HOLD', /대기|엄폐|자리.*지|멈춰|hold|stay|cover/i],
  ['REGROUP', /모여|복귀|내.*쪽|따라와|regroup|come back|follow/i],
  ['HEAL', /치료|회복|힐|살려|heal|medic/i],
  ['FOCUS', /집중.*(사격|공격)|강한.*적|우선.*공격|저놈|보스|방패병|focus|target/i],
  ['SCAVENGE', /파밍|수집|회수|고철|탄피|자원.*찾|찾아|scavenge|loot/i],
];

export function parseTacticalCommand(input: string): ParsedCommand {
  const normalized = input.trim();
  for (const [order, pattern] of PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        order,
        confidence: normalized.length > 8 ? 0.92 : 0.76,
        targetHint: extractTarget(normalized),
      };
    }
  }
  return { order: 'UNKNOWN', confidence: 0.2 };
}

function extractTarget(input: string): string | undefined {
  const match = input.match(/(방패병|저격수|돌격병|드론|보스|암살자|강한 적|sniper|brute|drone|boss)/i);
  return match?.[0];
}
