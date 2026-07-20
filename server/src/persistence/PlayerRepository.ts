import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import type { FunnelEventName, FunnelProperties } from '../../../packages/shared/src/analytics.js';
import type { CommercePlatform, StoreProductId } from '../../../packages/shared/src/commerce.js';

export type ProfileMutation = (profile: PlayerProfile) => void | Promise<void>;

export interface PlayerRepository {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getOrCreateGuest(deviceId: string): Promise<PlayerProfile>;
  getById(playerId: string): Promise<PlayerProfile | null>;
  deletePlayer(playerId: string): Promise<boolean>;
  recordAnalytics(playerId: string, event: FunnelEventName, properties: FunnelProperties): Promise<void>;
  mutate(
    playerId: string,
    idempotencyKey: string,
    eventType: string,
    mutation: ProfileMutation,
  ): Promise<{ profile: PlayerProfile; replayed: boolean }>;
  mutatePurchase(
    playerId: string,
    platform: CommercePlatform,
    transactionId: string,
    productId: StoreProductId,
    mutation: ProfileMutation,
  ): Promise<{ profile: PlayerProfile; replayed: boolean }>;
}

export class PurchaseReceiptConflictError extends Error {
  constructor() {
    super('PURCHASE_RECEIPT_ALREADY_CLAIMED');
  }
}
