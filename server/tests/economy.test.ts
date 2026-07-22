import { beforeEach, describe, expect, it } from 'vitest';
import { EconomyService } from '../src/economy/EconomyService.js';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';

describe('server authoritative economy', () => {
  let repository: InMemoryPlayerRepository;

  beforeEach(async () => {
    repository = new InMemoryPlayerRepository();
    await repository.initialize();
  });

  it('deduplicates an upgrade with the same idempotency key', async () => {
    const profile = await repository.getOrCreateGuest('test:upgrade-device');
    const economy = new EconomyService(repository, () => 0.5);
    const first = await economy.upgradeShelter(profile.playerId, 'workshop', 'upgrade:test:0001');
    const replay = await economy.upgradeShelter(profile.playerId, 'workshop', 'upgrade:test:0001');
    expect(first.profile.shelter.workshop).toBe(2);
    expect(replay.profile.shelter.workshop).toBe(2);
    expect(replay.replayed).toBe(true);
  });

  it('executes recruitment and persists the server result', async () => {
    const profile = await repository.getOrCreateGuest('test:recruit-device');
    const rolls = [0.01, 0.9];
    const economy = new EconomyService(repository, () => rolls.shift() ?? 0.5);
    const result = await economy.recruit(profile.playerId, 'recruit:test:0001');
    expect(result.result?.rarity).toBe('SSR');
    expect(result.profile.resources.cores).toBe(5);
    expect(result.profile.pity).toBe(0);
  });

  it('commits extracted cargo only once per battle session key', async () => {
    const profile = await repository.getOrCreateGuest('test:extract-device');
    const economy = new EconomyService(repository);
    await economy.grantExtraction(profile.playerId, { scrap: 12, water: 3, data: 1, cores: 0 }, 'room:1');
    const replay = await economy.grantExtraction(profile.playerId, { scrap: 12, water: 3, data: 1, cores: 0 }, 'room:1');
    expect(replay.profile.resources.scrap).toBe(192);
    expect(replay.replayed).toBe(true);
  });

  it('unlocks campaign operations in order and grants each completion reward once', async () => {
    const profile = await repository.getOrCreateGuest('test:campaign-device');
    const economy = new EconomyService(repository);
    await expect(economy.completeOperation(profile.playerId, 'operation-ashfall', 'room:locked'))
      .rejects.toThrow('OPERATION_LOCKED');
    const zero = await economy.completeOperation(profile.playerId, 'operation-zero', 'room:zero');
    const zeroReplay = await economy.completeOperation(profile.playerId, 'operation-zero', 'room:zero-replay');
    const ashfall = await economy.completeOperation(profile.playerId, 'operation-ashfall', 'room:ashfall');
    expect(zero.profile.campaign.completedOperations).toEqual(['operation-zero']);
    expect(zeroReplay.profile.resources.cores).toBe(13);
    expect(ashfall.profile.campaign.completedOperations).toEqual(['operation-zero', 'operation-ashfall']);
    expect(ashfall.profile.resources.cores).toBe(18);
    expect(ashfall.profile.resources.data).toBe(81);
  });

  it('persists exactly three unique owned squad operators', async () => {
    const profile = await repository.getOrCreateGuest('test:squad-device');
    const economy = new EconomyService(repository);
    const result = await economy.setSquad(profile.playerId, ['lumen', 'aegis-07', 'ratchet'], 'squad:test:0001');
    expect(result.profile.squad).toEqual(['lumen', 'aegis-07', 'ratchet']);
  });

  it('rejects duplicate or unowned squad operators', async () => {
    const profile = await repository.getOrCreateGuest('test:invalid-squad-device');
    const economy = new EconomyService(repository);
    await expect(economy.setSquad(profile.playerId, ['lumen', 'lumen', 'ratchet'], 'squad:test:0002'))
      .rejects.toThrow('SQUAD_REQUIRES_THREE_UNIQUE_OPERATORS');
    await expect(economy.setSquad(profile.playerId, ['lumen', 'morrow', 'ratchet'], 'squad:test:0003'))
      .rejects.toThrow('OPERATOR_NOT_OWNED');
  });

  it('crafts gear idempotently, auto-equips it and validates loadouts', async () => {
    const profile = await repository.getOrCreateGuest('test:gear-device');
    const economy = new EconomyService(repository);
    const crafted = await economy.craftGear(profile.playerId, 'sealed-filter', 'gear:craft:0001');
    const replay = await economy.craftGear(profile.playerId, 'sealed-filter', 'gear:craft:0001');
    expect(crafted.profile.resources).toMatchObject({ scrap: 110, water: 95, data: 33 });
    expect(crafted.profile.gear).toEqual({ owned: ['sealed-filter'], equipped: ['sealed-filter'] });
    expect(replay.replayed).toBe(true);
    await expect(economy.setGearLoadout(profile.playerId, ['coil-governor'], 'gear:equip:0001'))
      .rejects.toThrow('GEAR_NOT_OWNED');
    await expect(economy.craftGear(profile.playerId, 'coil-governor', 'gear:craft:locked'))
      .rejects.toThrow('WORKSHOP_LEVEL_REQUIRED');
  });
});
