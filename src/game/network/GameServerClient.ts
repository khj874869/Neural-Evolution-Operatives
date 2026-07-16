import { Client, type Room } from '@colyseus/sdk';
import type { GameInputMessage, GuestAuthResponse, PlayerProfile, ServerEventMessage } from '../../../packages/shared/src/protocol';
import { gameEvents } from '../events';

export interface NetworkSnapshot {
  localSessionId: string;
  stormActive: boolean;
  players: Array<{
    id: string; playerId: string; displayName: string; x: number; y: number; aimAngle: number;
    hp: number; radiation: number; cargoScrap: number; cargoWater: number; cargoData: number;
    cargoCores: number; kills: number; lastSequence: number;
  }>;
  enemies: Array<{ id: string; kind: 'drone' | 'raider' | 'stalker' | 'breaker'; x: number; y: number; hp: number }>;
  resources: Array<{ id: string; kind: 'scrap' | 'water' | 'data' | 'cores'; x: number; y: number; value: number }>;
}

export class GameServerClient {
  private room?: Room;
  private token?: string;
  private readonly endpoint: string;
  connected = false;

  constructor(endpoint = import.meta.env.VITE_GAME_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:2567' : '')) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  async connect(): Promise<void> {
    if (!this.endpoint) {
      gameEvents.emit('network-status', 'offline', '로컬 훈련 모드');
      return;
    }
    gameEvents.emit('network-status', 'connecting', '서버 연결 중');
    try {
      const auth = await this.request<GuestAuthResponse>('/api/auth/guest', {
        method: 'POST', body: JSON.stringify({ deviceId: deviceId() }),
      });
      this.token = auth.token;
      gameEvents.emit('network-profile', auth.profile);
      const client = new Client(this.endpoint);
      this.room = await client.joinOrCreate('red_zone', { token: this.token });
      this.connected = true;
      gameEvents.emit('network-status', 'online', `ROOM ${this.room.roomId.slice(0, 6)}`);
      this.room.onStateChange((state: unknown) => this.emitSnapshot(state));
      this.room.onMessage<ServerEventMessage>('server-event', (event) => {
        gameEvents.emit('feed', event.message, event.type === 'error');
        if (event.type === 'extraction') {
          gameEvents.emit('sfx', 'extract');
          gameEvents.emit('haptic', 'success');
          void this.refreshProfile();
        }
      });
      this.room.onLeave(() => {
        this.connected = false;
        gameEvents.emit('network-status', 'offline', '연결 종료 · 로컬 모드');
      });
      this.room.onError((_code, message) => gameEvents.emit('feed', message ?? '게임룸 통신 오류', true));
      void this.claimOffline();
    } catch {
      this.connected = false;
      gameEvents.emit('network-status', 'offline', '서버 없음 · 로컬 모드');
    }
  }

  sendInput(input: GameInputMessage): void {
    if (this.connected) this.room?.sendUnreliable('input', input);
  }

  sendTactical(text: string): void {
    if (this.connected) this.room?.send('tactical', { text });
  }

  async upgradeShelter(module: keyof PlayerProfile['shelter']): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/economy/shelter/upgrade', {
      method: 'POST', body: JSON.stringify({ module }),
    });
    gameEvents.emit('network-profile', response.profile);
    return response.profile;
  }

  async recruit(): Promise<{ profile: PlayerProfile; result?: { operatorId: string; rarity: 'R' | 'SR' | 'SSR'; duplicate: boolean } }> {
    const response = await this.authorized<{ profile: PlayerProfile; result?: { operatorId: string; rarity: 'R' | 'SR' | 'SSR'; duplicate: boolean } }>('/api/economy/recruit', {
      method: 'POST', body: '{}',
    });
    gameEvents.emit('network-profile', response.profile);
    return response;
  }

  async setSquad(squad: string[]): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/profile/squad', {
      method: 'POST', body: JSON.stringify({ squad }),
    });
    gameEvents.emit('network-profile', response.profile);
    if (this.connected) this.room?.send('sync-squad');
    return response.profile;
  }

  private async claimOffline(): Promise<void> {
    const response = await this.authorized<{ profile: PlayerProfile; reward?: { elapsedMinutes: number; scrap: number; water: number } }>('/api/economy/offline/claim', {
      method: 'POST', body: '{}',
    });
    gameEvents.emit('network-profile', response.profile);
    if (response.reward && response.reward.elapsedMinutes >= 2) {
      gameEvents.emit('feed', `서버 방치 보상: 고철 ${response.reward.scrap} · 식수 ${response.reward.water}`);
    }
  }

  private async refreshProfile(): Promise<void> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/profile');
    gameEvents.emit('network-profile', response.profile);
  }

  private async authorized<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
        'idempotency-key': crypto.randomUUID(),
        ...init.headers,
      },
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
    if (!response.ok) throw new Error(`SERVER_${response.status}`);
    return response.json() as Promise<T>;
  }

  private emitSnapshot(rawState: unknown): void {
    const state = rawState as {
      stormActive: boolean;
      players: Map<string, NetworkSnapshot['players'][number]>;
      enemies: Map<string, NetworkSnapshot['enemies'][number]>;
      resources: Map<string, NetworkSnapshot['resources'][number]>;
    };
    const mapValues = <T extends object>(map: Map<string, T>): Array<T & { id: string }> => {
      const values: Array<T & { id: string }> = [];
      map?.forEach((value, id) => values.push({ ...plain(value), id } as T & { id: string }));
      return values;
    };
    gameEvents.emit('network-snapshot', {
      localSessionId: this.room?.sessionId ?? '',
      stormActive: Boolean(state.stormActive),
      players: mapValues(state.players),
      enemies: mapValues(state.enemies),
      resources: mapValues(state.resources),
    } satisfies NetworkSnapshot);
  }
}

function deviceId(): string {
  const key = 'neo-device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `web:${crypto.randomUUID()}`;
  localStorage.setItem(key, created);
  return created;
}

function plain<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) result[key] = (value as Record<string, unknown>)[key];
  return result as T;
}
