import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import type { PlayerRepository, ProfileMutation } from './PlayerRepository.js';
import { createPlayerProfile } from './profileFactory.js';

export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly profiles = new Map<string, PlayerProfile>();
  private readonly deviceIndex = new Map<string, string>();
  private readonly events = new Map<string, PlayerProfile>();
  private readonly queues = new Map<string, Promise<void>>();

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async getOrCreateGuest(deviceId: string): Promise<PlayerProfile> {
    const existingId = this.deviceIndex.get(deviceId);
    if (existingId) return structuredClone(this.profiles.get(existingId)!);
    const profile = createPlayerProfile(deviceId);
    this.profiles.set(profile.playerId, structuredClone(profile));
    this.deviceIndex.set(deviceId, profile.playerId);
    return structuredClone(profile);
  }

  async getById(playerId: string): Promise<PlayerProfile | null> {
    const profile = this.profiles.get(playerId);
    return profile ? structuredClone(profile) : null;
  }

  async mutate(playerId: string, idempotencyKey: string, eventType: string, mutation: ProfileMutation) {
    const eventKey = `${playerId}:${idempotencyKey}`;
    const replay = this.events.get(eventKey);
    if (replay) return { profile: structuredClone(replay), replayed: true };

    let release: () => void = () => undefined;
    const previous = this.queues.get(playerId) ?? Promise.resolve();
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.queues.set(playerId, queued);
    await previous;
    try {
      const profile = this.profiles.get(playerId);
      if (!profile) throw new Error('PLAYER_NOT_FOUND');
      const next = structuredClone(profile);
      await mutation(next);
      next.lastSeenAt = new Date().toISOString();
      this.profiles.set(playerId, structuredClone(next));
      this.events.set(eventKey, structuredClone(next));
      void eventType;
      return { profile: structuredClone(next), replayed: false };
    } finally {
      release();
      if (this.queues.get(playerId) === queued) this.queues.delete(playerId);
    }
  }
}
