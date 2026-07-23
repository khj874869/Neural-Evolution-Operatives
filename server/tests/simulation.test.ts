import { describe, expect, it } from 'vitest';
import { EXTRACTION_POINT, RedZoneSimulation } from '../src/simulation/RedZoneSimulation.js';
import { PLAYER_COLLISION_RADIUS, worldObstacles } from '../../packages/shared/src/world.js';

describe('authoritative red zone simulation', () => {
  it('accepts ordered inputs and rejects replayed sequences', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-1', 'player-1', 'TESTER');
    const initialX = player.x;
    expect(simulation.applyInput('session-1', {
      sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: false, extract: false, weapon: 'carbine',
    })).toBe(true);
    expect(simulation.applyInput('session-1', {
      sequence: 1, moveX: -1, moveY: 0, aimAngle: 0, fire: false, extract: false, weapon: 'carbine',
    })).toBe(false);
    simulation.tick(100);
    expect(player.x).toBeGreaterThan(initialX);
    expect(player.lastSequence).toBe(1);
  });

  it('neutralizes held movement and fire while a reconnecting player is suspended', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    simulation.enemies.clear();
    const player = simulation.addPlayer('session-drop', 'player-drop', 'LINK-DROP');
    simulation.applyInput('session-drop', {
      sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: true, extract: false, weapon: 'carbine',
    });
    simulation.tick(100);
    const suspendedAt = player.x;
    expect(simulation.suspendPlayer('session-drop')).toBe(true);
    simulation.tick(500);
    expect(player.x).toBe(suspendedAt);
    expect(player.lastSequence).toBe(1);
  });

  it('creates one extraction event and clears field cargo', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    simulation.resources.clear();
    const player = simulation.addPlayer('session-2', 'player-2', 'EXTRACTOR');
    player.x = EXTRACTION_POINT.x;
    player.y = EXTRACTION_POINT.y;
    player.cargo.scrap = 15;
    simulation.applyInput('session-2', {
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: true, weapon: 'carbine',
    });
    simulation.tick(50);
    const extraction = simulation.drainEvents().find((event) => event.type === 'extraction');
    expect(extraction).toMatchObject({ type: 'extraction', cargo: { scrap: 15 } });
    expect(player.cargo.scrap).toBe(0);
    simulation.tick(50);
    expect(simulation.drainEvents().some((event) => event.type === 'extraction')).toBe(false);
  });

  it('applies operator squad bonuses inside the authoritative simulation', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-3', 'player-3', 'LINKER', ['morrow', 'ember', 'lumen']);
    expect(player.bonuses.damageMultiplier).toBe(1.18);
    expect(player.bonuses.fireCooldownMultiplier).toBe(0.86);
    expect(player.bonuses.moveSpeedMultiplier).toBe(1.05);
    expect(player.bonuses.regenPerSecond).toBe(0.8);
    expect(simulation.updateSquad('session-3', ['aegis-07', 'ratchet', 'rook'])).toBe(true);
    expect(player.bonuses.radiationGainMultiplier).toBe(0.82);
    expect(player.bonuses.pickupRadius).toBe(42);
    expect(player.bonuses.damageTakenMultiplier).toBe(0.88);
  });

  it('accepts weapon selection and deploys the operation boss after salvage and kills', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-4', 'player-4', 'WARDEN-HUNTER');
    player.kills = 10;
    player.cargo.scrap = 8;
    expect(simulation.applyInput('session-4', {
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: false, weapon: 'rail',
    })).toBe(true);
    simulation.tick(50);
    expect([...simulation.enemies.values()].some((enemy) => enemy.kind === 'warden')).toBe(true);
    expect(simulation.drainEvents().some((event) => event.type === 'feed' && event.message.includes('케르베로스'))).toBe(true);
  });

  it('deploys ashfall relays before the harvester boss', () => {
    const simulation = new RedZoneSimulation(() => 0.5, 'operation-ashfall');
    const player = simulation.addPlayer('session-ash', 'player-ash', 'RELAY-CUTTER');
    player.kills = 16;
    player.cargo.data = 12;
    simulation.tick(50);
    expect([...simulation.enemies.values()].filter((enemy) => enemy.kind === 'relay')).toHaveLength(3);
    expect([...simulation.enemies.values()].some((enemy) => enemy.kind === 'harvester')).toBe(false);
    simulation.relaysDestroyed = 3;
    simulation.tick(50);
    expect([...simulation.enemies.values()].some((enemy) => enemy.kind === 'harvester')).toBe(true);
    expect(simulation.drainEvents().some((event) => event.type === 'feed' && event.message.includes('헤카톤'))).toBe(true);
  });

  it('uses the shared coil-gun damage in authoritative hit resolution', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    simulation.resources.clear();
    const player = simulation.addPlayer('session-5', 'player-5', 'MARKSMAN');
    simulation.enemies.clear();
    simulation.enemies.set('target', {
      id: 'target', kind: 'warden', x: player.x + 120, y: player.y, hp: 520, attackCooldownMs: 9_999,
    });
    simulation.applyInput('session-5', {
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: true, extract: false, weapon: 'rail',
    });
    simulation.tick(50);
    expect(simulation.enemies.get('target')?.hp).toBe(472);
  });

  it('applies equipped gear bonuses inside authoritative combat', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    simulation.resources.clear();
    const player = simulation.addPlayer(
      'session-gear', 'player-gear', 'GEAR-TESTER', [], ['coil-governor'],
    );
    simulation.enemies.clear();
    simulation.enemies.set('gear-target', {
      id: 'gear-target', kind: 'warden', x: player.x + 120, y: player.y, hp: 520, attackCooldownMs: 9_999,
    });
    simulation.applyInput('session-gear', {
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: true, extract: false, weapon: 'rail',
    });
    simulation.tick(50);
    expect(simulation.enemies.get('gear-target')?.hp).toBeCloseTo(466.24);
    expect(player.bonuses.fireCooldownMultiplier).toBeCloseTo(0.96);
  });

  it('prevents authoritative movement and dashes from crossing hard cover', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-cover', 'player-cover', 'BREACHER');
    simulation.enemies.clear();
    simulation.resources.clear();
    const obstacle = worldObstacles('operation-zero')[0];
    const leftEdge = obstacle.x - obstacle.width / 2;
    player.x = leftEdge - PLAYER_COLLISION_RADIUS - 4;
    player.y = obstacle.y;
    simulation.applyInput('session-cover', {
      sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: false, extract: false,
      weapon: 'carbine', dash: true,
    });
    simulation.tick(100);
    expect(player.x).toBeLessThanOrEqual(leftEdge - PLAYER_COLLISION_RADIUS);
    for (let index = 0; index < 12; index += 1) simulation.tick(100);
    expect(player.x).toBeLessThanOrEqual(leftEdge - PLAYER_COLLISION_RADIUS);
  });

  it('uses hard cover to block authoritative weapon hits', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-los', 'player-los', 'MARKSMAN');
    simulation.enemies.clear();
    simulation.resources.clear();
    const obstacle = worldObstacles('operation-zero')[0];
    player.x = obstacle.x - obstacle.width / 2 - 80;
    player.y = obstacle.y;
    simulation.enemies.set('covered-target', {
      id: 'covered-target', kind: 'warden',
      x: obstacle.x + obstacle.width / 2 + 80, y: obstacle.y,
      hp: 520, attackCooldownMs: 9_999,
    });
    simulation.applyInput('session-los', {
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: true, extract: false,
      weapon: 'rail',
    });
    simulation.tick(50);
    expect(simulation.enemies.get('covered-target')?.hp).toBe(520);
  });

  it('makes ranged enemies flank instead of attacking through cover', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-flank', 'player-flank', 'SURVIVOR');
    simulation.enemies.clear();
    simulation.resources.clear();
    const obstacle = worldObstacles('operation-zero')[1];
    player.x = obstacle.x - obstacle.width / 2 - 30;
    player.y = obstacle.y;
    simulation.enemies.set('covered-jammer', {
      id: 'covered-jammer', kind: 'jammer',
      x: obstacle.x + obstacle.width / 2 + 30, y: obstacle.y,
      hp: 55, attackCooldownMs: 0,
    });
    for (let index = 0; index < 10; index += 1) simulation.tick(100);
    const jammer = simulation.enemies.get('covered-jammer');
    expect(player.hp).toBe(100);
    expect(jammer?.y).not.toBe(obstacle.y);
  });

  it('activates a charged leader skill only inside the authoritative simulation', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-link', 'player-link', 'LINKER', ['lumen', 'ratchet', 'rook']);
    player.hp = 40;
    player.radiation = 70;
    player.linkCharge = 100;
    simulation.applyInput('session-link', {
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: false,
      weapon: 'carbine', activateLink: true,
    });
    simulation.tick(50);
    expect(player.hp).toBeGreaterThan(84);
    expect(player.radiation).toBeLessThan(26);
    expect(player.linkCharge).toBe(0);
    expect(simulation.drainEvents()).toContainEqual(expect.objectContaining({
      type: 'neural-link', operatorId: 'lumen', skillName: 'PULSE RESTORE',
    }));
  });

  it('validates dash cooldown and neural jammer disruption on the server', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    simulation.resources.clear();
    simulation.enemies.clear();
    const player = simulation.addPlayer('session-dash', 'player-dash', 'RUNNER');
    const initialX = player.x;
    simulation.applyInput('session-dash', {
      sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: false, extract: false,
      weapon: 'carbine', dash: true,
    });
    simulation.tick(50);
    expect(player.x).toBeGreaterThan(initialX + 130);
    const afterDash = player.x;
    simulation.applyInput('session-dash', {
      sequence: 2, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: false,
      weapon: 'carbine', dash: true,
    });
    simulation.tick(50);
    expect(player.x).toBe(afterDash);

    player.linkCharge = 60;
    simulation.enemies.set('jammer-test', {
      id: 'jammer-test', kind: 'jammer', x: player.x + 100, y: player.y, hp: 55, attackCooldownMs: 0,
    });
    simulation.tick(50);
    expect(player.linkCharge).toBeLessThan(60);
  });
});
