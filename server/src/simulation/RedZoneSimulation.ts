import type { EnemyKind, GameInputMessage, ResourceKind, ResourceWallet } from '../../../packages/shared/src/protocol.js';

export const WORLD_SIZE = 2400;
export const EXTRACTION_POINT = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };

export interface SimPlayer {
  id: string;
  playerId: string;
  displayName: string;
  x: number;
  y: number;
  aimAngle: number;
  hp: number;
  radiation: number;
  cargo: ResourceWallet;
  kills: number;
  lastSequence: number;
}

export interface SimEnemy {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  attackCooldownMs: number;
}

export interface SimResource {
  id: string;
  kind: ResourceKind;
  x: number;
  y: number;
  value: number;
}

export type SimulationEvent =
  | { type: 'feed'; playerSessionId?: string; message: string }
  | { type: 'extraction'; playerSessionId: string; playerId: string; cargo: ResourceWallet; extractionNumber: number }
  | { type: 'death'; playerSessionId: string; message: string };

interface InternalPlayer extends SimPlayer {
  input: GameInputMessage;
  lastShotAtMs: number;
  stationaryMs: number;
  shots: number;
  hits: number;
  extractionNumber: number;
}

const ENEMY_STATS: Record<EnemyKind, { hp: number; speed: number; damage: number }> = {
  drone: { hp: 22, speed: 115, damage: 7 },
  raider: { hp: 38, speed: 76, damage: 10 },
  stalker: { hp: 28, speed: 138, damage: 13 },
  breaker: { hp: 92, speed: 48, damage: 19 },
};

const EMPTY_INPUT: GameInputMessage = { sequence: 0, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: false };

export class RedZoneSimulation {
  readonly players = new Map<string, InternalPlayer>();
  readonly enemies = new Map<string, SimEnemy>();
  readonly resources = new Map<string, SimResource>();
  stormActive = false;
  elapsedMs = 0;
  private waveElapsedMs = 0;
  private stormElapsedMs = 0;
  private nextEntityId = 1;
  private readonly events: SimulationEvent[] = [];

  constructor(private readonly random: () => number = Math.random) {
    for (let index = 0; index < 18; index += 1) this.spawnResourceCache();
  }

  addPlayer(sessionId: string, playerId: string, displayName: string): SimPlayer {
    const angle = this.random() * Math.PI * 2;
    const player: InternalPlayer = {
      id: sessionId,
      playerId,
      displayName,
      x: EXTRACTION_POINT.x + Math.cos(angle) * 130,
      y: EXTRACTION_POINT.y + Math.sin(angle) * 130,
      aimAngle: 0,
      hp: 100,
      radiation: 0,
      cargo: emptyWallet(),
      kills: 0,
      lastSequence: 0,
      input: { ...EMPTY_INPUT },
      lastShotAtMs: -1_000,
      stationaryMs: 0,
      shots: 0,
      hits: 0,
      extractionNumber: 0,
    };
    this.players.set(sessionId, player);
    if (this.enemies.size === 0) this.spawnWave(4);
    return player;
  }

  removePlayer(sessionId: string): void {
    this.players.delete(sessionId);
  }

  applyInput(sessionId: string, input: GameInputMessage): boolean {
    const player = this.players.get(sessionId);
    if (!player || !Number.isSafeInteger(input.sequence) || input.sequence <= player.lastSequence) return false;
    const magnitude = Math.hypot(input.moveX, input.moveY);
    player.input = {
      sequence: input.sequence,
      moveX: magnitude > 1 ? input.moveX / magnitude : input.moveX,
      moveY: magnitude > 1 ? input.moveY / magnitude : input.moveY,
      aimAngle: normalizeAngle(input.aimAngle),
      fire: Boolean(input.fire),
      extract: Boolean(input.extract),
    };
    player.lastSequence = input.sequence;
    return true;
  }

  tick(deltaMs: number): void {
    const safeDelta = Math.min(100, Math.max(0, deltaMs));
    this.elapsedMs += safeDelta;
    this.waveElapsedMs += safeDelta;
    this.stormElapsedMs += safeDelta;
    this.updateStorm();
    for (const player of this.players.values()) this.updatePlayer(player, safeDelta);
    for (const enemy of this.enemies.values()) this.updateEnemy(enemy, safeDelta);
    if (this.players.size && this.waveElapsedMs >= 12_000) {
      this.waveElapsedMs = 0;
      const pressure = Math.min(10, 3 + Math.floor(this.elapsedMs / 45_000));
      this.spawnWave(pressure + this.players.size);
    }
  }

  drainEvents(): SimulationEvent[] {
    return this.events.splice(0);
  }

  private updatePlayer(player: InternalPlayer, deltaMs: number): void {
    const speed = 205;
    player.x = clamp(player.x + player.input.moveX * speed * deltaMs / 1000, 18, WORLD_SIZE - 18);
    player.y = clamp(player.y + player.input.moveY * speed * deltaMs / 1000, 18, WORLD_SIZE - 18);
    player.aimAngle = player.input.aimAngle;
    const moving = Math.abs(player.input.moveX) + Math.abs(player.input.moveY) > 0.04;
    player.stationaryMs = moving ? Math.max(0, player.stationaryMs - deltaMs) : player.stationaryMs + deltaMs;
    player.radiation = clamp(player.radiation + (this.stormActive ? deltaMs * 0.0017 : -deltaMs * 0.0025), 0, 100);
    if (player.radiation >= 100) {
      player.hp -= 4;
      player.radiation = 82;
    }
    if (player.input.fire && this.elapsedMs - player.lastShotAtMs >= 180) this.fire(player);
    this.collectNearbyResources(player);
    if (player.input.extract) this.tryExtract(player);
    if (player.hp <= 0) this.respawn(player);
  }

  private fire(player: InternalPlayer): void {
    player.lastShotAtMs = this.elapsedMs;
    player.shots += 1;
    let target: SimEnemy | undefined;
    let targetDistance = 650;
    for (const enemy of this.enemies.values()) {
      const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (distance >= targetDistance) continue;
      const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      if (Math.abs(normalizeAngle(angle - player.aimAngle)) > 0.19) continue;
      target = enemy;
      targetDistance = distance;
    }
    if (!target) return;
    player.hits += 1;
    target.hp -= 19;
    if (target.hp <= 0) this.defeatEnemy(player, target);
  }

  private updateEnemy(enemy: SimEnemy, deltaMs: number): void {
    const target = nearestPlayer(enemy, this.players.values());
    if (!target) return;
    const stats = ENEMY_STATS[enemy.kind];
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 30) {
      let angle = Math.atan2(dy, dx);
      if (enemy.kind === 'stalker') angle += Math.sin(this.elapsedMs * 0.004 + enemy.x) * 0.9;
      enemy.x += Math.cos(angle) * stats.speed * deltaMs / 1000;
      enemy.y += Math.sin(angle) * stats.speed * deltaMs / 1000;
    } else {
      enemy.attackCooldownMs -= deltaMs;
      if (enemy.attackCooldownMs <= 0) {
        target.hp -= stats.damage;
        enemy.attackCooldownMs = 820;
      }
    }
  }

  private defeatEnemy(player: InternalPlayer, enemy: SimEnemy): void {
    this.enemies.delete(enemy.id);
    player.kills += 1;
    const kind: ResourceKind = this.random() < 0.22 ? (this.random() < 0.5 ? 'water' : 'data') : 'scrap';
    const resourceId = `resource-${this.nextEntityId++}`;
    this.resources.set(resourceId, {
      id: resourceId,
      kind,
      x: enemy.x,
      y: enemy.y,
      value: enemy.kind === 'breaker' ? 8 : 1 + Math.floor(this.random() * 4),
    });
  }

  private collectNearbyResources(player: InternalPlayer): void {
    for (const resource of this.resources.values()) {
      if (Math.hypot(resource.x - player.x, resource.y - player.y) > 28) continue;
      player.cargo[resource.kind] += resource.value;
      this.resources.delete(resource.id);
    }
  }

  private tryExtract(player: InternalPlayer): void {
    player.input.extract = false;
    if (Math.hypot(player.x - EXTRACTION_POINT.x, player.y - EXTRACTION_POINT.y) > 72) return;
    if (!Object.values(player.cargo).some((value) => value > 0)) return;
    const cargo = { ...player.cargo };
    player.cargo = emptyWallet();
    player.extractionNumber += 1;
    this.events.push({
      type: 'extraction',
      playerSessionId: player.id,
      playerId: player.playerId,
      cargo,
      extractionNumber: player.extractionNumber,
    });
  }

  private respawn(player: InternalPlayer): void {
    player.hp = 100;
    player.radiation = 0;
    player.cargo = emptyWallet();
    player.x = EXTRACTION_POINT.x;
    player.y = EXTRACTION_POINT.y + 130;
    this.events.push({ type: 'death', playerSessionId: player.id, message: '현장 화물 소실 // 오퍼레이터가 생체 신호를 회수했습니다.' });
  }

  private updateStorm(): void {
    const duration = this.stormActive ? 11_000 : 29_000;
    if (this.stormElapsedMs < duration) return;
    this.stormElapsedMs = 0;
    this.stormActive = !this.stormActive;
    this.events.push({ type: 'feed', message: this.stormActive ? '방사능 폭풍 도달 // 노출 주의' : '폭풍 전선 이탈 // 방사능 안정화' });
  }

  private spawnWave(count: number): void {
    const campers = [...this.players.values()].some((player) => player.stationaryMs > 11_000 || (player.shots > 8 && player.hits / player.shots > 0.58));
    for (let index = 0; index < count; index += 1) {
      const roll = this.random();
      const kind: EnemyKind = campers && roll < 0.38 ? 'stalker' : roll < 0.42 ? 'drone' : roll < 0.8 ? 'raider' : roll < 0.94 ? 'stalker' : 'breaker';
      const center = [...this.players.values()][index % Math.max(1, this.players.size)] ?? { x: EXTRACTION_POINT.x, y: EXTRACTION_POINT.y };
      const angle = this.random() * Math.PI * 2;
      const distance = 430 + this.random() * 220;
      const id = `enemy-${this.nextEntityId++}`;
      this.enemies.set(id, {
        id, kind,
        x: clamp(center.x + Math.cos(angle) * distance, 20, WORLD_SIZE - 20),
        y: clamp(center.y + Math.sin(angle) * distance, 20, WORLD_SIZE - 20),
        hp: ENEMY_STATS[kind].hp,
        attackCooldownMs: 0,
      });
    }
  }

  private spawnResourceCache(): void {
    const kinds: ResourceKind[] = ['scrap', 'scrap', 'scrap', 'water', 'data'];
    const id = `resource-${this.nextEntityId++}`;
    this.resources.set(id, {
      id,
      kind: kinds[Math.floor(this.random() * kinds.length)],
      x: 80 + this.random() * (WORLD_SIZE - 160),
      y: 80 + this.random() * (WORLD_SIZE - 160),
      value: 2 + Math.floor(this.random() * 6),
    });
  }
}

function emptyWallet(): ResourceWallet {
  return { scrap: 0, water: 0, data: 0, cores: 0 };
}

function nearestPlayer(enemy: SimEnemy, players: Iterable<InternalPlayer>): InternalPlayer | undefined {
  let result: InternalPlayer | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const player of players) {
    const candidate = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    if (candidate < distance) {
      result = player;
      distance = candidate;
    }
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.atan2(Math.sin(value), Math.cos(value));
}
