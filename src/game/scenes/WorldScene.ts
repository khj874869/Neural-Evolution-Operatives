import Phaser from 'phaser';
import { getOperator } from '../data/operators';
import { gameEvents, type MobileInputState } from '../events';
import { GameState, type Resources } from '../state/GameState';
import { AdaptiveDirector, freshTelemetry, type CombatTelemetry, type EnemyArchetype } from '../systems/AdaptiveDirector';
import { generateMission, type Mission } from '../systems/MissionGenerator';
import { createPersonaReply } from '../systems/PersonaEngine';
import { parseTacticalCommand, type TacticalOrder } from '../systems/TacticalCommand';

type EnemySprite = Phaser.Physics.Arcade.Sprite & { archetype?: EnemyArchetype };
type ResourceSprite = Phaser.Physics.Arcade.Sprite & { resourceKind?: keyof Resources; value?: number };

const WORLD_SIZE = 2400;
const EXTRACTION = new Phaser.Math.Vector2(WORLD_SIZE / 2, WORLD_SIZE / 2);
const ENEMY_STATS: Record<EnemyArchetype, { tint: number; hp: number; speed: number; damage: number; scale: number }> = {
  drone: { tint: 0xd8df74, hp: 22, speed: 115, damage: 7, scale: 0.72 },
  raider: { tint: 0xe67d62, hp: 38, speed: 76, damage: 10, scale: 0.9 },
  stalker: { tint: 0xb47cff, hp: 28, speed: 138, damage: 13, scale: 0.75 },
  breaker: { tint: 0xff5147, hp: 92, speed: 48, damage: 19, scale: 1.35 },
};

export class WorldScene extends Phaser.Scene {
  private state!: GameState;
  private player!: Phaser.Physics.Arcade.Sprite;
  private companions: Phaser.Physics.Arcade.Sprite[] = [];
  private enemies!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private resources!: Phaser.Physics.Arcade.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'E', Phaser.Input.Keyboard.Key>;
  private director = new AdaptiveDirector();
  private telemetry: CombatTelemetry = freshTelemetry();
  private mission!: Mission;
  private hp = 100;
  private radiation = 0;
  private fieldCargo: Resources = { scrap: 0, water: 0, data: 0, cores: 0 };
  private missionKills = 0;
  private lastShotAt = 0;
  private companionShotAt = 0;
  private waveAt = 0;
  private stormAt = 0;
  private stormActive = false;
  private stormOverlay!: Phaser.GameObjects.Rectangle;
  private order: TacticalOrder = 'REGROUP';
  private orderUntil = 0;
  private extractionRing!: Phaser.GameObjects.Arc;

  constructor() {
    super('WorldScene');
  }

  create(): void {
    this.state = this.registry.get('state') as GameState;
    this.mission = generateMission(this.state.snapshot().accountLevel, this.state.snapshot().resources);
    this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    this.drawWorld();

    this.enemies = this.physics.add.group({ maxSize: 80 });
    this.bullets = this.physics.add.group({ maxSize: 140 });
    this.resources = this.physics.add.group({ maxSize: 90 });
    this.player = this.physics.add.sprite(EXTRACTION.x, EXTRACTION.y + 130, 'player').setTint(0x9cffbb).setDepth(5);
    this.player.setCollideWorldBounds(true).setCircle(14, 4, 4);

    this.spawnCompanions();
    this.spawnResourceCaches();
    this.setupPhysics();
    this.setupInput();

    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE).startFollow(this.player, true, 0.09, 0.09);
    this.cameras.main.setZoom(this.scale.width < 760 ? 0.83 : 1);
    this.cameras.main.setBackgroundColor('#07100e');
    this.stormOverlay = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xb9b841, 0)
      .setOrigin(0).setScrollFactor(0).setDepth(90).setBlendMode(Phaser.BlendModes.ADD);
    this.scale.on('resize', this.handleResize, this);

    gameEvents.on('tactical-command', this.handleTacticalCommand, this);
    gameEvents.on('resume-world', this.resumeWorld, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('tactical-command', this.handleTacticalCommand, this);
      gameEvents.off('resume-world', this.resumeWorld, this);
      this.scale.off('resize', this.handleResize, this);
    });

    this.emitFeed(`작전 ${this.mission.codename}: ${this.mission.description}`);
    this.emitFeed('WASD/방향키 이동 · 마우스 조준/사격 · 중앙 추출 지점에서 E');
    this.startWave(0);
    this.updateHud();
  }

  update(time: number, delta: number): void {
    if (!this.player.active || this.hp <= 0) return;
    this.updatePlayer(time, delta);
    this.updateCompanions(time);
    this.updateEnemies(time, delta);
    this.updateDirector(time);
    this.updateStorm(time, delta);
    this.checkExtraction();
    this.updateHud();
  }

  private drawWorld(): void {
    const ground = this.add.graphics();
    ground.fillStyle(0x07100e).fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    ground.lineStyle(1, 0x173228, 0.42);
    for (let axis = 0; axis <= WORLD_SIZE; axis += 80) {
      ground.lineBetween(axis, 0, axis, WORLD_SIZE);
      ground.lineBetween(0, axis, WORLD_SIZE, axis);
    }
    ground.lineStyle(2, 0x8bffba, 0.16);
    ground.strokeCircle(EXTRACTION.x, EXTRACTION.y, 130);
    ground.setDepth(-5);

    const seed = new Phaser.Math.RandomDataGenerator(['motherbrain']);
    for (let index = 0; index < 85; index += 1) {
      const x = seed.between(90, WORLD_SIZE - 90);
      const y = seed.between(90, WORLD_SIZE - 90);
      if (Phaser.Math.Distance.Between(x, y, EXTRACTION.x, EXTRACTION.y) < 220) continue;
      this.add.image(x, y, 'ruin').setTint(seed.pick([0x26352f, 0x31352f, 0x293936])).setRotation(seed.realInRange(-0.5, 0.5));
    }
    this.extractionRing = this.add.circle(EXTRACTION.x, EXTRACTION.y, 64, 0x8bffba, 0.045)
      .setStrokeStyle(2, 0x8bffba, 0.7).setDepth(1);
    this.add.text(EXTRACTION.x, EXTRACTION.y - 88, 'SHELTER LIFT // EXTRACTION', {
      color: '#8bffba', fontFamily: 'Share Tech Mono', fontSize: '11px',
    }).setOrigin(0.5);
  }

  private spawnCompanions(): void {
    const squad = this.state.getSquad();
    this.companions = squad.map(({ definition }, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, squad.length);
      const sprite = this.physics.add.sprite(
        this.player.x + Math.cos(angle) * 50,
        this.player.y + Math.sin(angle) * 50,
        'operative',
      ).setTint(definition.color).setDepth(4);
      sprite.setData('operatorId', definition.id);
      sprite.setData('role', definition.role);
      sprite.setData('slot', index);
      return sprite;
    });
  }

  private spawnResourceCaches(): void {
    const seed = new Phaser.Math.RandomDataGenerator([String(Date.now())]);
    for (let index = 0; index < 28; index += 1) {
      const kinds: Array<keyof Resources> = ['scrap', 'scrap', 'scrap', 'water', 'data'];
      const kind = seed.pick(kinds);
      this.spawnResource(seed.between(80, WORLD_SIZE - 80), seed.between(80, WORLD_SIZE - 80), kind, seed.between(2, 7));
    }
  }

  private setupPhysics(): void {
    this.physics.add.overlap(this.bullets, this.enemies, (bulletObject, enemyObject) => {
      const bullet = bulletObject as Phaser.Physics.Arcade.Sprite;
      const enemy = enemyObject as EnemySprite;
      if (!bullet.active || !enemy.active) return;
      bullet.disableBody(true, true);
      const damage = bullet.getData('companion') ? 14 : 19;
      enemy.setData('hp', (enemy.getData('hp') as number) - damage);
      this.telemetry.hits += 1;
      enemy.setTintFill(0xffffff);
      this.time.delayedCall(55, () => enemy.active && enemy.clearTint().setTint(ENEMY_STATS[enemy.archetype ?? 'raider'].tint));
      if ((enemy.getData('hp') as number) <= 0) this.defeatEnemy(enemy);
    });

    this.physics.add.overlap(this.player, this.resources, (_playerObject, resourceObject) => {
      const resource = resourceObject as ResourceSprite;
      const kind = resource.resourceKind ?? 'scrap';
      const value = resource.value ?? 1;
      this.fieldCargo[kind] += value;
      resource.disableBody(true, true);
      this.emitFeed(`${kind.toUpperCase()} +${value} // 현장 화물`);
    });
  }

  private setupInput(): void {
    if (!this.input.keyboard) throw new Error('Keyboard input unavailable');
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,E') as Record<'W' | 'A' | 'S' | 'D' | 'E', Phaser.Input.Keyboard.Key>;
  }

  private updatePlayer(time: number, delta: number): void {
    const mobile = this.registry.get('mobileInput') as MobileInputState;
    const horizontal = Number(this.keys.D.isDown || this.cursors.right.isDown || mobile.right)
      - Number(this.keys.A.isDown || this.cursors.left.isDown || mobile.left);
    const vertical = Number(this.keys.S.isDown || this.cursors.down.isDown || mobile.down)
      - Number(this.keys.W.isDown || this.cursors.up.isDown || mobile.up);
    const movement = new Phaser.Math.Vector2(horizontal, vertical);
    if (movement.lengthSq() > 0) {
      movement.normalize().scale(205);
      this.player.setVelocity(movement.x, movement.y);
      this.telemetry.distanceMoved += 205 * (delta / 1000);
      this.telemetry.stationarySeconds = Math.max(0, this.telemetry.stationarySeconds - delta / 1600);
    } else {
      this.player.setVelocity(0, 0);
      this.telemetry.stationarySeconds += delta / 1000;
    }

    const pointer = this.input.activePointer;
    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    if (worldPoint) this.player.setRotation(Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y) + Math.PI / 2);
    if ((pointer.isDown || mobile.fire) && time - this.lastShotAt > 180) {
      const target = mobile.fire ? this.findNearestEnemy(this.player.x, this.player.y) : undefined;
      this.fireBullet(this.player.x, this.player.y, target?.x ?? worldPoint.x, target?.y ?? worldPoint.y, false);
      this.lastShotAt = time;
    }
  }

  private updateCompanions(time: number): void {
    const formationRadius = this.order === 'DRAW_AGGRO' ? 115 : this.order === 'HOLD' ? 86 : 54;
    for (const companion of this.companions) {
      if (!companion.active) continue;
      const slot = companion.getData('slot') as number;
      const angle = (Math.PI * 2 * slot) / this.companions.length + time * 0.00018;
      let destinationX = this.player.x + Math.cos(angle) * formationRadius;
      let destinationY = this.player.y + Math.sin(angle) * formationRadius;
      if (this.order === 'FLANK') {
        destinationX += Math.cos(angle + Math.PI / 2) * 70;
        destinationY += Math.sin(angle + Math.PI / 2) * 70;
      }
      if (this.order !== 'HOLD' || time > this.orderUntil) {
        this.physics.moveTo(companion, destinationX, destinationY, 150);
      } else {
        companion.setVelocity(0, 0);
      }
      if (Phaser.Math.Distance.Between(companion.x, companion.y, destinationX, destinationY) < 8) companion.setVelocity(0, 0);
    }

    if (time - this.companionShotAt > 520) {
      for (const companion of this.companions) {
        const target = this.findNearestEnemy(companion.x, companion.y, 490);
        if (target) this.fireBullet(companion.x, companion.y, target.x, target.y, true);
      }
      this.companionShotAt = time;
    }
    if (time > this.orderUntil && this.order !== 'REGROUP') this.order = 'REGROUP';
  }

  private updateEnemies(time: number, delta: number): void {
    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (!enemy.active) return true;
      const archetype = enemy.archetype ?? 'raider';
      const stats = ENEMY_STATS[archetype];
      let target: Phaser.Physics.Arcade.Sprite = this.player;
      if (this.order === 'DRAW_AGGRO' && this.companions[0]) target = this.companions[0];
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, target.x, target.y);
      if (distance > 30) {
        let offset = 0;
        if (archetype === 'stalker') offset = Math.sin(time * 0.004 + enemy.x) * 0.9;
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y) + offset;
        enemy.setVelocity(Math.cos(angle) * stats.speed, Math.sin(angle) * stats.speed);
      } else if (time > (enemy.getData('attackAt') as number)) {
        enemy.setData('attackAt', time + 820);
        if (target === this.player) this.damagePlayer(stats.damage);
      }
      enemy.setRotation(Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y));
      if (distance > 1250) enemy.disableBody(true, true);
      return true;
    });
    if (this.player.body?.velocity.lengthSq() === 0) this.telemetry.stationarySeconds += delta / 1000;
  }

  private updateDirector(time: number): void {
    if (time < this.waveAt) return;
    const profile = this.director.evaluate(this.telemetry, this.state.snapshot().accountLevel);
    this.emitFeed(profile.counterMessage, profile.pressure > 0.65);
    for (let index = 0; index < profile.spawnCount; index += 1) {
      this.spawnEnemy(this.director.pickArchetype(profile));
    }
    this.telemetry = freshTelemetry();
    this.waveAt = time + Math.max(8500, 15_500 - profile.pressure * 5200);
  }

  private updateStorm(time: number, delta: number): void {
    if (time > this.stormAt) {
      this.stormActive = !this.stormActive;
      this.stormAt = time + (this.stormActive ? 11_000 : 29_000);
      this.emitFeed(this.stormActive ? `${this.mission.hazard.toUpperCase()} 전선 도달 // 노출을 최소화하십시오.` : '환경 재해 전선 이탈 // 방사능 수치 안정화 중', this.stormActive);
      this.tweens.add({ targets: this.stormOverlay, alpha: this.stormActive ? 0.11 : 0, duration: 900 });
    }
    this.radiation = Phaser.Math.Clamp(this.radiation + (this.stormActive ? delta * 0.0017 : -delta * 0.0025), 0, 100);
    if (this.radiation >= 100) {
      this.damagePlayer(4);
      this.radiation = 82;
    }
  }

  private startWave(delay: number): void {
    this.waveAt = delay;
    this.stormAt = 31_000;
  }

  private spawnEnemy(archetype: EnemyArchetype): void {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = Phaser.Math.Between(430, 680);
    const x = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * distance, 24, WORLD_SIZE - 24);
    const y = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * distance, 24, WORLD_SIZE - 24);
    const enemy = this.enemies.get(x, y, 'enemy') as EnemySprite | null;
    if (!enemy) return;
    const stats = ENEMY_STATS[archetype];
    enemy.enableBody(true, x, y, true, true).setTint(stats.tint).setScale(stats.scale).setDepth(3);
    enemy.archetype = archetype;
    enemy.setData('hp', stats.hp).setData('attackAt', 0).setCircle(11);
  }

  private fireBullet(fromX: number, fromY: number, toX: number, toY: number, companion: boolean): void {
    const bullet = this.bullets.get(fromX, fromY, 'bullet') as Phaser.Physics.Arcade.Sprite | null;
    if (!bullet) return;
    bullet.enableBody(true, fromX, fromY, true, true).setTint(companion ? 0x6ee7d1 : 0xc9f456).setDepth(4).setData('companion', companion);
    this.physics.moveTo(bullet, toX, toY, companion ? 620 : 760);
    if (!companion) this.telemetry.shots += 1;
    this.time.delayedCall(900, () => bullet.active && bullet.disableBody(true, true));
  }

  private defeatEnemy(enemy: EnemySprite): void {
    const archetype = enemy.archetype ?? 'raider';
    const x = enemy.x;
    const y = enemy.y;
    enemy.disableBody(true, true);
    this.missionKills += 1;
    this.telemetry.kills += 1;
    this.state.recordKill();
    const kind: keyof Resources = Math.random() < 0.28 ? this.mission.targetResource : 'scrap';
    this.spawnResource(x, y, kind, archetype === 'breaker' ? 8 : Phaser.Math.Between(1, 4));
    if (Math.random() < 0.035) this.spawnResource(x + 12, y, 'cores', 1);
  }

  private spawnResource(x: number, y: number, kind: keyof Resources, value: number): void {
    const resource = this.resources.get(x, y, 'resource') as ResourceSprite | null;
    if (!resource) return;
    const tints: Record<keyof Resources, number> = { scrap: 0xa7b1aa, water: 0x61b9ff, data: 0xb47cff, cores: 0xffd76a };
    resource.enableBody(true, x, y, true, true).setTint(tints[kind]).setDepth(2);
    resource.resourceKind = kind;
    resource.value = value;
    this.tweens.add({ targets: resource, angle: 180, yoyo: true, repeat: -1, duration: 1100 });
  }

  private findNearestEnemy(x: number, y: number, maxDistance = 620): EnemySprite | undefined {
    let nearest: EnemySprite | undefined;
    let nearestDistance = maxDistance;
    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (!enemy.active) return true;
      const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
      return true;
    });
    return nearest;
  }

  private checkExtraction(): void {
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, EXTRACTION.x, EXTRACTION.y);
    const hasCargo = Object.values(this.fieldCargo).some((value) => value > 0);
    this.extractionRing.setStrokeStyle(2, hasCargo && distance < 120 ? 0xc9f456 : 0x8bffba, 0.7);
    const touchAutoExtract = this.sys.game.device.input.touch && distance < 72;
    if (distance < 72 && hasCargo && (Phaser.Input.Keyboard.JustDown(this.keys.E) || touchAutoExtract)) {
      const cargo = { ...this.fieldCargo };
      this.state.recordExtraction(cargo.scrap);
      this.state.addResources({ water: cargo.water, data: cargo.data, cores: cargo.cores });
      this.fieldCargo = { scrap: 0, water: 0, data: 0, cores: 0 };
      const missionComplete = this.missionKills >= this.mission.targetKills && cargo[this.mission.targetResource] >= this.mission.targetAmount;
      if (missionComplete) {
        this.state.addResources({ cores: 3, data: 12 });
        this.emitFeed(`작전 ${this.mission.codename} 완료 // 뉴럴 코어 +3`, false);
        this.mission = generateMission(this.state.snapshot().accountLevel, this.state.snapshot().resources, Date.now() + this.missionKills);
        this.missionKills = 0;
      } else {
        this.emitFeed(`화물 추출 완료 // 고철 ${cargo.scrap} · 식수 ${cargo.water} · 데이터 ${cargo.data}`);
      }
      gameEvents.emit('state-changed');
    }
  }

  private handleTacticalCommand(input: string): void {
    const parsed = parseTacticalCommand(input);
    this.order = parsed.order;
    this.orderUntil = this.time.now + 9000;
    const squad = this.state.getSquad();
    const speaker = squad[Math.floor(Math.random() * squad.length)]?.definition ?? getOperator('aegis-07');
    if (parsed.order === 'HEAL') this.hp = Math.min(100, this.hp + 24);
    this.state.remember(speaker.id, `레드 존에서 "${input.slice(0, 44)}" 명령에 응답했다.`);
    gameEvents.emit('operator-reply', speaker, createPersonaReply(speaker, parsed.order, this.missionKills));
    this.emitFeed(`전술 명령 수신: ${parsed.order} / 신뢰도 ${Math.round(parsed.confidence * 100)}%`);
  }

  private damagePlayer(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    this.telemetry.damageTaken += amount;
    this.cameras.main.shake(90, 0.004);
    this.player.setTintFill(0xffffff);
    this.time.delayedCall(70, () => this.player.active && this.player.clearTint().setTint(0x9cffbb));
    if (this.hp <= 0) {
      this.player.setVelocity(0).setActive(false).setVisible(false);
      this.physics.pause();
      gameEvents.emit('game-over', this.fieldCargo);
      this.emitFeed('생체 신호 소실 // 쉘터 리커버리 프로토콜 대기', true);
    }
  }

  private updateHud(): void {
    gameEvents.emit('hud-update', {
      hp: this.hp,
      radiation: this.radiation,
      cargo: { ...this.fieldCargo },
      kills: this.missionKills,
      mission: this.mission,
    });
  }

  private emitFeed(message: string, danger = false): void {
    gameEvents.emit('feed', message, danger);
  }

  private resumeWorld(): void {
    if (this.hp <= 0) {
      this.scene.restart();
      return;
    }
    this.physics.resume();
    this.scene.resume();
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.stormOverlay.setSize(gameSize.width, gameSize.height);
  }
}
