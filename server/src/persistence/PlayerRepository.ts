import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';

export type ProfileMutation = (profile: PlayerProfile) => void | Promise<void>;

export interface PlayerRepository {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getOrCreateGuest(deviceId: string): Promise<PlayerProfile>;
  getById(playerId: string): Promise<PlayerProfile | null>;
  mutate(
    playerId: string,
    idempotencyKey: string,
    eventType: string,
    mutation: ProfileMutation,
  ): Promise<{ profile: PlayerProfile; replayed: boolean }>;
}
