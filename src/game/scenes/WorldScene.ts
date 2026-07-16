import Phaser from 'phaser';
import { getOperator } from '../data/operators';
import { gameEvents, type MobileInputState } from '../events';
import { GameServerClient, type NetworkSnapshot } from '../network/GameServerClient';
import { GameState, type Resources } from '../state/GameState';
import type { PlayerSettings } from '../settings';
import { AdaptiveDirector, freshTelemetry, type CombatTelemetry } from '../systems/AdaptiveDirector';
import { generateMission, type Mission } from '../systems/MissionGenerator';
import { evaluateOperationZero, type OperationStage, type OperationStatus } from '../systems/OperationZero';
import { createPersonaReply } from '../systems/PersonaEngine';
import { parseTacticalCommand, type TacticalOrder } from '../systems/TacticalCommand';
import { isWeaponId, projectileAngles, WEAPON_SPECS, weaponFromSlot, type WeaponId } from '../../../packages/shared/src/combat';
import type { EnemyKind } from '../../../packages/shared/src/protocol';

type EnemySprite = Phaser.Physics.Arcade.Sprite & { archetype?: EnemyKind };
type ResourceSprite = Phaser.Physics.Arcade.Sprite & { resourceKind?: keyof Resources; value?: number };

const WORLD_SIZE = 2400;
const EXTRACTION = new Phaser.Math.Vector2(WORLD_SIZE / 2, WORLD_SIZE / 2);
const ENEMY_STATS: Record<EnemyKind, { texture: string; tint: number; hp: number; speed: number; damage: number; scale: number }> = {
  drone: { texture: 'enemy-drone', tint: 0xd8df74, hp: 22, speed: 115, damage: 7, scale: 0.92 },
  raider: { texture: 'enemy-raider', tint: 0xe67d62, hp: 38, speed: 76, damage: 10, scale: 0.95 },
  stalker: { texture: 'enemy-stalker', tint: 0xb47cff, hp: 28, speed: 138, damage: 13, scale: 0.94 },
  breaker: { texture: 'enemy-breaker', tint: 0xff5147, hp: 92, speed: 48, damage: 19, scale: 1.08 },
  warden: { texture: 'enemy-warden', tint: 0xff426f, hp: 520, speed: 46, damage: 24, scale: 1.08 },
};
const RESOURCE_TEXTURES: Record<keyof Resources, string> = {
  scrap: 'resource-scrap', water: 'resource-water', data: 'resource-data', cores: 'resource-cores',
};

export class WorldScene extends Phaser.Scene {
  private state!: GameState;
  private player!: Phaser.Physics.Arcade.Sprite;
  private companions: Phaser.Physics.Arcade.Sprite[] = [];
  private enemies!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private resources!: Phaser.Physics.Arcade.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'E' | 'ONE' | 'TWO' | 'THREE', Phaser.Input.Keyboard.Key>;
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
  private network?: GameServerClient;
  private networkConnected = false;
  private networkSequence = 0;
  private lastNetworkInputAt = 0;
  private reducedMotion = false;
  private currentWeapon: WeaponId = 'carbine';
  private operationCollected = 0;
  private operationBossSpawned = false;
  private operationBossDefeated = false;
  private operationExtracted = false;
  private operationComplete = false;
  private operationStage?: OperationStage;
  private operationStatus: OperationStatus = evaluateOperationZero({ collected: 0, kills: 0, bossDefeated: false, extracted: false });
  private lastNetworkCargo = 0;
  private bossAbilityAt = 0;
  private readonly serverEnemies = new Map<string, EnemySprite>();
  private readonly serverResources = new Map<string, ResourceSprite>();

  constructor() {
    super('WorldScene');
  }

  create(): void {
    this.state = this.registry.get('state') as GameState;
    this.network = this.registry.get('network') as GameServerClient | undefined;
    this.reducedMotion = Boolean((this.registry.get('settings') as PlayerSettings | undefined)?.reducedMotion);
    this.mission = generateMission(this.state.snapshot().accountLevel, this.state.snapshot().resources);
    this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    this.drawWorld();

    this.enemies = this.physics.add.group({ maxSize: 80 });
    this.bullets = this.physics.add.group({ maxSize: 140 });
    this.resources = this.physics.add.group({ maxSize: 90 });
    this.player = this.physics.add.sprite(EXTRACTION.x, EXTRACTION.y + 130, 'player').setTint(0x9cffbb).setDepth(5);
    this.player.setCollideWorldBounds(true).setCircle(15, 9, 9);

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
    gameEvents.on('squad-changed', this.spawnCompanions, this);
    gameEvents.on('settings-changed', this.handleSettingsChanged, this);
    gameEvents.on('weapon-select', this.selectWeapon, this);
    gameEvents.on('boss-defeated', this.handleBossDefeated, this);
    gameEvents.on('server-extraction', this.handleServerExtraction, this);
    gameEvents.on('network-snapshot', this.handleNetworkSnapshot, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('tactical-command', this.handleTacticalCommand, this);
      gameEvents.off('resume-world', this.resumeWorld, this);
      gameEvents.off('squad-changed', this.spawnCompanions, this);
      gameEvents.off('settings-changed', this.handleSettingsChanged, this);
      gameEvents.off('weapon-select', this.selectWeapon, this);
      gameEvents.off('boss-defeated', this.handleBossDefeated, this);
      gameEvents.off('server-extraction', this.handleServerExtraction, this);
      gameEvents.off('network-snapshot', this.handleNetworkSnapshot, this);
      this.scale.off('resize', this.handleResize, this);
    });

    this.emitFeed(`작전 ${this.mission.codename}: ${this.mission.description}`);
    this.emitFeed('WASD/방향키 이동 · 마우스 조준/사격 · 중앙 추출 지점에서 E');
    this.startWave(0);
    this.selectWeapon('carbine');
    this.updateOperation();
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
    this.updateOperation();
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
    for (let index = 0; index < 92; index += 1) {
      const x = seed.between(90, WORLD_SIZE - 90);
      const y = seed.between(90, WORLD_SIZE - 90);
      if (Phaser.Math.Distance.Between(x, y, EXTRACTION.x, EXTRACTION.y) < 220) continue;
      const texture = index % 4 === 0 ? 'wreck' : 'ruin';
      this.add.image(x, y, texture)
        .setTint(seed.pick([0x33443d, 0x3e423b, 0x2f463d, 0x4a3c35]))
        .setAlpha(seed.realInRange(0.65, 0.94))
        .setRotation(seed.realInRange(-0.8, 0.8))
        .setScale(seed.realInRange(0.72, 1.18));
      if (index % 7 === 0) {
        ground.lineStyle(2, 0xe2b84c, 0.12).strokeCircle(x, y, seed.between(45, 85));
      }
    }
    this.extractionRing = this.add.circle(EXTRACTION.x, EXTRACTION.y, 64, 0x8bffba, 0.045)
      .setStrokeStyle(2, 0x8bffba, 0.7).setDepth(1);
    this.add.text(EXTRACTION.x, EXTRACTION.y - 88, 'SHELTER LIFT // EXTRACTION', {
      color: '#8bffba', fontFamily: 'Share Tech Mono', fontSize: '11px',
    }).setOrigin(0.5);
  }

  private spawnCompanions(): void {
    for (const companion of this.companions) companion.destroy();
    const squad = this.state.getSquad();
    this.companions = squad.map(({ definition }, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, squad.length);
      const sprite = this.physics.add.sprite(
        this.player.x + Math.cos(angle) * 50,
        this.player.y + Math.sin(angle) * 50,
        'operative',
      ).setTint(definition.color).setDepth(4).setScale(0.92);
      sprite.setData('operatorId', definition.id);
      sprite.setData('role', definition.role);
      sprite.setData('slot', index);
      this.tweens.add({
        targets: sprite,
        scaleX: 1.02,
        scaleY: 1.02,
        yoyo: true,
        repeat: -1,
        duration: 900 + index * 120,
        ease: 'Sine.InOut',
      });
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
      this.impactBurst(enemy.x, enemy.y, ENEMY_STATS[enemy.archetype ?? 'raider'].tint, 4);
      gameEvents.emit('sfx', 'hit');
      if (this.networkConnected) return;
      const damage = (bullet.getData('damage') as number | undefined) ?? (bullet.getData('companion') ? 14 : 19);
      enemy.setData('hp', (enemy.getData('hp') as number) - damage);
      this.telemetry.hits += 1;
      enemy.setTintFill(0xffffff);
      this.time.delayedCall(55, () => enemy.active && enemy.clearTint().setTint(ENEMY_STATS[enemy.archetype ?? 'raider'].tint));
      if ((enemy.getData('hp') as number) <= 0) this.defeatEnemy(enemy);
    });

    this.physics.add.overlap(this.player, this.resources, (_playerObject, resourceObject) => {
      const resource = resourceObject as ResourceSprite;
      if (this.networkConnected) return;
      const kind = resource.resourceKind ?? 'scrap';
      const value = resource.value ?? 1;
      this.fieldCargo[kind] += value;
      this.operationCollected += value;
      resource.disableBody(true, true);
      this.impactBurst(resource.x, resource.y, 0xffffff, 6);
      gameEvents.emit('sfx', 'pickup');
      gameEvents.emit('haptic', 'light');
      this.emitFeed(`${kind.toUpperCase()} +${value} // 현장 화물`);
    });
  }

  private setupInput(): void {
    if (!this.input.keyboard) throw new Error('Keyboard input unavailable');
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      E: Phaser.Input.Keyboard.KeyCodes.E,
      ONE: Phaser.Input.Keyboard.KeyCodes.ONE,
      TWO: Phaser.Input.Keyboard.KeyCodes.TWO,
      THREE: Phaser.Input.Keyboard.KeyCodes.THREE,
    }) as Record<'W' | 'A' | 'S' | 'D' | 'E' | 'ONE' | 'TWO' | 'THREE', Phaser.Input.Keyboard.Key>;
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
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) this.selectWeapon(weaponFromSlot(1) ?? 'carbine');
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) this.selectWeapon(weaponFromSlot(2) ?? 'scatter');
    if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) this.selectWeapon(weaponFromSlot(3) ?? 'rail');
    const weapon = WEAPON_SPECS[this.currentWeapon];
    if ((pointer.isDown || mobile.fire) && time - this.lastShotAt > weapon.cooldownMs) {
      const target = mobile.fire ? this.findNearestEnemy(this.player.x, this.player.y, weapon.range) : undefined;
      this.firePlayerWeapon(this.player.x, this.player.y, target?.x ?? worldPoint.x, target?.y ?? worldPoint.y);
      this.lastShotAt = time;
    }
    if (this.networkConnected && time - this.lastNetworkInputAt >= 50) {
      const distanceToExtraction = Phaser.Math.Distance.Between(this.player.x, this.player.y, EXTRACTION.x, EXTRACTION.y);
      const touchExtract = this.sys.game.device.input.touch && distanceToExtraction < 72;
      this.network?.sendInput({
        sequence: ++this.networkSequence,
        moveX: movement.lengthSq() > 0 ? movement.x / 205 : 0,
        moveY: movement.lengthSq() > 0 ? movement.y / 205 : 0,
        aimAngle: this.player.rotation - Math.PI / 2,
        fire: pointer.isDown || mobile.fire,
        extract: Phaser.Input.Keyboard.JustDown(this.keys.E) || touchExtract,
        weapon: this.currentWeapon,
      });
      this.lastNetworkInputAt = time;
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
    if (this.networkConnected) return;
    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (!enemy.active) return true;
      const archetype = enemy.archetype ?? 'raider';
      const stats = ENEMY_STATS[archetype];
      let target: Phaser.Physics.Arcade.Sprite = this.player;
      if (this.order === 'DRAW_AGGRO' && this.companions[0]) target = this.companions[0];
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, target.x, target.y);
      if (archetype === 'warden' && time > this.bossAbilityAt) {
        this.bossAbilityAt = time + (enemy.getData('hp') < stats.hp * 0.5 ? 3_100 : 4_300);
        this.triggerBossShockwave(enemy);
      }
      const attackRange = archetype === 'warden' ? 125 : 30;
      if (distance > attackRange) {
        let offset = 0;
        if (archetype === 'stalker') offset = Math.sin(time * 0.004 + enemy.x) * 0.9;
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y) + offset;
        const enraged = archetype === 'warden' && enemy.getData('hp') < stats.hp * 0.5 ? 1.35 : 1;
        enemy.setVelocity(Math.cos(angle) * stats.speed * enraged, Math.sin(angle) * stats.speed * enraged);
      } else if (time > (enemy.getData('attackAt') as number)) {
        enemy.setData('attackAt', time + (archetype === 'warden' ? 1_350 : 820));
        if (target === this.player) this.damagePlayer(stats.damage);
      }
      enemy.setRotation(Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y));
      if (distance > 1250 && archetype !== 'warden') enemy.disableBody(true, true);
      return true;
    });
    if (this.player.body?.velocity.lengthSq() === 0) this.telemetry.stationarySeconds += delta / 1000;
  }

  private updateDirector(time: number): void {
    if (this.networkConnected) return;
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
    if (this.networkConnected) return;
    if (time > this.stormAt) {
      this.stormActive = !this.stormActive;
      this.stormAt = time + (this.stormActive ? 11_000 : 29_000);
      this.emitFeed(this.stormActive ? `${this.mission.hazard.toUpperCase()} 전선 도달 // 노출을 최소화하십시오.` : '환경 재해 전선 이탈 // 방사능 수치 안정화 중', this.stormActive);
      if (this.stormActive) {
        gameEvents.emit('sfx', 'storm');
        gameEvents.emit('haptic', 'warning');
      }
      this.tweens.add({ targets: this.stormOverlay, alpha: this.stormActive ? 0.11 : 0, duration: 900 });
    }
    this.radiation = Phaser.Math.Clamp(this.radiation + (this.stormActive ? delta * 0.0017 : -delta * 0.0025), 0, 100);
    if (this.radiation >= 100) {
      this.damagePlayer(4);
      this.radiation = 82;
    }
  }

  private triggerBossShockwave(enemy: EnemySprite): void {
    const targetX = this.player.x;
    const targetY = this.player.y;
    const warning = this.add.circle(targetX, targetY, 92, 0xff315d, 0.055)
      .setStrokeStyle(3, 0xff526f, 0.95).setDepth(7);
    this.tweens.add({
      targets: warning,
      scaleX: 0.78,
      scaleY: 0.78,
      alpha: 0.9,
      yoyo: true,
      repeat: this.reducedMotion ? 0 : 2,
      duration: 170,
    });
    gameEvents.emit('sfx', 'boss-ability');
    this.time.delayedCall(this.reducedMotion ? 520 : 760, () => {
      if (!warning.active) return;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, targetX, targetY);
      warning.setFillStyle(0xff315d, 0.22).setScale(1.15);
      this.impactBurst(targetX, targetY, 0xff426f, 22);
      if (distance < 92 && enemy.active && this.player.active) this.damagePlayer(22);
      this.tweens.add({ targets: warning, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 180, onComplete: () => warning.destroy() });
    });
  }

  private startWave(delay: number): void {
    this.waveAt = delay;
    this.stormAt = 31_000;
  }

  private updateOperation(): void {
    this.operationStatus = evaluateOperationZero({
      collected: this.operationCollected,
      kills: this.missionKills,
      bossDefeated: this.operationBossDefeated,
      extracted: this.operationExtracted,
    });
    if (this.operationStage === this.operationStatus.stage) return;
    this.operationStage = this.operationStatus.stage;
    gameEvents.emit('operation-update', this.operationStatus);
    this.emitFeed(`${this.operationStatus.code}: ${this.operationStatus.objective}`, this.operationStatus.stage === 'WARDEN');
    if (this.operationStatus.stage === 'WARDEN' && !this.operationBossSpawned && !this.networkConnected) {
      this.operationBossSpawned = true;
      this.spawnEnemy('warden');
    }
  }

  private selectWeapon(value: unknown): void {
    if (!isWeaponId(value) || this.currentWeapon === value && this.operationStage !== undefined) return;
    this.currentWeapon = value;
    gameEvents.emit('weapon-selected', value, WEAPON_SPECS[value]);
    if (this.operationStage !== undefined) {
      this.emitFeed(`무장 전환 // ${WEAPON_SPECS[value].name} · ${WEAPON_SPECS[value].description}`);
      gameEvents.emit('sfx', 'weapon');
      gameEvents.emit('haptic', 'light');
    }
  }

  private spawnEnemy(archetype: EnemyKind): void {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = archetype === 'warden' ? 560 : Phaser.Math.Between(430, 680);
    const x = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * distance, 24, WORLD_SIZE - 24);
    const y = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * distance, 24, WORLD_SIZE - 24);
    const stats = ENEMY_STATS[archetype];
    const enemy = this.enemies.get(x, y, stats.texture) as EnemySprite | null;
    if (!enemy) return;
    enemy.setTexture(stats.texture).enableBody(true, x, y, true, true)
      .setTint(stats.tint).setScale(stats.scale).setDepth(3).setAlpha(0);
    enemy.archetype = archetype;
    enemy.setData('hp', stats.hp).setData('attackAt', 0)
      .setCircle(archetype === 'warden' ? 34 : archetype === 'breaker' ? 20 : 12,
        archetype === 'warden' ? 14 : archetype === 'breaker' ? 8 : 4,
        archetype === 'warden' ? 14 : archetype === 'breaker' ? 8 : 4);
    this.tweens.add({ targets: enemy, alpha: 1, duration: this.reducedMotion ? 60 : 260 });
    this.impactBurst(x, y, stats.tint, archetype === 'warden' ? 24 : archetype === 'breaker' ? 10 : 4);
    if (archetype === 'warden') {
      this.cameras.main.flash(300, 255, 34, 74, false);
      gameEvents.emit('sfx', 'boss');
      gameEvents.emit('haptic', 'warning');
    }
  }

  private firePlayerWeapon(fromX: number, fromY: number, toX: number, toY: number): void {
    const spec = WEAPON_SPECS[this.currentWeapon];
    const aimAngle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
    projectileAngles(aimAngle, this.currentWeapon).forEach((angle, index) => {
      this.fireBullet(
        fromX, fromY,
        fromX + Math.cos(angle) * spec.range,
        fromY + Math.sin(angle) * spec.range,
        false,
        spec.damage,
        spec.projectileSpeed,
        spec.tint,
        index === 0,
        Math.ceil(spec.range / spec.projectileSpeed * 1_000) + 120,
      );
    });
  }

  private fireBullet(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    companion: boolean,
    damage = 14,
    speed = 620,
    tint = 0x6ee7d1,
    feedback = true,
    lifetime = 900,
  ): void {
    const bullet = this.bullets.get(fromX, fromY, 'bullet') as Phaser.Physics.Arcade.Sprite | null;
    if (!bullet) return;
    const angle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
    bullet.enableBody(true, fromX, fromY, true, true)
      .setTint(tint).setDepth(4).setData('companion', companion).setData('damage', damage)
      .setRotation(angle).setScale(companion ? 0.72 : this.currentWeapon === 'rail' ? 1.18 : 0.92);
    const muzzle = this.add.image(fromX + Math.cos(angle) * 18, fromY + Math.sin(angle) * 18, 'muzzle')
      .setTint(tint).setRotation(angle).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: muzzle, alpha: 0, scaleX: 1.8, duration: 65, onComplete: () => muzzle.destroy() });
    this.physics.moveTo(bullet, toX, toY, speed);
    if (feedback) {
      gameEvents.emit('sfx', companion ? 'companion-fire' : 'fire');
      if (!companion) gameEvents.emit('haptic', 'shot');
    }
    if (!companion) this.telemetry.shots += 1;
    this.time.delayedCall(lifetime, () => bullet.active && bullet.disableBody(true, true));
  }

  private defeatEnemy(enemy: EnemySprite): void {
    const archetype = enemy.archetype ?? 'raider';
    const x = enemy.x;
    const y = enemy.y;
    const tint = ENEMY_STATS[archetype].tint;
    enemy.disableBody(true, true);
    this.impactBurst(x, y, tint, archetype === 'warden' ? 34 : archetype === 'breaker' ? 18 : 10);
    gameEvents.emit('sfx', 'kill');
    gameEvents.emit('haptic', archetype === 'breaker' ? 'heavy' : 'light');
    this.missionKills += 1;
    this.telemetry.kills += 1;
    this.state.recordKill();
    if (archetype === 'warden') {
      this.operationBossDefeated = true;
      this.spawnResource(x - 14, y, 'cores', 2);
      this.spawnResource(x + 14, y, 'data', 18);
      this.emitFeed('감시자 케르베로스 파괴 // 뉴럴 코어를 확보하고 추출하십시오.');
      gameEvents.emit('sfx', 'boss-down');
      gameEvents.emit('haptic', 'success');
      return;
    }
    const kind: keyof Resources = Math.random() < 0.28 ? this.mission.targetResource : 'scrap';
    this.spawnResource(x, y, kind, archetype === 'breaker' ? 8 : Phaser.Math.Between(1, 4));
    if (Math.random() < 0.035) this.spawnResource(x + 12, y, 'cores', 1);
  }

  private spawnResource(x: number, y: number, kind: keyof Resources, value: number): void {
    const resource = this.resources.get(x, y, RESOURCE_TEXTURES[kind]) as ResourceSprite | null;
    if (!resource) return;
    const tints: Record<keyof Resources, number> = { scrap: 0xa7b1aa, water: 0x61b9ff, data: 0xb47cff, cores: 0xffd76a };
    resource.setTexture(RESOURCE_TEXTURES[kind]).enableBody(true, x, y, true, true).setTint(tints[kind]).setDepth(2).setScale(0.9);
    resource.resourceKind = kind;
    resource.value = value;
    this.tweens.killTweensOf(resource);
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
    if (this.networkConnected) return;
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, EXTRACTION.x, EXTRACTION.y);
    const hasCargo = Object.values(this.fieldCargo).some((value) => value > 0);
    this.extractionRing.setStrokeStyle(2, hasCargo && distance < 120 ? 0xc9f456 : 0x8bffba, 0.7);
    const touchAutoExtract = this.sys.game.device.input.touch && distance < 72;
    if (distance < 72 && hasCargo && (Phaser.Input.Keyboard.JustDown(this.keys.E) || touchAutoExtract)) {
      const cargo = { ...this.fieldCargo };
      this.state.recordExtraction(cargo.scrap);
      this.state.addResources({ water: cargo.water, data: cargo.data, cores: cargo.cores });
      this.fieldCargo = { scrap: 0, water: 0, data: 0, cores: 0 };
      this.impactBurst(EXTRACTION.x, EXTRACTION.y, 0xc9f456, 22);
      gameEvents.emit('sfx', 'extract');
      gameEvents.emit('haptic', 'success');
      const missionComplete = this.missionKills >= this.mission.targetKills && cargo[this.mission.targetResource] >= this.mission.targetAmount;
      if (missionComplete) {
        this.state.addResources({ cores: 3, data: 12 });
        this.emitFeed(`작전 ${this.mission.codename} 완료 // 뉴럴 코어 +3`, false);
        this.mission = generateMission(this.state.snapshot().accountLevel, this.state.snapshot().resources, Date.now() + this.missionKills);
        this.missionKills = 0;
      } else {
        this.emitFeed(`화물 추출 완료 // 고철 ${cargo.scrap} · 식수 ${cargo.water} · 데이터 ${cargo.data}`);
      }
      if (this.operationBossDefeated && !this.operationComplete) this.completeOperation(false);
      gameEvents.emit('state-changed');
    }
  }

  private completeOperation(online: boolean): void {
    if (this.operationComplete) return;
    this.operationComplete = true;
    this.operationExtracted = true;
    if (!online) this.state.addResources({ cores: 3, data: 12 });
    this.updateOperation();
    gameEvents.emit('operation-complete', {
      kills: this.missionKills,
      collected: this.operationCollected,
      weapon: WEAPON_SPECS[this.currentWeapon].name,
      online,
      bonusCores: online ? 0 : 3,
      bonusData: online ? 0 : 12,
    });
    gameEvents.emit('state-changed');
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
    gameEvents.emit('sfx', 'command');
    gameEvents.emit('haptic', 'light');
    this.emitFeed(`전술 명령 수신: ${parsed.order} / 신뢰도 ${Math.round(parsed.confidence * 100)}%`);
  }

  private damagePlayer(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    this.telemetry.damageTaken += amount;
    if (!this.reducedMotion) this.cameras.main.shake(90, 0.004);
    this.impactBurst(this.player.x, this.player.y, 0xff5d5d, 7);
    gameEvents.emit('sfx', 'hurt');
    gameEvents.emit('haptic', 'heavy');
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
    const boss = [...this.enemies.getChildren()].find((child) => (
      (child as EnemySprite).active && (child as EnemySprite).archetype === 'warden'
    )) as EnemySprite | undefined;
    gameEvents.emit('hud-update', {
      hp: this.hp,
      radiation: this.radiation,
      cargo: { ...this.fieldCargo },
      kills: this.missionKills,
      mission: this.mission,
      operation: this.operationStatus,
      weapon: this.currentWeapon,
      boss: boss ? { hp: Number(boss.getData('hp') ?? 0), maxHp: ENEMY_STATS.warden.hp } : null,
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

  private handleNetworkSnapshot(snapshot: NetworkSnapshot): void {
    if (!this.networkConnected) {
      this.networkConnected = true;
      this.enemies.clear(true, true);
      this.resources.clear(true, true);
      this.serverEnemies.clear();
      this.serverResources.clear();
      this.fieldCargo = { scrap: 0, water: 0, data: 0, cores: 0 };
      this.emitFeed('서버 권위형 전투 판정으로 전환되었습니다.');
    }
    const own = snapshot.players.find((player) => player.id === snapshot.localSessionId);
    if (own) {
      if (own.hp < this.hp) {
        if (!this.reducedMotion) this.cameras.main.shake(80, 0.0035);
        this.impactBurst(this.player.x, this.player.y, 0xff5d5d, 5);
        gameEvents.emit('sfx', 'hurt');
        gameEvents.emit('haptic', 'heavy');
      }
      this.player.x = Phaser.Math.Linear(this.player.x, own.x, 0.32);
      this.player.y = Phaser.Math.Linear(this.player.y, own.y, 0.32);
      this.hp = own.hp;
      this.radiation = own.radiation;
      this.missionKills = own.kills;
      const nextCargo = {
        scrap: own.cargoScrap, water: own.cargoWater, data: own.cargoData, cores: own.cargoCores,
      };
      const nextCargoTotal = Object.values(nextCargo).reduce((sum, value) => sum + value, 0);
      if (nextCargoTotal > this.lastNetworkCargo) this.operationCollected += nextCargoTotal - this.lastNetworkCargo;
      this.lastNetworkCargo = nextCargoTotal;
      this.fieldCargo = nextCargo;
      this.networkSequence = Math.max(this.networkSequence, own.lastSequence);
    }
    if (snapshot.enemies.some((enemy) => enemy.kind === 'warden')) this.operationBossSpawned = true;
    this.syncNetworkEnemies(snapshot.enemies);
    this.syncNetworkResources(snapshot.resources);
    if (snapshot.stormActive && !this.stormActive) {
      gameEvents.emit('sfx', 'storm');
      gameEvents.emit('haptic', 'warning');
    }
    this.stormActive = snapshot.stormActive;
    this.stormOverlay.setAlpha(snapshot.stormActive ? 0.11 : 0);
    this.updateHud();
  }

  private syncNetworkEnemies(enemies: NetworkSnapshot['enemies']): void {
    const incoming = new Set(enemies.map((enemy) => enemy.id));
    for (const [id, sprite] of this.serverEnemies) {
      if (incoming.has(id)) continue;
      this.impactBurst(sprite.x, sprite.y, ENEMY_STATS[sprite.archetype ?? 'raider'].tint, 8);
      gameEvents.emit('sfx', 'kill');
      if (sprite.archetype === 'warden') this.handleBossDefeated();
      sprite.disableBody(true, true);
      this.serverEnemies.delete(id);
    }
    for (const source of enemies) {
      let sprite = this.serverEnemies.get(source.id);
      if (!sprite) {
        sprite = this.enemies.get(source.x, source.y, ENEMY_STATS[source.kind].texture) as EnemySprite | null ?? undefined;
        if (!sprite) continue;
        this.serverEnemies.set(source.id, sprite);
      }
      const stats = ENEMY_STATS[source.kind];
      const previousHp = sprite.getData('hp') as number | undefined;
      sprite.setTexture(stats.texture).enableBody(true, source.x, source.y, true, true)
        .setPosition(source.x, source.y).setTint(stats.tint).setScale(stats.scale).setDepth(3);
      sprite.archetype = source.kind;
      if (previousHp !== undefined && source.hp < previousHp) {
        this.impactBurst(source.x, source.y, stats.tint, 3);
        gameEvents.emit('sfx', 'hit');
      }
      sprite.setData('hp', source.hp);
    }
  }

  private syncNetworkResources(resources: NetworkSnapshot['resources']): void {
    const tints: Record<keyof Resources, number> = { scrap: 0xa7b1aa, water: 0x61b9ff, data: 0xb47cff, cores: 0xffd76a };
    const incoming = new Set(resources.map((resource) => resource.id));
    for (const [id, sprite] of this.serverResources) {
      if (incoming.has(id)) continue;
      this.impactBurst(sprite.x, sprite.y, 0xffffff, 5);
      gameEvents.emit('sfx', 'pickup');
      sprite.disableBody(true, true);
      this.serverResources.delete(id);
    }
    for (const source of resources) {
      let sprite = this.serverResources.get(source.id);
      if (!sprite) {
        sprite = this.resources.get(source.x, source.y, RESOURCE_TEXTURES[source.kind]) as ResourceSprite | null ?? undefined;
        if (!sprite) continue;
        this.serverResources.set(source.id, sprite);
      }
      sprite.setTexture(RESOURCE_TEXTURES[source.kind]).enableBody(true, source.x, source.y, true, true)
        .setPosition(source.x, source.y).setTint(tints[source.kind]).setDepth(2);
      sprite.resourceKind = source.kind;
      sprite.value = source.value;
    }
  }

  private impactBurst(x: number, y: number, tint: number, requestedCount: number): void {
    const count = this.reducedMotion ? Math.min(3, requestedCount) : requestedCount;
    for (let index = 0; index < count; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(16, this.reducedMotion ? 25 : 48);
      const spark = this.add.image(x, y, 'spark')
        .setTint(tint)
        .setRotation(angle)
        .setScale(Phaser.Math.FloatBetween(0.45, 1.15))
        .setDepth(8)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.1,
        duration: this.reducedMotion ? 90 : Phaser.Math.Between(150, 260),
        ease: 'Cubic.Out',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private handleSettingsChanged(settings: PlayerSettings): void {
    this.reducedMotion = settings.reducedMotion;
  }

  private handleBossDefeated(): void {
    if (this.operationBossDefeated) return;
    this.operationBossDefeated = true;
    gameEvents.emit('sfx', 'boss-down');
    gameEvents.emit('haptic', 'success');
    this.updateOperation();
  }

  private handleServerExtraction(): void {
    this.lastNetworkCargo = 0;
    if (this.operationBossDefeated && !this.operationComplete) this.completeOperation(true);
  }
}
