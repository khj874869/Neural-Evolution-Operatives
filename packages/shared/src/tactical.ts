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

export const TACTICAL_ORDER_DURATION_MS = 9_000;
export const TACTICAL_HEAL_AMOUNT = 24;
export const TACTICAL_HEAL_COOLDOWN_MS = 40_000;
export const TACTICAL_FOCUS_DAMAGE_MULTIPLIER = 1.15;
export const TACTICAL_SCAVENGE_RADIUS = 180;

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
