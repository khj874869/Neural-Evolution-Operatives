import type { EnemyKind, GameInputMessage, ResourceKind, ResourceWallet } from '../../../packages/shared/src/protocol.js';
import type { SquadBonuses } from '../../../packages/shared/src/squad.js';
import { isWeaponId, projectileAngles, WEAPON_SPECS } from '../../../packages/shared/src/combat.js';
import {
  addNeuralCharge, NEURAL_LINK_MAX, neuralLinkLeader, neuralLinkSkill,
} from '../../../packages/shared/src/neuralLink.js';
import {
  evaluateOperation, operationDefinition, type OperationId,
} from '../../../packages/shared/src/operations.js';
import {
  EXTRACTION_POINT, findOpenPosition, isLineBlocked, PLAYER_COLLISION_RADIUS,
  RELAY_POSITIONS, resolveCircleMovement, WORLD_SIZE, worldObstacles, type WorldObstacle,
} from '../../../packages/shared/src/world.js';
import { calculateCombatBonuses, type GearId } from '../../../packages/shared/src/gear.js';

export { EXTRACTION_POINT, WORLD_SIZE };

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
  squad: string[];
  bonuses: SquadBonuses;
  linkCharge: number;
  dashCooldownMs: number;
}

export interface SimEnemy {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  attackCooldownMs: number;
  abilityCooldownMs?: number;
  abilityPattern?: number;
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
  | { type: 'boss-defeated'; playerSessionId: string; operationId: OperationId; message: string }
  | { type: 'neural-link'; playerSessionId: string; operatorId: string; skillName: string; message: string }
  | {
    type: 'extraction'; playerSessionId: string; playerId: string; cargo: ResourceWallet;
    extractionNumber: number; operationId: OperationId; operationComplete: boolean; kills: number;
  }
  | { type: 'death'; playerSessionId: string; message: string };

interface InternalPlayer extends SimPlayer {
  gear: GearId[];
  input: GameInputMessage;
  lastShotAtMs: number;
  stationaryMs: number;
  shots: number;
  hits: number;
  extractionNumber: number;
  reportedKills: number;
  salvageCollected: number;
  collected: ResourceWallet;
}

const ENEMY_STATS: Record<EnemyKind, { hp: number; speed: number; damage: number }> = {
  drone: { hp: 22, speed: 115, damage: 7 },
  raider: { hp: 38, speed: 76, damage: 10 },
  stalker: { hp: 28, speed: 138, damage: 13 },
  breaker: { hp: 92, speed: 48, damage: 19 },
  jammer: { hp: 55, speed: 60, damage: 5 },
  sapper: { hp: 64, speed: 72, damage: 9 },
  relay: { hp: 145, speed: 0, damage: 7 },
  warden: { hp: 520, speed: 46, damage: 24 },
  harvester: { hp: 760, speed: 42, damage: 27 },
};

const EMPTY_INPUT: GameInputMessage = {
  sequence: 0, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: false,
  weapon: 'carbine', activateLink: false, dash: false,
};

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
  private bossSpawned = false;
  private bossDefeated = false;
  private relaysSpawned = false;
  private readonly obstacles: readonly WorldObstacle[];
  relaysDestroyed = 0;

  constructor(
    private readonly random: () => number = Math.random,
    readonly operationId: OperationId = 'operation-zero',
  ) {
    this.obstacles = worldObstacles(operationId);
    for (let index = 0; index < 18; index += 1) this.spawnResourceCache();
  }

  addPlayer(
    sessionId: string,
    playerId: string,
    displayName: string,
    squad: string[] = [],
    gear: GearId[] = [],
  ): SimPlayer {
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
      squad: [...squad],
      gear: [...gear],
      bonuses: calculateCombatBonuses(squad, gear),
      linkCharge: 0,
      dashCooldownMs: 0,
      input: { ...EMPTY_INPUT },
      lastShotAtMs: -1_000,
      stationaryMs: 0,
      shots: 0,
      hits: 0,
      extractionNumber: 0,
      reportedKills: 0,
      salvageCollected: 0,
      collected: emptyWallet(),
    };
    this.players.set(sessionId, player);
    if (this.enemies.size === 0) this.spawnWave(4);
    return player;
  }

  removePlayer(sessionId: string): void {
    this.players.delete(sessionId);
  }

  suspendPlayer(sessionId: string): boolean {
    const player = this.players.get(sessionId);
    if (!player) return false;
    player.input = { ...EMPTY_INPUT, sequence: player.lastSequence, aimAngle: player.aimAngle };
    return true;
  }

  getPlayerId(sessionId: string): string | undefined {
    return this.players.get(sessionId)?.playerId;
  }

  updateSquad(sessionId: string, squad: string[]): boolean {
    const player = this.players.get(sessionId);
    if (!player) return false;
    player.squad = [...squad];
    player.bonuses = calculateCombatBonuses(squad, player.gear);
    return true;
  }

  updateGear(sessionId: string, gear: GearId[]): boolean {
    const player = this.players.get(sessionId);
    if (!player) return false;
    player.gear = [...gear];
    player.bonuses = calculateCombatBonuses(player.squad, gear);
    return true;
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
      weapon: isWeaponId(input.weapon) ? input.weapon : 'carbine',
      activateLink: Boolean(input.activateLink),
      dash: Boolean(input.dash),
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
    const stages = [...this.players.values()].map((player) => evaluateOperation(this.operationId, {
      collected: Math.max(
        player.salvageCollected,
        Object.values(player.cargo).reduce((sum, value) => sum + value, 0),
      ),
      dataCollected: Math.max(player.collected.data, player.cargo.data),
      kills: player.kills,
      relaysDestroyed: this.relaysDestroyed,
      bossDefeated: this.bossDefeated,
      extracted: false,
    }).stage);
    if (stages.includes('RELAY') && !this.relaysSpawned) this.spawnRelays();
    if (stages.includes('WARDEN') && !this.bossSpawned) this.spawnBoss();
    if (this.players.size && this.waveElapsedMs >= 12_000) {
      this.waveElapsedMs = 0;
      const pressure = Math.min(10, 3 + Math.floor(this.elapsedMs / 45_000));
      this.spawnWave(pressure + this.players.size);
    }
  }

  drainEvents(): SimulationEvent[] {
    return this.events.splice(0);
  }

  get bossWasDefeated(): boolean {
    return this.bossDefeated;
  }

  private updatePlayer(player: InternalPlayer, deltaMs: number): void {
    player.dashCooldownMs = Math.max(0, player.dashCooldownMs - deltaMs);
    if (player.input.dash) {
      player.input.dash = false;
      this.dash(player);
    }
    const speed = 205 * player.bonuses.moveSpeedMultiplier;
    const movement = resolveCircleMovement(player, {
      x: player.input.moveX * speed * deltaMs / 1000,
      y: player.input.moveY * speed * deltaMs / 1000,
    }, PLAYER_COLLISION_RADIUS, this.obstacles);
    player.x = movement.x;
    player.y = movement.y;
    player.aimAngle = player.input.aimAngle;
    const moving = Math.abs(player.input.moveX) + Math.abs(player.input.moveY) > 0.04;
    player.stationaryMs = moving ? Math.max(0, player.stationaryMs - deltaMs) : player.stationaryMs + deltaMs;
    const radiationDelta = this.stormActive
      ? deltaMs * 0.0017 * player.bonuses.radiationGainMultiplier
      : -deltaMs * 0.0025;
    player.radiation = clamp(player.radiation + radiationDelta, 0, 100);
    if (player.radiation >= 100) {
      player.hp -= 4 * player.bonuses.damageTakenMultiplier;
      player.radiation = 82;
    }
    if (player.bonuses.regenPerSecond > 0 && player.hp > 0) {
      player.hp = Math.min(100, player.hp + player.bonuses.regenPerSecond * deltaMs / 1000);
    }
    const weapon = WEAPON_SPECS[player.input.weapon];
    if (player.input.activateLink) {
      player.input.activateLink = false;
      this.activateNeuralLink(player);
    }
    if (player.input.fire && this.elapsedMs - player.lastShotAtMs >= weapon.cooldownMs * player.bonuses.fireCooldownMultiplier) this.fire(player);
    this.collectNearbyResources(player);
    if (player.input.extract) this.tryExtract(player);
    if (player.hp <= 0) this.respawn(player);
  }

  private dash(player: InternalPlayer): boolean {
    if (player.dashCooldownMs > 0 || player.hp <= 0) return false;
    const moving = Math.hypot(player.input.moveX, player.input.moveY) > 0.04;
    const angle = moving ? Math.atan2(player.input.moveY, player.input.moveX) : player.aimAngle;
    const destination = resolveCircleMovement(player, {
      x: Math.cos(angle) * 138,
      y: Math.sin(angle) * 138,
    }, PLAYER_COLLISION_RADIUS, this.obstacles);
    player.x = destination.x;
    player.y = destination.y;
    player.dashCooldownMs = 1_800;
    return true;
  }

  private fire(player: InternalPlayer): void {
    player.lastShotAtMs = this.elapsedMs;
    const weapon = WEAPON_SPECS[player.input.weapon];
    const angles = projectileAngles(player.aimAngle, player.input.weapon);
    player.shots += angles.length;
    for (const shotAngle of angles) {
      let target: SimEnemy | undefined;
      let targetDistance = weapon.range;
      for (const enemy of this.enemies.values()) {
        const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        if (distance >= targetDistance) continue;
        const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
        if (Math.abs(normalizeAngle(angle - shotAngle)) > 0.16) continue;
        if (isLineBlocked(player, enemy, this.obstacles)) continue;
        target = enemy;
        targetDistance = distance;
      }
      if (!target) continue;
      player.hits += 1;
      player.linkCharge = addNeuralCharge(player.linkCharge, 4);
      target.hp -= weapon.damage * player.bonuses.damageMultiplier;
      if (target.hp <= 0) this.defeatEnemy(player, target);
    }
  }

  private updateEnemy(enemy: SimEnemy, deltaMs: number): void {
    const target = nearestPlayer(enemy, this.players.values());
    if (!target) return;
    const stats = ENEMY_STATS[enemy.kind];
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    const hasCoverBetween = isLineBlocked(enemy, target, this.obstacles, 2);
    if (enemy.kind === 'harvester') this.updateHarvesterAbility(enemy, target, deltaMs);
    const attackRange = enemy.kind === 'harvester' ? 165
      : enemy.kind === 'warden' ? 125
        : enemy.kind === 'relay' ? 240
          : enemy.kind === 'sapper' || enemy.kind === 'jammer' ? 180 : 30;
    if (distance > attackRange || hasCoverBetween) {
      if (enemy.kind === 'relay') return;
      let angle = Math.atan2(dy, dx);
      if (enemy.kind === 'stalker' || enemy.kind === 'sapper') angle += Math.sin(this.elapsedMs * 0.004 + enemy.x) * 0.9;
      const enraged = (enemy.kind === 'warden' || enemy.kind === 'harvester')
        && enemy.hp < ENEMY_STATS[enemy.kind].hp * 0.5 ? 1.35 : 1;
      const distanceThisTick = stats.speed * enraged * deltaMs / 1000;
      const radius = enemyCollisionRadius(enemy.kind);
      const direct = resolveCircleMovement(enemy, {
        x: Math.cos(angle) * distanceThisTick,
        y: Math.sin(angle) * distanceThisTick,
      }, radius, this.obstacles);
      let destination = direct;
      if (direct.blocked || hasCoverBetween) {
        const flankAngle = Math.atan2(dy, dx) + navigationSign(enemy.id) * Math.PI / 2;
        const flank = resolveCircleMovement(enemy, {
          x: Math.cos(flankAngle) * distanceThisTick,
          y: Math.sin(flankAngle) * distanceThisTick,
        }, radius, this.obstacles);
        const directProgress = Math.hypot(direct.x - enemy.x, direct.y - enemy.y);
        const flankProgress = Math.hypot(flank.x - enemy.x, flank.y - enemy.y);
        if (flankProgress > directProgress + 0.01) destination = flank;
      }
      enemy.x = destination.x;
      enemy.y = destination.y;
    } else {
      enemy.attackCooldownMs -= deltaMs;
      if (enemy.attackCooldownMs <= 0) {
        target.hp -= stats.damage * target.bonuses.damageTakenMultiplier;
        target.linkCharge = addNeuralCharge(target.linkCharge, 6);
        if (enemy.kind === 'jammer') target.linkCharge = Math.max(0, target.linkCharge - 18);
        if (enemy.kind === 'relay') target.linkCharge = Math.max(0, target.linkCharge - 12);
        if (enemy.kind === 'sapper') target.radiation = clamp(target.radiation + 8, 0, 100);
        enemy.attackCooldownMs = enemy.kind === 'harvester' ? 1_200
          : enemy.kind === 'warden' ? 1_350
            : enemy.kind === 'relay' || enemy.kind === 'jammer' ? 1_450 : 820;
      }
    }
  }

  private updateHarvesterAbility(enemy: SimEnemy, target: InternalPlayer, deltaMs: number): void {
    enemy.abilityCooldownMs = (enemy.abilityCooldownMs ?? 2_400) - deltaMs;
    if (enemy.abilityCooldownMs > 0) return;
    const pattern = enemy.abilityPattern ?? 0;
    if (pattern % 2 === 0) {
      if (Math.hypot(target.x - enemy.x, target.y - enemy.y) <= 380) {
        target.linkCharge = Math.max(0, target.linkCharge - 28);
        target.radiation = clamp(target.radiation + 16, 0, 100);
        target.hp -= 8 * target.bonuses.damageTakenMultiplier;
      }
      this.events.push({ type: 'feed', message: '헤카톤 EMP 맥동 // 링크 차단 및 방사선 상승' });
    } else {
      this.spawnEnemyNear(target, this.random() < 0.5 ? 'sapper' : 'stalker', 210);
      this.spawnEnemyNear(target, 'drone', 250);
      this.events.push({ type: 'feed', message: '헤카톤 수확 포드 전개 // 증원 개체 낙하' });
    }
    enemy.abilityPattern = pattern + 1;
    const enraged = enemy.hp < ENEMY_STATS.harvester.hp * 0.5;
    enemy.abilityCooldownMs = enraged ? 2_300 : 3_600;
  }

  private defeatEnemy(player: InternalPlayer, enemy: SimEnemy): void {
    this.enemies.delete(enemy.id);
    player.kills += 1;
    player.linkCharge = addNeuralCharge(player.linkCharge, 12);
    if (enemy.kind === 'relay') {
      this.relaysDestroyed += 1;
      const dataId = `resource-${this.nextEntityId++}`;
      this.resources.set(dataId, { id: dataId, kind: 'data', x: enemy.x, y: enemy.y, value: 6 });
      this.events.push({ type: 'feed', message: `신경 중계기 파괴 // ${this.relaysDestroyed}/3` });
      return;
    }
    if (enemy.kind === 'warden' || enemy.kind === 'harvester') {
      this.bossDefeated = true;
      const coreId = `resource-${this.nextEntityId++}`;
      const dataId = `resource-${this.nextEntityId++}`;
      const ashfall = enemy.kind === 'harvester';
      this.resources.set(coreId, { id: coreId, kind: 'cores', x: enemy.x - 14, y: enemy.y, value: ashfall ? 3 : 2 });
      this.resources.set(dataId, { id: dataId, kind: 'data', x: enemy.x + 14, y: enemy.y, value: ashfall ? 28 : 18 });
      this.events.push({
        type: 'boss-defeated', playerSessionId: player.id, operationId: this.operationId,
        message: `${operationDefinition(this.operationId).bossName} 파괴 // 작전 화물을 확보하고 즉시 추출하십시오.`,
      });
      return;
    }
    const kind: ResourceKind = enemy.kind === 'jammer' ? 'data'
      : this.random() < 0.22 ? (this.random() < 0.5 ? 'water' : 'data') : 'scrap';
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
      if (Math.hypot(resource.x - player.x, resource.y - player.y) > player.bonuses.pickupRadius) continue;
      player.cargo[resource.kind] += resource.value;
      player.salvageCollected += resource.value;
      player.collected[resource.kind] += resource.value;
      this.resources.delete(resource.id);
    }
  }

  private activateNeuralLink(player: InternalPlayer): boolean {
    if (player.linkCharge < NEURAL_LINK_MAX || player.hp <= 0) return false;
    const operatorId = neuralLinkLeader(player.squad);
    const skill = neuralLinkSkill(operatorId);
    player.linkCharge = 0;

    if (skill.role === 'Vanguard') {
      player.hp = Math.min(100, player.hp + 15);
      for (const enemy of [...this.enemies.values()]) {
        if (Math.hypot(enemy.x - player.x, enemy.y - player.y) > 260) continue;
        enemy.hp -= 55;
        if (enemy.hp <= 0) this.defeatEnemy(player, enemy);
      }
    } else if (skill.role === 'Sniper') {
      const targets = [...this.enemies.values()]
        .sort((left, right) => Math.hypot(left.x - player.x, left.y - player.y)
          - Math.hypot(right.x - player.x, right.y - player.y))
        .slice(0, 3);
      for (const enemy of targets) {
        enemy.hp -= 95;
        if (enemy.hp <= 0) this.defeatEnemy(player, enemy);
      }
    } else if (skill.role === 'Support') {
      player.hp = Math.min(100, player.hp + 45);
      player.radiation = Math.max(0, player.radiation - 45);
    } else {
      player.cargo.scrap += 12;
      player.cargo.data += 3;
      player.salvageCollected += 15;
      player.collected.scrap += 12;
      player.collected.data += 3;
    }

    this.events.push({
      type: 'neural-link', playerSessionId: player.id, operatorId, skillName: skill.name,
      message: `${operatorId.toUpperCase()} // ${skill.name} 발동`,
    });
    return true;
  }

  private tryExtract(player: InternalPlayer): void {
    player.input.extract = false;
    if (Math.hypot(player.x - EXTRACTION_POINT.x, player.y - EXTRACTION_POINT.y) > 72) return;
    if (!Object.values(player.cargo).some((value) => value > 0)) return;
    const cargo = { ...player.cargo };
    const kills = Math.max(0, player.kills - player.reportedKills);
    player.cargo = emptyWallet();
    player.reportedKills = player.kills;
    player.extractionNumber += 1;
    this.events.push({
      type: 'extraction',
      playerSessionId: player.id,
      playerId: player.playerId,
      cargo,
      extractionNumber: player.extractionNumber,
      operationId: this.operationId,
      operationComplete: this.bossDefeated,
      kills,
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
      const highLink = [...this.players.values()].some((player) => player.linkCharge >= 60);
      const ashfall = this.operationId === 'operation-ashfall';
      const kind: EnemyKind = ashfall && roll < 0.18 ? 'sapper'
        : highLink && roll < 0.2 ? 'jammer'
        : campers && roll < 0.38 ? 'stalker'
          : roll < 0.38 ? 'drone' : roll < 0.72 ? 'raider' : roll < 0.88 ? 'stalker' : roll < 0.96 ? 'jammer' : 'breaker';
      const center = [...this.players.values()][index % Math.max(1, this.players.size)] ?? { x: EXTRACTION_POINT.x, y: EXTRACTION_POINT.y };
      const angle = this.random() * Math.PI * 2;
      const distance = 430 + this.random() * 220;
      const id = `enemy-${this.nextEntityId++}`;
      const position = findOpenPosition({
        x: clamp(center.x + Math.cos(angle) * distance, 20, WORLD_SIZE - 20),
        y: clamp(center.y + Math.sin(angle) * distance, 20, WORLD_SIZE - 20),
      }, enemyCollisionRadius(kind), this.obstacles);
      this.enemies.set(id, {
        id, kind,
        x: position.x,
        y: position.y,
        hp: ENEMY_STATS[kind].hp,
        attackCooldownMs: 0,
      });
    }
  }

  private spawnBoss(): void {
    const player = [...this.players.values()][0];
    if (!player) return;
    this.bossSpawned = true;
    const definition = operationDefinition(this.operationId);
    const id = `enemy-${this.nextEntityId++}`;
    const position = findOpenPosition({
      x: clamp(player.x + 560, 80, WORLD_SIZE - 80),
      y: clamp(player.y - 220, 80, WORLD_SIZE - 80),
    }, enemyCollisionRadius(definition.bossKind), this.obstacles);
    this.enemies.set(id, {
      id, kind: definition.bossKind, x: position.x,
      y: position.y, hp: ENEMY_STATS[definition.bossKind].hp,
      attackCooldownMs: 900, abilityCooldownMs: 2_400, abilityPattern: 0,
    });
    this.events.push({ type: 'feed', message: `경고: ${definition.bossClass} 「${definition.bossName}」가 전장에 진입합니다.` });
  }

  private spawnRelays(): void {
    this.relaysSpawned = true;
    for (const position of RELAY_POSITIONS) {
      const id = `enemy-${this.nextEntityId++}`;
      this.enemies.set(id, {
        id, kind: 'relay', x: position.x, y: position.y,
        hp: ENEMY_STATS.relay.hp, attackCooldownMs: 500,
      });
    }
    this.events.push({ type: 'feed', message: '신경 중계기 3기 노출 // EMP 방출 범위를 경계하십시오.' });
  }

  private spawnEnemyNear(target: InternalPlayer, kind: EnemyKind, distance: number): void {
    const angle = this.random() * Math.PI * 2;
    const id = `enemy-${this.nextEntityId++}`;
    const position = findOpenPosition({
      x: clamp(target.x + Math.cos(angle) * distance, 20, WORLD_SIZE - 20),
      y: clamp(target.y + Math.sin(angle) * distance, 20, WORLD_SIZE - 20),
    }, enemyCollisionRadius(kind), this.obstacles);
    this.enemies.set(id, {
      id, kind,
      x: position.x,
      y: position.y,
      hp: ENEMY_STATS[kind].hp, attackCooldownMs: 300,
    });
  }

  private spawnResourceCache(): void {
    const kinds: ResourceKind[] = ['scrap', 'scrap', 'scrap', 'water', 'data'];
    const id = `resource-${this.nextEntityId++}`;
    const position = findOpenPosition({
      x: 80 + this.random() * (WORLD_SIZE - 160),
      y: 80 + this.random() * (WORLD_SIZE - 160),
    }, 12, this.obstacles);
    this.resources.set(id, {
      id,
      kind: kinds[Math.floor(this.random() * kinds.length)],
      x: position.x,
      y: position.y,
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

function enemyCollisionRadius(kind: EnemyKind): number {
  if (kind === 'warden' || kind === 'harvester') return 38;
  if (kind === 'breaker' || kind === 'relay') return 24;
  return 14;
}

function navigationSign(id: string): -1 | 1 {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return hash % 2 === 0 ? 1 : -1;
}
