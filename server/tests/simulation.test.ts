import { describe, expect, it } from 'vitest';
import { EXTRACTION_POINT, RedZoneSimulation } from '../src/simulation/RedZoneSimulation.js';

describe('authoritative red zone simulation', () => {
  it('accepts ordered inputs and rejects replayed sequences', () => {
    const simulation = new RedZoneSimulation(() => 0.5);
    const player = simulation.addPlayer('session-1', 'player-1', 'TESTER');
    const initialX = player.x;
    expect(simulation.applyInput('session-1', {
      sequence: 1, moveX: 1, moveY: 0, aimAngle: 0, fire: false, extract: false,
    })).toBe(true);
    expect(simulation.applyInput('session-1', {
      sequence: 1, moveX: -1, moveY: 0, aimAngle: 0, fire: false, extract: false,
    })).toBe(false);
    simulation.tick(100);
    expect(player.x).toBeGreaterThan(initialX);
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
      sequence: 1, moveX: 0, moveY: 0, aimAngle: 0, fire: false, extract: true,
    });
    simulation.tick(50);
    const extraction = simulation.drainEvents().find((event) => event.type === 'extraction');
    expect(extraction).toMatchObject({ type: 'extraction', cargo: { scrap: 15 } });
    expect(player.cargo.scrap).toBe(0);
    simulation.tick(50);
    expect(simulation.drainEvents().some((event) => event.type === 'extraction')).toBe(false);
  });
});
