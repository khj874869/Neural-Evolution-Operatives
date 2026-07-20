export type ResourceKind = 'scrap' | 'water' | 'data' | 'cores';
import type { WeaponId } from './combat.js';
import type { CommercePlatform, StoreProductId } from './commerce.js';

export type EnemyKind = 'drone' | 'raider' | 'stalker' | 'breaker' | 'jammer' | 'warden';

export interface ResourceWallet {
  scrap: number;
  water: number;
  data: number;
  cores: number;
}

export interface GameInputMessage {
  sequence: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  fire: boolean;
  extract: boolean;
  weapon: WeaponId;
  activateLink?: boolean;
  dash?: boolean;
}

export interface TacticalMessage {
  text: string;
}

export interface ServerEventMessage {
  type: 'feed' | 'extraction' | 'mission' | 'neural-link' | 'error';
  message: string;
  payload?: Record<string, unknown>;
}

export interface GuestAuthResponse {
  token: string;
  profile: PlayerProfile;
}

export interface PlayerProfile {
  version: 1;
  playerId: string;
  deviceId: string;
  displayName: string;
  resources: ResourceWallet;
  shelter: {
    command: number;
    purifier: number;
    workshop: number;
    greenhouse: number;
  };
  operators: Array<{
    id: string;
    level: number;
    bond: number;
    memories: string[];
  }>;
  squad: string[];
  pity: number;
  accountLevel: number;
  xp: number;
  commerce: {
    entitlements: string[];
    subscriptionUntil: string | null;
    purchases: Array<{
      transactionId: string;
      productId: StoreProductId;
      platform: CommercePlatform;
      purchasedAt: string;
      amountMinor: number;
      currency: string;
    }>;
  };
  lastSeenAt: string;
  createdAt: string;
}
