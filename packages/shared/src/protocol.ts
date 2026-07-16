export type ResourceKind = 'scrap' | 'water' | 'data' | 'cores';
import type { WeaponId } from './combat.js';

export type EnemyKind = 'drone' | 'raider' | 'stalker' | 'breaker' | 'warden';

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
}

export interface TacticalMessage {
  text: string;
}

export interface ServerEventMessage {
  type: 'feed' | 'extraction' | 'mission' | 'error';
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
  lastSeenAt: string;
  createdAt: string;
}
