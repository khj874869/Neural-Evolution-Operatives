import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import type { FunnelEventName, FunnelProperties } from '../../../packages/shared/src/analytics.js';
import type { CommercePlatform, StoreProductId } from '../../../packages/shared/src/commerce.js';
import { PurchaseReceiptConflictError, type PlayerRepository, type ProfileMutation } from './PlayerRepository.js';
import { createPlayerProfile } from './profileFactory.js';

export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly profiles = new Map<string, PlayerProfile>();
  private readonly deviceIndex = new Map<string, string>();
  private readonly events = new Map<string, PlayerProfile>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly purchaseReceipts = new Map<string, { playerId: string; productId: StoreProductId; profile: PlayerProfile | null }>();
  private purchaseQueue = Promise.resolve();
  readonly analytics: Array<{ playerId: string; event: FunnelEventName; properties: FunnelProperties }> = [];

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

  async deletePlayer(playerId: string): Promise<boolean> {
    const profile = this.profiles.get(playerId);
    if (!profile) return false;
    this.profiles.delete(playerId);
    this.deviceIndex.delete(profile.deviceId);
    for (const key of [...this.events.keys()]) {
      if (key.startsWith(`${playerId}:`)) this.events.delete(key);
    }
    for (let index = this.analytics.length - 1; index >= 0; index -= 1) {
      if (this.analytics[index].playerId === playerId) this.analytics.splice(index, 1);
    }
    for (const [key, receipt] of this.purchaseReceipts) {
      if (receipt.playerId === playerId) this.purchaseReceipts.set(key, { ...receipt, playerId: '', profile: null });
    }
    return true;
  }

  async recordAnalytics(playerId: string, event: FunnelEventName, properties: FunnelProperties): Promise<void> {
    if (!this.profiles.has(playerId)) throw new Error('PLAYER_NOT_FOUND');
    this.analytics.push({ playerId, event, properties: structuredClone(properties) });
  }

  async mutatePurchase(
    playerId: string,
    platform: CommercePlatform,
    transactionId: string,
    productId: StoreProductId,
    mutation: ProfileMutation,
  ) {
    let release: () => void = () => undefined;
    const previous = this.purchaseQueue;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.purchaseQueue = previous.then(() => current);
    await previous;
    try {
      const receiptKey = `${platform}:${transactionId}`;
      const receipt = this.purchaseReceipts.get(receiptKey);
      if (receipt) {
        if (receipt.playerId !== playerId || receipt.productId !== productId || !receipt.profile) throw new PurchaseReceiptConflictError();
        return { profile: structuredClone(receipt.profile), replayed: true };
      }
      const profile = this.profiles.get(playerId);
      if (!profile) throw new Error('PLAYER_NOT_FOUND');
      const next = structuredClone(profile);
      await mutation(next);
      next.lastSeenAt = new Date().toISOString();
      this.profiles.set(playerId, structuredClone(next));
      this.purchaseReceipts.set(receiptKey, { playerId, productId, profile: structuredClone(next) });
      return { profile: structuredClone(next), replayed: false };
    } finally {
      release();
    }
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
