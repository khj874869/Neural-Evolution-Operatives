import Phaser from 'phaser';
import { getOperator } from '../data/operators';
import { gameEvents, type MobileInputState } from '../events';
import { GameServerClient, type NetworkSnapshot } from '../network/GameServerClient';
import { GameState, type Resources } from '../state/GameState';
import type { PlayerSettings } from '../settings';
import { AdaptiveDirector, freshTelemetry, type CombatTelemetry } from '../systems/AdaptiveDirector';
import { generateMission, type Mission } from '../systems/MissionGenerator';
import { createPersonaReply } from '../systems/PersonaEngine';
import { parseTacticalCommand, type TacticalOrder } from '../systems/TacticalCommand';
import { isWeaponId, projectileAngles, WEAPON_SPECS, weaponFromSlot, type WeaponId } from '../../../packages/shared/src/combat';
import type { EnemyKind } from '../../../packages/shared/src/protocol';
import {
  addNeuralCharge, NEURAL_LINK_MAX, neuralLinkLeader, neuralLinkSkill,
} from '../../../packages/shared/src/neuralLink';
import {
  evaluateOperation, operationDefinition,
  type OperationDefinition, type OperationId, type OperationStage, type OperationStatus,
} from '../../../packages/shared/src/operations';
import {
  EXTRACTION_POINT, findOpenPosition, isLineBlocked, PLAYER_COLLISION_RADIUS,
  RELAY_POSITIONS, resolveCircleMovement, WORLD_SIZE, worldObstacles, type WorldObstacle,
} from '../../../packages/shared/src/world';
import { calculateCombatBonuses } from '../../../packages/shared/src/gear';
import type { SquadBonuses } from '../../../packages/shared/src/squad';
import {
  PerformanceGovernor, type PerformanceSample,
} from '../systems/PerformanceGovernor';

type EnemySprite = Phaser.Physics.Arcade.Sprite & { archetype?: EnemyKind };
type ResourceSprite = Phaser.Physics.Arcade.Sprite & { resourceKind?: keyof Resources; value?: number };

const ENEMY_STATS: Record<EnemyKind, { texture: string; tint: number; hp: number; speed: number; damage: number; scale: number }> = {
  drone: { texture: 'enemy-drone', tint: 0xd8df74, hp: 22, speed: 115, damage: 7, scale: 0.92 },
  raider: { texture: 'enemy-raider', tint: 0xe67d62, hp: 38, speed: 76, damage: 10, scale: 0.95 },
  stalker: { texture: 'enemy-stalker', tint: 0xb47cff, hp: 28, speed: 138, damage: 13, scale: 0.94 },
  breaker: { texture: 'enemy-breaker', tint: 0xff5147, hp: 92, speed: 48, damage: 19, scale: 1.08 },
  jammer: { texture: 'enemy-jammer', tint: 0x48d9ff, hp: 55, speed: 60, damage: 5, scale: 1.02 },
  sapper: { texture: 'enemy-sapper', tint: 0xff9b54, hp: 64, speed: 72, damage: 9, scale: 1.02 },
  relay: { texture: 'enemy-relay', tint: 0xe678ff, hp: 145, speed: 0, damage: 7, scale: 1.08 },
  warden: { texture: 'enemy-warden', tint: 0xff426f, hp: 520, speed: 46, damage: 24, scale: 1.08 },
  harvester: { texture: 'enemy-harvester', tint: 0xff8b3d, hp: 760, speed: 42, damage: 27, scale: 1.1 },
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
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private transientEffects!: Phaser.GameObjects.Group;
  private performance!: PerformanceGovernor;
  private lastHudAt = -Infinity;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'E' | 'Q' | 'SPACE' | 'ONE' | 'TWO' | 'THREE', Phaser.Input.Keyboard.Key>;
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
  private networkSessionId = '';
  private networkSequence = 0;
  private lastNetworkInputAt = 0;
  private reducedMotion = false;
  private currentWeapon: WeaponId = 'carbine';
  private operationCollected = 0;
  private operationDataCollected = 0;
  private operationRelaysDestroyed = 0;
  private operationRelaysSpawned = false;
  private operationBossSpawned = false;
  private operationBossDefeated = false;
  private operationExtracted = false;
  private operationComplete = false;
  private operationStage?: OperationStage;
  private operationId: OperationId = 'operation-zero';
  private operationDefinition: OperationDefinition = operationDefinition('operation-zero');
  private cover: readonly WorldObstacle[] = worldObstacles('operation-zero');
  private combatBonuses: SquadBonuses = calculateCombatBonuses([], []);
  private operationStatus: OperationStatus = evaluateOperation('operation-zero', {
    collected: 0, dataCollected: 0, kills: 0, relaysDestroyed: 0, bossDefeated: false, extracted: false,
  });
  private lastNetworkCargo = 0;
  private bossAbilityAt = 0;
  private bossIntroShown = false;
  private neuralLinkCharge = 0;
  private linkRequested = false;
  private linkLeader = 'aegis-07';
  private dashCooldownMs = 0;
  private dashNetworkPending = false;
  private extractRequested = false;
  private gamepadConnected = false;
  private gamepadButtons = new Set<number>();
  private readonly serverEnemies = new Map<string, EnemySprite>();
  private readonly serverResources = new Map<string, ResourceSprite>();

  constructor() {
    super('WorldScene');
  }

  create(): void {
    this.state = this.registry.get('state') as GameState;
    this.network = this.registry.get('network') as GameServerClient | undefined;
    const settings = this.registry.get('settings') as PlayerSettings | undefined;
    this.reducedMotion = Boolean(settings?.reducedMotion);
    this.performance = new PerformanceGovernor(
      settings?.graphicsQuality ?? 'auto',
      navigator.maxTouchPoints > 0 || this.scale.width < 820,
    );
    this.emitPerformance({ tier: this.performance.tier, fps: 0, changed: false });
    this.operationId = this.state.activeOperationId();
    this.operationDefinition = operationDefinition(this.operationId);
    this.cover = worldObstacles(this.operationId);
    this.operationStatus = evaluateOperation(this.operationId, {
      collected: 0, dataCollected: 0, kills: 0, relaysDestroyed: 0, bossDefeated: false, extracted: false,
    });
    this.mission = generateMission(this.state.snapshot().accountLevel, this.state.snapshot().resources);
    this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    this.obstacles = this.physics.add.staticGroup();
    this.drawWorld();

    this.enemies = this.physics.add.group({ maxSize: 80 });
    this.bullets = this.physics.add.group({ maxSize: 140 });
    this.resources = this.physics.add.group({ maxSize: 90 });
    this.transientEffects = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 96 });
    this.player = this.physics.add.sprite(EXTRACTION_POINT.x, EXTRACTION_POINT.y + 130, 'player').setTint(0x9cffbb).setDepth(5);
    this.player.setCollideWorldBounds(true).setCircle(PLAYER_COLLISION_RADIUS, 6, 6);

    this.spawnCompanions();
    this.spawnResourceCaches();
    this.setupPhysics();
    this.setupInput();

    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE).startFollow(this.player, true, 0.09, 0.09);
    this.cameras.main.setZoom(this.scale.width < 760 ? 0.83 : 1);
    this.cameras.main.setBackgroundColor(this.operationDefinition.palette.ground);
    this.stormOverlay = this.add.rectangle(
      0, 0, this.scale.width, this.scale.height,
      this.operationId === 'operation-ashfall' ? 0xff6f3c : 0xb9b841, 0,
    )
      .setOrigin(0).setScrollFactor(0).setDepth(90).setBlendMode(Phaser.BlendModes.ADD);
    this.scale.on('resize', this.handleResize, this);

    gameEvents.on('tactical-command', this.handleTacticalCommand, this);
    gameEvents.on('resume-world', this.resumeWorld, this);
    gameEvents.on('squad-changed', this.spawnCompanions, this);
    gameEvents.on('loadout-changed', this.refreshCombatBonuses, this);
    gameEvents.on('settings-changed', this.handleSettingsChanged, this);
    gameEvents.on('weapon-select', this.selectWeapon, this);
    gameEvents.on('boss-defeated', this.handleBossDefeated, this);
    gameEvents.on('server-extraction', this.handleServerExtraction, this);
    gameEvents.on('network-snapshot', this.handleNetworkSnapshot, this);
    gameEvents.on('network-status', this.handleNetworkStatus, this);
    gameEvents.on('neural-link-request', this.requestNeuralLink, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('tactical-command', this.handleTacticalCommand, this);
      gameEvents.off('resume-world', this.resumeWorld, this);
      gameEvents.off('squad-changed', this.spawnCompanions, this);
      gameEvents.off('loadout-changed', this.refreshCombatBonuses, this);
      gameEvents.off('settings-changed', this.handleSettingsChanged, this);
      gameEvents.off('weapon-select', this.selectWeapon, this);
      gameEvents.off('boss-defeated', this.handleBossDefeated, this);
      gameEvents.off('server-extraction', this.handleServerExtraction, this);
      gameEvents.off('network-snapshot', this.handleNetworkSnapshot, this);
      gameEvents.off('network-status', this.handleNetworkStatus, this);
      gameEvents.off('neural-link-request', this.requestNeuralLink, this);
      this.scale.off('resize', this.handleResize, this);
    });

    this.emitFeed(`${this.operationDefinition.zoneName} // 작전 ${this.operationDefinition.codename} 투입`);
    this.emitFeed(`현장 임무 ${this.mission.codename}: ${this.mission.description}`);
    this.emitFeed('WASD/방향키 이동 · 마우스 조준/사격 · 중앙 추출 지점에서 E');
    this.startWave(0);
    this.selectWeapon('carbine');
    this.updateOperation();
    this.updateHud(true);
  }

  update(time: number, delta: number): void {
    if (!this.player.active || this.hp <= 0) return;
    const performance = this.performance.sample(delta);
    if (performance) this.emitPerformance(performance);
    this.updatePlayer(time, delta);
    this.collectNearbyResources();
    this.updateCompanions(time);
    this.updateEnemies(time, delta);
    this.updateDirector(time);
    this.updateStorm(time, delta);
    this.checkExtraction();
    this.updateOperation();
    this.updateHud();
  }

  private drawWorld(): void {
    const palette = this.operationDefinition.palette;
    const ground = this.add.graphics();
    ground.fillStyle(palette.ground).fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    ground.lineStyle(1, palette.grid, 0.42);
    for (let axis = 0; axis <= WORLD_SIZE; axis += 80) {
      ground.lineBetween(axis, 0, axis, WORLD_SIZE);
      ground.lineBetween(0, axis, WORLD_SIZE, axis);
    }
    ground.lineStyle(2, palette.accent, 0.16);
    ground.strokeCircle(EXTRACTION_POINT.x, EXTRACTION_POINT.y, 130);
    ground.setDepth(-5);

    const seed = new Phaser.Math.RandomDataGenerator([this.operationDefinition.codename]);
    for (let index = 0; index < 64; index += 1) {
      const x = seed.between(90, WORLD_SIZE - 90);
      const y = seed.between(90, WORLD_SIZE - 90);
      if (Phaser.Math.Distance.Between(x, y, EXTRACTION_POINT.x, EXTRACTION_POINT.y) < 220) continue;
      const scarColor = this.operationId === 'operation-ashfall' ? 0xff6f3c : 0xe2b84c;
      ground.lineStyle(seed.between(1, 3), scarColor, seed.realInRange(0.05, 0.13))
        .strokeCircle(x, y, seed.between(12, 52));
      ground.lineBetween(x - seed.between(8, 30), y, x + seed.between(8, 30), y + seed.between(-18, 18));
    }
    for (const obstacle of this.cover) {
      const sprite = this.obstacles.create(obstacle.x, obstacle.y, obstacle.kind) as Phaser.Physics.Arcade.Sprite;
      sprite.setDisplaySize(obstacle.width, obstacle.height)
        .setTint(seed.pick([...palette.ruinTints]))
        .setAlpha(0.94)
        .setDepth(2);
      sprite.refreshBody();
      ground.lineStyle(2, palette.accent, 0.13)
        .strokeRoundedRect(
          obstacle.x - obstacle.width / 2 - 5,
          obstacle.y - obstacle.height / 2 - 5,
          obstacle.width + 10,
          obstacle.height + 10,
          8,
        );
    }
    if (this.operationId === 'operation-ashfall') {
      for (let index = 0; index < 8; index += 1) {
        const angle = index / 8 * Math.PI * 2;
        const distance = 420 + (index % 2) * 230;
        ground.lineStyle(5, 0xff6f3c, 0.12).lineBetween(
          EXTRACTION_POINT.x + Math.cos(angle) * 170,
          EXTRACTION_POINT.y + Math.sin(angle) * 170,
          EXTRACTION_POINT.x + Math.cos(angle) * distance,
          EXTRACTION_POINT.y + Math.sin(angle) * distance,
        );
      }
    }
    this.extractionRing = this.add.circle(EXTRACTION_POINT.x, EXTRACTION_POINT.y, 64, palette.accent, 0.045)
      .setStrokeStyle(2, palette.accent, 0.7).setDepth(1);
    this.add.text(EXTRACTION_POINT.x, EXTRACTION_POINT.y - 88, `${this.operationDefinition.zoneName} // EXTRACTION`, {
      color: `#${palette.accent.toString(16).padStart(6, '0')}`, fontFamily: 'Share Tech Mono', fontSize: '11px',
    }).setOrigin(0.5);
  }

  private spawnCompanions(): void {
    for (const companion of this.companions) {
      (companion.getData('frame') as Phaser.GameObjects.Image | undefined)?.destroy();
      (companion.getData('label') as Phaser.GameObjects.Text | undefined)?.destroy();
      companion.destroy();
    }
    const squad = this.state.getSquad();
    this.combatBonuses = calculateCombatBonuses(
      squad.map(({ definition }) => definition.id),
      this.state.snapshot().gear.equipped,
    );
    this.linkLeader = neuralLinkLeader(squad.map(({ definition }) => definition.id));
    this.companions = squad.map(({ definition }, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, squad.length);
      const sprite = this.physics.add.sprite(
        this.player.x + Math.cos(angle) * 50,
        this.player.y + Math.sin(angle) * 50,
        `operator-${definition.id}`,
      ).setDepth(4).setDisplaySize(46, 58).setOrigin(0.5, 0.68).setAlpha(0.94);
      const frame = this.add.image(sprite.x, sprite.y, 'operative-frame')
        .setTint(definition.color).setDepth(3.9).setDisplaySize(52, 63).setOrigin(0.5, 0.68);
      const label = this.add.text(sprite.x, sprite.y + 24, definition.callsign, {
        color: '#eafff1', backgroundColor: '#06100dcc', fontFamily: 'Share Tech Mono', fontSize: '7px',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5).setDepth(4.2);
      sprite.setData('operatorId', definition.id);
      sprite.setData('role', definition.role);
      sprite.setData('slot', index);
      sprite.setData('frame', frame);
      sprite.setData('label', label);
      this.tweens.add({
        targets: sprite,
        alpha: 0.76,
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
      const kinds: Array<keyof Resources> = this.operationId === 'operation-ashfall'
        ? ['scrap', 'scrap', 'water', 'data', 'data', 'data']
        : ['scrap', 'scrap', 'scrap', 'water', 'data'];
      const kind = seed.pick(kinds);
      this.spawnResource(seed.between(80, WORLD_SIZE - 80), seed.between(80, WORLD_SIZE - 80), kind, seed.between(2, 7));
    }
  }

  private setupPhysics(): void {
    this.physics.add.collider(this.player, this.obstacles);
    this.physics.add.collider(this.enemies, this.obstacles, undefined, () => !this.networkConnected);
    this.physics.add.collider(this.bullets, this.obstacles, (bulletObject) => {
      const bullet = bulletObject as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active) return;
      const { x, y } = bullet;
      bullet.disableBody(true, true);
      this.impactBurst(x, y, 0xa7b1aa, 3);
    });
    this.physics.add.overlap(this.bullets, this.enemies, (bulletObject, enemyObject) => {
      const bullet = bulletObject as Phaser.Physics.Arcade.Sprite;
      const enemy = enemyObject as EnemySprite;
      if (!bullet.active || !enemy.active) return;
      bullet.disableBody(true, true);
      this.impactBurst(enemy.x, enemy.y, ENEMY_STATS[enemy.archetype ?? 'raider'].tint, 4);
      gameEvents.emit('sfx', 'hit');
      if (this.networkConnected) return;
      const damage = (bullet.getData('damage') as number | undefined) ?? (bullet.getData('companion') ? 14 : 19);
      if (!bullet.getData('companion')) this.neuralLinkCharge = addNeuralCharge(this.neuralLinkCharge, 4);
      enemy.setData('hp', (enemy.getData('hp') as number) - damage);
      this.telemetry.hits += 1;
      enemy.setTintFill(0xffffff);
      this.time.delayedCall(55, () => enemy.active && enemy.clearTint().setTint(ENEMY_STATS[enemy.archetype ?? 'raider'].tint));
      if ((enemy.getData('hp') as number) <= 0) this.defeatEnemy(enemy);
    });

    this.physics.add.overlap(this.player, this.resources, (_playerObject, resourceObject) => {
      this.collectResource(resourceObject as ResourceSprite);
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
      Q: Phaser.Input.Keyboard.KeyCodes.Q,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
      ONE: Phaser.Input.Keyboard.KeyCodes.ONE,
      TWO: Phaser.Input.Keyboard.KeyCodes.TWO,
      THREE: Phaser.Input.Keyboard.KeyCodes.THREE,
    }) as Record<'W' | 'A' | 'S' | 'D' | 'E' | 'Q' | 'SPACE' | 'ONE' | 'TWO' | 'THREE', Phaser.Input.Keyboard.Key>;
  }

  private updatePlayer(time: number, delta: number): void {
    const mobile = this.registry.get('mobileInput') as MobileInputState;
    const controller = this.pollGamepad();
    const digitalHorizontal = Number(this.keys.D.isDown || this.cursors.right.isDown || mobile.right)
      - Number(this.keys.A.isDown || this.cursors.left.isDown || mobile.left);
    const digitalVertical = Number(this.keys.S.isDown || this.cursors.down.isDown || mobile.down)
      - Number(this.keys.W.isDown || this.cursors.up.isDown || mobile.up);
    const horizontal = Math.abs(controller.moveX) > 0.14 ? controller.moveX : digitalHorizontal;
    const vertical = Math.abs(controller.moveY) > 0.14 ? controller.moveY : digitalVertical;
    const movement = new Phaser.Math.Vector2(horizontal, vertical);
    const movementSpeed = 205 * this.combatBonuses.moveSpeedMultiplier;
    if (movement.lengthSq() > 0) {
      movement.normalize().scale(movementSpeed);
      this.player.setVelocity(movement.x, movement.y);
      this.telemetry.distanceMoved += movementSpeed * (delta / 1000);
      this.telemetry.stationarySeconds = Math.max(0, this.telemetry.stationarySeconds - delta / 1600);
    } else {
      this.player.setVelocity(0, 0);
      this.telemetry.stationarySeconds += delta / 1000;
    }

    const pointer = this.input.activePointer;
    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    if (Math.hypot(controller.aimX, controller.aimY) > 0.32) {
      this.player.setRotation(Math.atan2(controller.aimY, controller.aimX) + Math.PI / 2);
    } else if (worldPoint) {
      this.player.setRotation(Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y) + Math.PI / 2);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) this.selectWeapon(weaponFromSlot(1) ?? 'carbine');
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) this.selectWeapon(weaponFromSlot(2) ?? 'scatter');
    if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) this.selectWeapon(weaponFromSlot(3) ?? 'rail');
    if (controller.weaponSlot) this.selectWeapon(weaponFromSlot(controller.weaponSlot) ?? 'carbine');
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q) || controller.link) this.linkRequested = true;
    this.extractRequested ||= Phaser.Input.Keyboard.JustDown(this.keys.E) || mobile.extract || controller.extract;
    mobile.extract = false;
    this.dashCooldownMs = Math.max(0, this.dashCooldownMs - delta);
    const dashActivated = (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || mobile.dash || controller.dash)
      && this.performDash(movement);
    if (this.networkConnected) this.dashNetworkPending ||= dashActivated;
    mobile.dash = false;
    if (this.linkRequested && !this.networkConnected) {
      this.activateNeuralLink();
      this.linkRequested = false;
    }
    const weapon = WEAPON_SPECS[this.currentWeapon];
    const assistedFire = mobile.fire || controller.fire;
    if ((pointer.isDown || assistedFire)
      && time - this.lastShotAt > weapon.cooldownMs * this.combatBonuses.fireCooldownMultiplier) {
      const target = assistedFire ? this.findNearestEnemy(this.player.x, this.player.y, weapon.range) : undefined;
      this.firePlayerWeapon(this.player.x, this.player.y, target?.x ?? worldPoint.x, target?.y ?? worldPoint.y);
      this.lastShotAt = time;
    }
    if (this.networkConnected && time - this.lastNetworkInputAt >= 50) {
      this.network?.sendInput({
        sequence: ++this.networkSequence,
        moveX: movement.lengthSq() > 0 ? movement.x / movementSpeed : 0,
        moveY: movement.lengthSq() > 0 ? movement.y / movementSpeed : 0,
        aimAngle: this.player.rotation - Math.PI / 2,
        fire: pointer.isDown || assistedFire,
        extract: this.extractRequested,
        weapon: this.currentWeapon,
        activateLink: this.linkRequested,
        dash: this.dashNetworkPending,
      });
      this.linkRequested = false;
      this.extractRequested = false;
      this.dashNetworkPending = false;
      this.lastNetworkInputAt = time;
    }
    if (!this.networkConnected && this.combatBonuses.regenPerSecond > 0 && this.hp > 0) {
      this.hp = Math.min(100, this.hp + this.combatBonuses.regenPerSecond * delta / 1000);
    }
  }

  private performDash(movement: Phaser.Math.Vector2): boolean {
    if (this.dashCooldownMs > 0 || this.hp <= 0) return false;
    const angle = movement.lengthSq() > 0 ? movement.angle() : this.player.rotation - Math.PI / 2;
    const startX = this.player.x;
    const startY = this.player.y;
    const destination = resolveCircleMovement({ x: startX, y: startY }, {
      x: Math.cos(angle) * 138,
      y: Math.sin(angle) * 138,
    }, PLAYER_COLLISION_RADIUS, this.cover);
    this.player.setPosition(destination.x, destination.y);
    const trail = this.add.line(0, 0, startX, startY, this.player.x, this.player.y, 0x8bffba, 0.7)
      .setOrigin(0).setLineWidth(8).setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: trail, alpha: 0, duration: this.reducedMotion ? 80 : 220, onComplete: () => trail.destroy() });
    this.dashCooldownMs = 1_800;
    gameEvents.emit('sfx', 'dash');
    gameEvents.emit('haptic', 'light');
    return true;
  }

  private pollGamepad(): {
    moveX: number; moveY: number; aimX: number; aimY: number; fire: boolean;
    dash: boolean; extract: boolean; link: boolean; weaponSlot?: 1 | 2 | 3;
  } {
    const pad = typeof navigator.getGamepads === 'function'
      ? [...navigator.getGamepads()].find((candidate): candidate is Gamepad => Boolean(candidate?.connected))
      : undefined;
    if (!pad) {
      if (this.gamepadConnected) this.emitFeed('게임패드 연결이 해제되었습니다.');
      this.gamepadConnected = false;
      this.gamepadButtons.clear();
      return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, dash: false, extract: false, link: false };
    }
    if (!this.gamepadConnected) this.emitFeed('게임패드 연결 // A 사격 · B 회피 · X 추출 · Y 뉴럴 링크');
    this.gamepadConnected = true;
    const pressed = new Set<number>();
    pad.buttons.forEach((button, index) => { if (button.pressed) pressed.add(index); });
    const justPressed = (index: number) => pressed.has(index) && !this.gamepadButtons.has(index);
    const result = {
      moveX: pad.axes[0] ?? 0,
      moveY: pad.axes[1] ?? 0,
      aimX: pad.axes[2] ?? 0,
      aimY: pad.axes[3] ?? 0,
      fire: Boolean(pad.buttons[0]?.pressed || pad.buttons[7]?.pressed),
      dash: justPressed(1),
      extract: justPressed(2),
      link: justPressed(3),
      weaponSlot: (justPressed(12) ? 1 : justPressed(13) ? 2 : justPressed(14) ? 3 : undefined) as 1 | 2 | 3 | undefined,
    };
    this.gamepadButtons = pressed;
    return result;
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
      const frame = companion.getData('frame') as Phaser.GameObjects.Image | undefined;
      const label = companion.getData('label') as Phaser.GameObjects.Text | undefined;
      frame?.setPosition(companion.x, companion.y);
      label?.setPosition(companion.x, companion.y + 24);
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
      if ((archetype === 'warden' || archetype === 'harvester') && time > this.bossAbilityAt) {
        this.bossAbilityAt = time + (enemy.getData('hp') < stats.hp * 0.5 ? 2_500 : 3_900);
        if (archetype === 'harvester') this.triggerHarvesterPattern(enemy);
        else this.triggerBossShockwave(enemy);
      }
      const attackRange = archetype === 'harvester' ? 165
        : archetype === 'warden' ? 125
          : archetype === 'relay' ? 240
            : archetype === 'sapper' || archetype === 'jammer' ? 180 : 30;
      const hasCoverBetween = isLineBlocked(enemy, target, this.cover, 2);
      if (distance > attackRange || hasCoverBetween) {
        if (archetype === 'relay') {
          enemy.setVelocity(0, 0);
          return true;
        }
        let offset = 0;
        if (archetype === 'stalker' || archetype === 'sapper') offset = Math.sin(time * 0.004 + enemy.x) * 0.9;
        if (hasCoverBetween) offset += ((enemy.getData('flankSign') as number | undefined) ?? 1) * Math.PI / 2;
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y) + offset;
        const enraged = (archetype === 'warden' || archetype === 'harvester')
          && enemy.getData('hp') < stats.hp * 0.5 ? 1.35 : 1;
        enemy.setVelocity(Math.cos(angle) * stats.speed * enraged, Math.sin(angle) * stats.speed * enraged);
      } else if (time > (enemy.getData('attackAt') as number)) {
        enemy.setData('attackAt', time + (archetype === 'harvester' ? 1_200
          : archetype === 'warden' ? 1_350
            : archetype === 'relay' || archetype === 'jammer' ? 1_450 : 820));
        if (target === this.player) {
          this.damagePlayer(stats.damage);
          if (archetype === 'jammer') {
            this.neuralLinkCharge = Math.max(0, this.neuralLinkCharge - 18);
            this.impactBurst(this.player.x, this.player.y, stats.tint, 10);
            this.emitFeed('뉴럴 재머 피격 // 링크 게이지 -18%', true);
          }
          if (archetype === 'relay') {
            this.neuralLinkCharge = Math.max(0, this.neuralLinkCharge - 12);
            this.emitFeed('신경 중계기 EMP // 링크 게이지 -12%', true);
          }
          if (archetype === 'sapper') {
            this.radiation = Phaser.Math.Clamp(this.radiation + 8, 0, 100);
            this.emitFeed('산성 침식탄 피격 // 방사선 +8%', true);
          }
        }
      }
      enemy.setRotation(Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y));
      if (distance > 1250 && !['warden', 'harvester', 'relay'].includes(archetype)) enemy.disableBody(true, true);
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
    this.radiation = Phaser.Math.Clamp(this.radiation + (this.stormActive
      ? delta * 0.0017 * this.combatBonuses.radiationGainMultiplier
      : -delta * 0.0025), 0, 100);
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

  private triggerHarvesterPattern(enemy: EnemySprite): void {
    const pattern = Number(enemy.getData('abilityPattern') ?? 0);
    enemy.setData('abilityPattern', pattern + 1);
    if (pattern % 3 === 2) {
      this.emitFeed('헤카톤 수확 포드 전개 // 증원 개체 낙하', true);
      this.spawnEnemy('sapper', 230);
      this.spawnEnemy('drone', 270);
      gameEvents.emit('sfx', 'boss-ability');
      return;
    }
    if (pattern % 2 === 0) {
      const targetX = this.player.x;
      const targetY = this.player.y;
      const warning = this.add.circle(targetX, targetY, 106, 0xff7138, 0.06)
        .setStrokeStyle(3, 0xffa45c, 0.96).setDepth(7);
      this.emitFeed('헤카톤 산성 포격 조준 // 경고 지대 이탈', true);
      gameEvents.emit('sfx', 'boss-ability');
      this.time.delayedCall(this.reducedMotion ? 520 : 760, () => {
        if (!warning.active) return;
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, targetX, targetY);
        warning.setFillStyle(0xff7138, 0.24).setScale(1.14);
        this.impactBurst(targetX, targetY, 0xff8b3d, 26);
        if (distance < 106 && enemy.active && this.player.active) {
          this.radiation = Phaser.Math.Clamp(this.radiation + 14, 0, 100);
          this.damagePlayer(28);
        }
        this.tweens.add({ targets: warning, alpha: 0, scale: 1.55, duration: 190, onComplete: () => warning.destroy() });
      });
      return;
    }
    const pulse = this.add.circle(enemy.x, enemy.y, 36, 0xe678ff, 0.08)
      .setStrokeStyle(4, 0xe678ff, 0.92).setDepth(7);
    this.emitFeed('헤카톤 EMP 맥동 충전 // 보스와 거리 확보', true);
    gameEvents.emit('sfx', 'boss-ability');
    this.tweens.add({ targets: pulse, scale: 8.5, alpha: 0.75, duration: this.reducedMotion ? 360 : 620 });
    this.time.delayedCall(this.reducedMotion ? 380 : 650, () => {
      if (!pulse.active) return;
      if (enemy.active && Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < 310) {
        this.neuralLinkCharge = Math.max(0, this.neuralLinkCharge - 30);
        this.radiation = Phaser.Math.Clamp(this.radiation + 18, 0, 100);
        this.damagePlayer(8);
      }
      this.tweens.add({ targets: pulse, alpha: 0, scale: 10, duration: 160, onComplete: () => pulse.destroy() });
    });
  }

  private startWave(delay: number): void {
    this.waveAt = delay;
    this.stormAt = 31_000;
  }

  private updateOperation(): void {
    this.operationStatus = evaluateOperation(this.operationId, {
      collected: this.operationCollected,
      dataCollected: this.operationDataCollected,
      kills: this.missionKills,
      relaysDestroyed: this.operationRelaysDestroyed,
      bossDefeated: this.operationBossDefeated,
      extracted: this.operationExtracted,
    });
    if (this.operationStage === this.operationStatus.stage) return;
    this.operationStage = this.operationStatus.stage;
    gameEvents.emit('operation-update', this.operationStatus);
    this.emitFeed(`${this.operationStatus.code}: ${this.operationStatus.objective}`,
      this.operationStatus.stage === 'WARDEN' || this.operationStatus.stage === 'RELAY');
    if (this.operationStatus.stage === 'RELAY' && !this.operationRelaysSpawned && !this.networkConnected) {
      this.operationRelaysSpawned = true;
      this.spawnRelayNetwork();
    }
    if (this.operationStatus.stage === 'WARDEN' && !this.operationBossSpawned && !this.networkConnected) {
      this.operationBossSpawned = true;
      this.spawnEnemy(this.operationDefinition.bossKind);
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

  private spawnEnemy(archetype: EnemyKind, forcedDistance?: number): void {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const isBoss = archetype === 'warden' || archetype === 'harvester';
    const distance = forcedDistance ?? (isBoss ? 560 : Phaser.Math.Between(430, 680));
    const position = findOpenPosition({
      x: Phaser.Math.Clamp(this.player.x + Math.cos(angle) * distance, 24, WORLD_SIZE - 24),
      y: Phaser.Math.Clamp(this.player.y + Math.sin(angle) * distance, 24, WORLD_SIZE - 24),
    }, isBoss ? 38 : archetype === 'breaker' || archetype === 'relay' ? 24 : 14, this.cover);
    const { x, y } = position;
    const stats = ENEMY_STATS[archetype];
    const enemy = this.enemies.get(x, y, stats.texture) as EnemySprite | null;
    if (!enemy) return;
    enemy.setTexture(stats.texture).enableBody(true, x, y, true, true)
      .setTint(stats.tint).setScale(stats.scale).setDepth(3).setAlpha(0);
    enemy.archetype = archetype;
    enemy.setData('hp', stats.hp).setData('attackAt', 0)
      .setData('flankSign', Phaser.Math.Between(0, 1) === 0 ? -1 : 1)
      .setCircle(isBoss ? 36 : archetype === 'relay' ? 24 : archetype === 'breaker' ? 20 : 12,
        isBoss ? 14 : archetype === 'relay' ? 8 : archetype === 'breaker' ? 8 : 4,
        isBoss ? 14 : archetype === 'relay' ? 8 : archetype === 'breaker' ? 8 : 4);
    this.tweens.add({ targets: enemy, alpha: 1, duration: this.reducedMotion ? 60 : 260 });
    this.impactBurst(x, y, stats.tint, isBoss ? 24 : archetype === 'breaker' ? 10 : 4);
    if (isBoss) {
      if (!this.bossIntroShown) {
        this.bossIntroShown = true;
        gameEvents.emit('boss-intro', this.operationDefinition);
      }
      this.cameras.main.flash(300, 255, 34, 74, false);
      gameEvents.emit('sfx', 'boss');
      gameEvents.emit('haptic', 'warning');
    }
  }

  private spawnRelayNetwork(): void {
    for (const position of RELAY_POSITIONS) {
      const stats = ENEMY_STATS.relay;
      const enemy = this.enemies.get(position.x, position.y, stats.texture) as EnemySprite | null;
      if (!enemy) continue;
      enemy.setTexture(stats.texture).enableBody(true, position.x, position.y, true, true)
        .setTint(stats.tint).setScale(stats.scale).setDepth(3);
      enemy.archetype = 'relay';
      enemy.setData('hp', stats.hp).setData('attackAt', 0).setCircle(24, 8, 8);
      this.impactBurst(position.x, position.y, stats.tint, 16);
    }
    this.emitFeed('신경 중계기 3기 노출 // EMP 방출 범위를 경계하십시오.', true);
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
        spec.damage * this.combatBonuses.damageMultiplier,
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
    const muzzle = this.acquireEffect(
      fromX + Math.cos(angle) * 18,
      fromY + Math.sin(angle) * 18,
      'muzzle',
    );
    if (muzzle) {
      muzzle.setTint(tint).setRotation(angle).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: muzzle, alpha: 0, scaleX: 1.8, duration: 65,
        onComplete: () => this.releaseEffect(muzzle),
      });
    }
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
    const isBoss = archetype === 'warden' || archetype === 'harvester';
    this.impactBurst(x, y, tint, isBoss ? 34 : archetype === 'breaker' || archetype === 'relay' ? 18 : 10);
    gameEvents.emit('sfx', 'kill');
    gameEvents.emit('haptic', archetype === 'breaker' ? 'heavy' : 'light');
    this.missionKills += 1;
    this.neuralLinkCharge = addNeuralCharge(this.neuralLinkCharge, 12);
    this.telemetry.kills += 1;
    this.state.recordKill();
    if (archetype === 'relay') {
      this.operationRelaysDestroyed += 1;
      this.spawnResource(x, y, 'data', 6);
      this.emitFeed(`신경 중계기 파괴 // ${this.operationRelaysDestroyed}/3`);
      gameEvents.emit('haptic', 'success');
      return;
    }
    if (isBoss) {
      this.operationBossDefeated = true;
      const ashfall = archetype === 'harvester';
      this.spawnResource(x - 14, y, 'cores', ashfall ? 3 : 2);
      this.spawnResource(x + 14, y, 'data', ashfall ? 28 : 18);
      this.emitFeed(`${this.operationDefinition.bossName} 파괴 // 작전 화물을 확보하고 추출하십시오.`);
      gameEvents.emit('sfx', 'boss-down');
      gameEvents.emit('haptic', 'success');
      return;
    }
    const kind: keyof Resources = archetype === 'jammer' || archetype === 'sapper'
      ? 'data' : Math.random() < 0.28 ? this.mission.targetResource : 'scrap';
    this.spawnResource(x, y, kind, archetype === 'breaker' ? 8 : Phaser.Math.Between(1, 4));
    if (Math.random() < 0.035) this.spawnResource(x + 12, y, 'cores', 1);
  }

  private spawnResource(x: number, y: number, kind: keyof Resources, value: number): void {
    const position = findOpenPosition({ x, y }, 12, this.cover);
    const resource = this.resources.get(position.x, position.y, RESOURCE_TEXTURES[kind]) as ResourceSprite | null;
    if (!resource) return;
    const tints: Record<keyof Resources, number> = { scrap: 0xa7b1aa, water: 0x61b9ff, data: 0xb47cff, cores: 0xffd76a };
    resource.setTexture(RESOURCE_TEXTURES[kind]).enableBody(true, position.x, position.y, true, true).setTint(tints[kind]).setDepth(2).setScale(0.9);
    resource.resourceKind = kind;
    resource.value = value;
    this.tweens.killTweensOf(resource);
    this.tweens.add({ targets: resource, angle: 180, yoyo: true, repeat: -1, duration: 1100 });
  }

  private collectNearbyResources(): void {
    if (this.networkConnected) return;
    this.resources.children.each((child) => {
      const resource = child as ResourceSprite;
      if (!resource.active) return true;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, resource.x, resource.y)
        <= this.combatBonuses.pickupRadius) this.collectResource(resource);
      return true;
    });
  }

  private collectResource(resource: ResourceSprite): void {
    if (this.networkConnected || !resource.active) return;
    const kind = resource.resourceKind ?? 'scrap';
    const value = resource.value ?? 1;
    const { x, y } = resource;
    this.fieldCargo[kind] += value;
    this.operationCollected += value;
    if (kind === 'data') this.operationDataCollected += value;
    resource.disableBody(true, true);
    this.impactBurst(x, y, 0xffffff, 6);
    gameEvents.emit('sfx', 'pickup');
    gameEvents.emit('haptic', 'light');
    this.emitFeed(`${kind.toUpperCase()} +${value} // 현장 화물`);
  }

  private findNearestEnemy(x: number, y: number, maxDistance = 620): EnemySprite | undefined {
    let nearest: EnemySprite | undefined;
    let nearestDistance = maxDistance;
    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (!enemy.active) return true;
      const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (distance < nearestDistance && !isLineBlocked({ x, y }, enemy, this.cover)) {
        nearest = enemy;
        nearestDistance = distance;
      }
      return true;
    });
    return nearest;
  }

  private checkExtraction(): void {
    if (this.networkConnected) return;
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, EXTRACTION_POINT.x, EXTRACTION_POINT.y);
    const hasCargo = Object.values(this.fieldCargo).some((value) => value > 0);
    this.extractionRing.setStrokeStyle(2, hasCargo && distance < 120 ? 0xc9f456 : 0x8bffba, 0.7);
    const requested = this.extractRequested;
    this.extractRequested = false;
    if (distance < 72 && hasCargo && requested) {
      const cargo = { ...this.fieldCargo };
      this.state.recordExtraction(cargo.scrap);
      this.state.addResources({ water: cargo.water, data: cargo.data, cores: cargo.cores });
      this.fieldCargo = { scrap: 0, water: 0, data: 0, cores: 0 };
      this.impactBurst(EXTRACTION_POINT.x, EXTRACTION_POINT.y, 0xc9f456, 22);
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
    this.state.completeOperation(this.operationId);
    if (!online) this.state.addResources(this.operationDefinition.rewards);
    this.updateOperation();
    gameEvents.emit('operation-complete', {
      operationId: this.operationId,
      codename: this.operationDefinition.codename,
      title: this.operationDefinition.completionTitle,
      narrative: this.operationDefinition.completionNarrative,
      kills: this.missionKills,
      collected: this.operationCollected,
      weapon: WEAPON_SPECS[this.currentWeapon].name,
      online,
      bonusCores: online ? 0 : this.operationDefinition.rewards.cores,
      bonusData: online ? 0 : this.operationDefinition.rewards.data,
      nextOperationId: this.state.activeOperationId(),
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

  private requestNeuralLink(): void {
    this.linkRequested = true;
  }

  private activateNeuralLink(): boolean {
    if (this.neuralLinkCharge < NEURAL_LINK_MAX || this.hp <= 0) {
      if (this.neuralLinkCharge < NEURAL_LINK_MAX) this.emitFeed(`뉴럴 링크 충전 부족 // ${Math.floor(this.neuralLinkCharge)}%`);
      return false;
    }
    const operatorId = this.linkLeader;
    const operator = getOperator(operatorId);
    const skill = neuralLinkSkill(operatorId);
    this.neuralLinkCharge = 0;

    if (skill.role === 'Vanguard') {
      this.hp = Math.min(100, this.hp + 15);
      const ring = this.add.circle(this.player.x, this.player.y, 20, skill.color, 0.1)
        .setStrokeStyle(4, skill.color, 0.9).setDepth(8);
      this.tweens.add({ targets: ring, scale: 13, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
      for (const child of this.enemies.getChildren()) {
        const enemy = child as EnemySprite;
        if (!enemy.active || Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) > 260) continue;
        enemy.setData('hp', Number(enemy.getData('hp') ?? 0) - 55);
        this.impactBurst(enemy.x, enemy.y, skill.color, 12);
        if (Number(enemy.getData('hp')) <= 0) this.defeatEnemy(enemy);
      }
    } else if (skill.role === 'Sniper') {
      const targets = this.enemies.getChildren().filter((child) => (child as EnemySprite).active)
        .map((child) => child as EnemySprite)
        .sort((left, right) => Phaser.Math.Distance.Between(left.x, left.y, this.player.x, this.player.y)
          - Phaser.Math.Distance.Between(right.x, right.y, this.player.x, this.player.y))
        .slice(0, 3);
      for (const enemy of targets) {
        enemy.setData('hp', Number(enemy.getData('hp') ?? 0) - 95);
        this.impactBurst(enemy.x, enemy.y, skill.color, 18);
        if (Number(enemy.getData('hp')) <= 0) this.defeatEnemy(enemy);
      }
    } else if (skill.role === 'Support') {
      this.hp = Math.min(100, this.hp + 45);
      this.radiation = Math.max(0, this.radiation - 45);
      this.impactBurst(this.player.x, this.player.y, skill.color, 22);
    } else {
      this.fieldCargo.scrap += 12;
      this.fieldCargo.data += 3;
      this.operationCollected += 15;
      this.operationDataCollected += 3;
      this.impactBurst(this.player.x, this.player.y, skill.color, 24);
    }

    this.state.remember(operatorId, `${skill.name} 뉴럴 링크를 전장에서 발동했다.`);
    gameEvents.emit('neural-link-activated', operatorId, skill.name);
    gameEvents.emit('sfx', 'neural-link');
    gameEvents.emit('haptic', 'success');
    this.cameras.main.flash(260, 160, 255, 220, false);
    this.emitFeed(`${operator.callsign} // ${skill.name} 발동`);
    return true;
  }

  private damagePlayer(amount: number): void {
    const appliedDamage = amount * this.combatBonuses.damageTakenMultiplier;
    this.hp = Math.max(0, this.hp - appliedDamage);
    if (!this.networkConnected) this.neuralLinkCharge = addNeuralCharge(this.neuralLinkCharge, 6);
    this.telemetry.damageTaken += appliedDamage;
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

  private refreshCombatBonuses(): void {
    const snapshot = this.state.snapshot();
    this.combatBonuses = calculateCombatBonuses(snapshot.squad, snapshot.gear.equipped);
  }

  private updateHud(force = false): void {
    const now = this.time.now;
    if (!force && now - this.lastHudAt < this.performance.profile.hudIntervalMs) return;
    this.lastHudAt = now;
    const boss = [...this.enemies.getChildren()].find((child) => (
      (child as EnemySprite).active && (child as EnemySprite).archetype === this.operationDefinition.bossKind
    )) as EnemySprite | undefined;
    gameEvents.emit('hud-update', {
      hp: this.hp,
      radiation: this.radiation,
      cargo: { ...this.fieldCargo },
      kills: this.missionKills,
      mission: this.mission,
      operation: this.operationStatus,
      weapon: this.currentWeapon,
      linkCharge: this.neuralLinkCharge,
      linkLeader: this.linkLeader,
      dashCooldownMs: this.dashCooldownMs,
      boss: boss ? {
        hp: Number(boss.getData('hp') ?? 0),
        maxHp: ENEMY_STATS[this.operationDefinition.bossKind].hp,
        name: this.operationDefinition.bossName,
      } : null,
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
    const sessionChanged = Boolean(this.networkSessionId && this.networkSessionId !== snapshot.localSessionId);
    if (!this.networkConnected || sessionChanged) {
      this.networkConnected = true;
      this.enemies.clear(true, true);
      this.resources.clear(true, true);
      this.serverEnemies.clear();
      this.serverResources.clear();
      this.fieldCargo = { scrap: 0, water: 0, data: 0, cores: 0 };
      this.lastNetworkCargo = 0;
      this.operationCollected = 0;
      this.operationDataCollected = 0;
      this.operationRelaysDestroyed = 0;
      this.operationBossSpawned = false;
      this.operationBossDefeated = false;
      this.emitFeed(sessionChanged
        ? '새 서버 세션 동기화 // 미확정 현장 진행을 초기화했습니다.'
        : '서버 권위형 전투 판정으로 전환되었습니다.');
    }
    this.networkSessionId = snapshot.localSessionId;
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
      if (nextCargoTotal > this.lastNetworkCargo) {
        this.operationCollected += nextCargoTotal - this.lastNetworkCargo;
      }
      if (nextCargo.data > this.fieldCargo.data) this.operationDataCollected += nextCargo.data - this.fieldCargo.data;
      this.lastNetworkCargo = nextCargoTotal;
      this.fieldCargo = nextCargo;
      this.networkSequence = Math.max(this.networkSequence, own.lastSequence);
      this.neuralLinkCharge = own.linkCharge;
      this.dashCooldownMs = Math.max(this.dashCooldownMs, own.dashCooldownMs);
    }
    this.operationRelaysDestroyed = snapshot.relaysDestroyed;
    if (snapshot.bossDefeated) this.operationBossDefeated = true;
    if (snapshot.enemies.some((enemy) => enemy.kind === this.operationDefinition.bossKind)) this.operationBossSpawned = true;
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

  private handleNetworkStatus(status: 'online' | 'offline' | 'connecting' | 'reconnecting'): void {
    if (status !== 'offline' || !this.networkConnected) return;
    this.networkConnected = false;
    this.serverEnemies.clear();
    this.serverResources.clear();
    this.emitFeed('서버 링크 만료 // 현재 전장을 로컬 훈련 판정으로 전환합니다.', true);
  }

  private syncNetworkEnemies(enemies: NetworkSnapshot['enemies']): void {
    const incoming = new Set(enemies.map((enemy) => enemy.id));
    for (const [id, sprite] of this.serverEnemies) {
      if (incoming.has(id)) continue;
      this.impactBurst(sprite.x, sprite.y, ENEMY_STATS[sprite.archetype ?? 'raider'].tint, 8);
      gameEvents.emit('sfx', 'kill');
      if (sprite.archetype === this.operationDefinition.bossKind) this.handleBossDefeated();
      sprite.disableBody(true, true);
      this.serverEnemies.delete(id);
    }
    for (const source of enemies) {
      let sprite = this.serverEnemies.get(source.id);
      if (!sprite) {
        sprite = this.enemies.get(source.x, source.y, ENEMY_STATS[source.kind].texture) as EnemySprite | null ?? undefined;
        if (!sprite) continue;
        this.serverEnemies.set(source.id, sprite);
        if (source.kind === this.operationDefinition.bossKind && !this.bossIntroShown) {
          this.bossIntroShown = true;
          gameEvents.emit('boss-intro', this.operationDefinition);
          gameEvents.emit('sfx', 'boss');
          gameEvents.emit('haptic', 'warning');
        }
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
    const scaledCount = Math.max(1, Math.ceil(requestedCount * this.performance.profile.particleScale));
    const count = this.reducedMotion ? Math.min(3, scaledCount) : scaledCount;
    for (let index = 0; index < count; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(16, this.reducedMotion ? 25 : 48);
      const spark = this.acquireEffect(x, y, 'spark');
      if (!spark) break;
      spark.setTint(tint)
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
        onComplete: () => this.releaseEffect(spark),
      });
    }
  }

  private handleSettingsChanged(settings: PlayerSettings): void {
    this.reducedMotion = settings.reducedMotion;
    const tier = this.performance.setMode(
      settings.graphicsQuality,
      navigator.maxTouchPoints > 0 || this.scale.width < 820,
    );
    this.emitPerformance({ tier, fps: 0, changed: true });
  }

  private acquireEffect(x: number, y: number, texture: string): Phaser.GameObjects.Image | null {
    const effect = this.transientEffects.get(x, y, texture) as Phaser.GameObjects.Image | null;
    if (!effect) return null;
    this.tweens.killTweensOf(effect);
    return effect.setActive(true).setVisible(true).setTexture(texture).setPosition(x, y)
      .clearTint().setAlpha(1).setScale(1).setRotation(0);
  }

  private releaseEffect(effect: Phaser.GameObjects.Image): void {
    this.tweens.killTweensOf(effect);
    effect.setActive(false).setVisible(false);
    this.transientEffects.killAndHide(effect);
  }

  private emitPerformance(sample: PerformanceSample): void {
    gameEvents.emit('performance-sample', sample);
    if (sample.changed && sample.fps > 0) {
      this.emitFeed(`자동 그래픽 조정 // ${sample.tier.toUpperCase()} · ${sample.fps} FPS`);
    }
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
