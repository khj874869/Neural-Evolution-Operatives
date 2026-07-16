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
});
