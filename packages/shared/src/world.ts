import type { OperationId } from './operations.js';

export const WORLD_SIZE = 2_400;
export const EXTRACTION_POINT = Object.freeze({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });
export const PLAYER_COLLISION_RADIUS = 18;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WorldObstacle extends WorldPoint {
  id: string;
  width: number;
  height: number;
  kind: 'ruin' | 'wreck';
}

export interface MovementResult extends WorldPoint {
  blocked: boolean;
}

export const RELAY_POSITIONS: readonly WorldPoint[] = Object.freeze([
  Object.freeze({ x: 470, y: 520 }),
  Object.freeze({ x: WORLD_SIZE - 500, y: 620 }),
  Object.freeze({ x: WORLD_SIZE / 2 + 260, y: WORLD_SIZE - 470 }),
]);

const ZERO_COVER: readonly WorldObstacle[] = cover([
  ['zero-01', 650, 520, 220, 76, 'ruin'],
  ['zero-02', 960, 410, 78, 220, 'wreck'],
  ['zero-03', 1_420, 480, 250, 78, 'ruin'],
  ['zero-04', 1_820, 430, 82, 230, 'wreck'],
  ['zero-05', 430, 930, 210, 76, 'ruin'],
  ['zero-06', 820, 890, 78, 210, 'wreck'],
  ['zero-07', 1_560, 870, 230, 78, 'ruin'],
  ['zero-08', 1_980, 1_010, 190, 76, 'wreck'],
  ['zero-09', 480, 1_440, 78, 230, 'wreck'],
  ['zero-10', 880, 1_530, 230, 78, 'ruin'],
  ['zero-11', 1_520, 1_570, 78, 240, 'wreck'],
  ['zero-12', 1_940, 1_460, 220, 78, 'ruin'],
  ['zero-13', 650, 1_940, 250, 78, 'ruin'],
  ['zero-14', 1_070, 1_880, 82, 230, 'wreck'],
  ['zero-15', 1_690, 2_080, 240, 78, 'ruin'],
  ['zero-16', 2_070, 1_840, 78, 220, 'wreck'],
]);

const ASHFALL_COVER: readonly WorldObstacle[] = cover([
  ['ash-01', 650, 650, 280, 74, 'ruin'],
  ['ash-02', 940, 440, 74, 250, 'wreck'],
  ['ash-03', 1_450, 560, 280, 74, 'ruin'],
  ['ash-04', 1_800, 380, 74, 230, 'wreck'],
  ['ash-05', 560, 1_050, 74, 260, 'wreck'],
  ['ash-06', 900, 900, 240, 74, 'ruin'],
  ['ash-07', 1_520, 920, 74, 230, 'wreck'],
  ['ash-08', 1_930, 1_050, 250, 74, 'ruin'],
  ['ash-09', 430, 1_520, 240, 74, 'ruin'],
  ['ash-10', 850, 1_540, 74, 250, 'wreck'],
  ['ash-11', 1_500, 1_520, 260, 74, 'ruin'],
  ['ash-12', 1_950, 1_480, 74, 270, 'wreck'],
  ['ash-13', 590, 1_980, 290, 74, 'ruin'],
  ['ash-14', 1_090, 1_900, 74, 240, 'wreck'],
  ['ash-15', 1_750, 2_090, 260, 74, 'ruin'],
  ['ash-16', 2_100, 1_890, 74, 240, 'wreck'],
]);

const COVER_BY_OPERATION: Readonly<Record<OperationId, readonly WorldObstacle[]>> = Object.freeze({
  'operation-zero': ZERO_COVER,
  'operation-ashfall': ASHFALL_COVER,
});

export function worldObstacles(operationId: OperationId): readonly WorldObstacle[] {
  return COVER_BY_OPERATION[operationId];
}

export function isCircleBlocked(
  point: WorldPoint,
  radius: number,
  obstacles: readonly WorldObstacle[],
): boolean {
  return obstacles.some((obstacle) => {
    const halfWidth = obstacle.width / 2;
    const halfHeight = obstacle.height / 2;
    const closestX = clamp(point.x, obstacle.x - halfWidth, obstacle.x + halfWidth);
    const closestY = clamp(point.y, obstacle.y - halfHeight, obstacle.y + halfHeight);
    return Math.hypot(point.x - closestX, point.y - closestY) < radius;
  });
}

export function resolveCircleMovement(
  start: WorldPoint,
  delta: WorldPoint,
  radius: number,
  obstacles: readonly WorldObstacle[],
): MovementResult {
  const stepCount = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / 10));
  const stepX = delta.x / stepCount;
  const stepY = delta.y / stepCount;
  let x = clamp(start.x, radius, WORLD_SIZE - radius);
  let y = clamp(start.y, radius, WORLD_SIZE - radius);
  let blocked = false;

  for (let step = 0; step < stepCount; step += 1) {
    const requestedX = x + stepX;
    const nextX = clamp(requestedX, radius, WORLD_SIZE - radius);
    if (requestedX !== nextX) blocked = true;
    if (!isCircleBlocked({ x: nextX, y }, radius, obstacles)) x = nextX;
    else blocked = true;

    const requestedY = y + stepY;
    const nextY = clamp(requestedY, radius, WORLD_SIZE - radius);
    if (requestedY !== nextY) blocked = true;
    if (!isCircleBlocked({ x, y: nextY }, radius, obstacles)) y = nextY;
    else blocked = true;

    if (nextX !== x || nextY !== y) blocked = true;
  }

  return { x, y, blocked };
}

export function findOpenPosition(
  desired: WorldPoint,
  radius: number,
  obstacles: readonly WorldObstacle[],
): WorldPoint {
  const origin = {
    x: clamp(desired.x, radius, WORLD_SIZE - radius),
    y: clamp(desired.y, radius, WORLD_SIZE - radius),
  };
  if (!isCircleBlocked(origin, radius, obstacles)) return origin;

  for (let ring = 1; ring <= 8; ring += 1) {
    const distance = ring * (radius * 2 + 18);
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      const candidate = {
        x: clamp(origin.x + Math.cos(angle) * distance, radius, WORLD_SIZE - radius),
        y: clamp(origin.y + Math.sin(angle) * distance, radius, WORLD_SIZE - radius),
      };
      if (!isCircleBlocked(candidate, radius, obstacles)) return candidate;
    }
  }
  return EXTRACTION_POINT;
}

export function isLineBlocked(
  from: WorldPoint,
  to: WorldPoint,
  obstacles: readonly WorldObstacle[],
  padding = 0,
): boolean {
  return obstacles.some((obstacle) => segmentIntersectsAabb(from, to, obstacle, padding));
}

function segmentIntersectsAabb(
  from: WorldPoint,
  to: WorldPoint,
  obstacle: WorldObstacle,
  padding: number,
): boolean {
  const halfWidth = obstacle.width / 2 + padding;
  const halfHeight = obstacle.height / 2 + padding;
  const minX = obstacle.x - halfWidth;
  const maxX = obstacle.x + halfWidth;
  const minY = obstacle.y - halfHeight;
  const maxY = obstacle.y + halfHeight;
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  let minimum = 0;
  let maximum = 1;

  const clip = (origin: number, delta: number, minimumBound: number, maximumBound: number): boolean => {
    if (Math.abs(delta) < Number.EPSILON) return origin >= minimumBound && origin <= maximumBound;
    const first = (minimumBound - origin) / delta;
    const second = (maximumBound - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    return minimum <= maximum;
  };

  return clip(from.x, deltaX, minX, maxX) && clip(from.y, deltaY, minY, maxY);
}

function cover(
  entries: ReadonlyArray<readonly [string, number, number, number, number, WorldObstacle['kind']]>,
): readonly WorldObstacle[] {
  return Object.freeze(entries.map(([id, x, y, width, height, kind]) => Object.freeze({
    id, x, y, width, height, kind,
  })));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
