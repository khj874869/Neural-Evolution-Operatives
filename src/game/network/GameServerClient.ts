import { Client, type Room } from '@colyseus/sdk';
import type { EnemyKind, GameInputMessage, GuestAuthResponse, PlayerProfile, ServerEventMessage } from '../../../packages/shared/src/protocol';
import { limitFunnelProperties, type FunnelEventName, type FunnelProperties } from '../../../packages/shared/src/analytics';
import type { CommercePlatform, StoreProduct, StoreProductId } from '../../../packages/shared/src/commerce';
import type { ReleaseChannel } from '../../../packages/shared/src/release';
import { CLIENT_RELEASE, clientPlatform } from '../../release';
import { gameEvents } from '../events';
import type { ClientErrorReport } from '../telemetry/ClientTelemetry';

export interface NetworkSnapshot {
  localSessionId: string;
  stormActive: boolean;
  players: Array<{
    id: string; playerId: string; displayName: string; x: number; y: number; aimAngle: number;
    hp: number; radiation: number; cargoScrap: number; cargoWater: number; cargoData: number;
    cargoCores: number; kills: number; lastSequence: number; linkCharge: number; dashCooldownMs: number;
  }>;
  enemies: Array<{ id: string; kind: EnemyKind; x: number; y: number; hp: number }>;
  resources: Array<{ id: string; kind: 'scrap' | 'water' | 'data' | 'cores'; x: number; y: number; value: number }>;
}

export interface StoreCatalogResponse {
  products: StoreProduct[];
  recruitOdds: { SSR: number; SR: number; R: number; pityAt: number };
  checkoutAvailable: boolean;
  priceNotice: string;
}

export interface ServerReleaseInfo {
  version: string;
  channel: ReleaseChannel;
  commit: string;
  commerceAvailable: boolean;
  serverTime: string;
}

export interface AlphaDiagnostics {
  appVersion: string;
  releaseChannel: ReleaseChannel;
  platform: 'android' | 'ios' | 'web';
  endpointConfigured: boolean;
  connected: boolean;
  server: ServerReleaseInfo | null;
}

export class GameServerClient {
  private room?: Room;
  private token?: string;
  private readonly endpoint: string;
  private analyticsConsent = false;
  private readonly analyticsQueue: Array<{ event: FunnelEventName; properties: FunnelProperties }> = [];
  private readonly recentErrorFingerprints = new Map<string, number>();
  private releaseInfo: ServerReleaseInfo | null = null;
  connected = false;

  constructor(endpoint = import.meta.env.VITE_GAME_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:2567' : '')) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  setAnalyticsConsent(consented: boolean): void {
    this.analyticsConsent = consented;
    if (!consented) this.analyticsQueue.length = 0;
    else void this.flushAnalytics();
  }

  async connect(): Promise<void> {
    if (!this.endpoint) {
      gameEvents.emit('network-status', 'offline', '로컬 훈련 모드');
      return;
    }
    gameEvents.emit('network-status', 'connecting', '서버 연결 중');
    try {
      this.releaseInfo = await this.request<ServerReleaseInfo>('/api/release', { method: 'GET' }).catch(() => null);
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
          gameEvents.emit('server-extraction', event.payload ?? {});
          void this.refreshProfile();
        }
        if (event.type === 'mission' && event.payload?.bossDefeated) gameEvents.emit('boss-defeated');
        if (event.type === 'neural-link' && typeof event.payload?.operatorId === 'string' && typeof event.payload?.skillName === 'string') {
          gameEvents.emit('neural-link-activated', event.payload.operatorId, event.payload.skillName);
          gameEvents.emit('sfx', 'neural-link');
          gameEvents.emit('haptic', 'success');
        }
      });
      this.room.onLeave(() => {
        this.connected = false;
        gameEvents.emit('network-status', 'offline', '연결 종료 · 로컬 모드');
      });
      this.room.onError((_code, message) => gameEvents.emit('feed', message ?? '게임룸 통신 오류', true));
      await this.flushAnalytics();
      void this.track('session_start', {
        mode: 'online', serverVersion: this.releaseInfo?.version ?? 'unknown',
      });
      void this.claimOffline();
    } catch {
      this.connected = false;
      gameEvents.emit('network-status', 'offline', '서버 없음 · 로컬 모드');
    }
  }

  sendInput(input: GameInputMessage): void {
    if (this.connected) this.room?.send('input', input);
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

  async getStoreCatalog(): Promise<StoreCatalogResponse | null> {
    if (!this.endpoint) return null;
    try {
      return await this.request<StoreCatalogResponse>('/api/store/catalog', { method: 'GET' });
    } catch {
      return null;
    }
  }

  async verifyPurchase(platform: CommercePlatform, productId: StoreProductId, receipt: string): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/store/verify', {
      method: 'POST', body: JSON.stringify({ platform, productId, receipt }),
    });
    gameEvents.emit('network-profile', response.profile);
    return response.profile;
  }

  async exportAccount(): Promise<unknown> {
    return this.authorized('/api/account/export', { method: 'GET' });
  }

  async deleteAccount(): Promise<void> {
    await this.authorized('/api/account', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }),
    });
    await this.room?.leave().catch(() => undefined);
    this.connected = false;
    this.token = undefined;
  }

  async track(event: FunnelEventName, properties: FunnelProperties = {}): Promise<void> {
    if (!this.analyticsConsent || !this.endpoint) return;
    const payload = { event, properties: this.enrichAnalytics(properties) };
    if (!this.token) {
      this.enqueueAnalytics(payload);
      return;
    }
    try {
      await this.authorized('/api/analytics/events', {
        method: 'POST', body: JSON.stringify(payload),
      });
    } catch {
      // Funnel tracking must never interrupt play.
    }
  }

  reportClientError(error: ClientErrorReport): void {
    const now = Date.now();
    const previous = this.recentErrorFingerprints.get(error.fingerprint) ?? 0;
    if (now - previous < 30_000) return;
    this.recentErrorFingerprints.set(error.fingerprint, now);
    if (this.recentErrorFingerprints.size > 24) {
      const oldest = this.recentErrorFingerprints.keys().next().value as string | undefined;
      if (oldest) this.recentErrorFingerprints.delete(oldest);
    }
    void this.track('client_error', { ...error });
  }

  getDiagnostics(): AlphaDiagnostics {
    return {
      appVersion: CLIENT_RELEASE.version,
      releaseChannel: CLIENT_RELEASE.channel,
      platform: clientPlatform(),
      endpointConfigured: Boolean(this.endpoint),
      connected: this.connected,
      server: this.releaseInfo ? { ...this.releaseInfo } : null,
    };
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

  private enrichAnalytics(properties: FunnelProperties): FunnelProperties {
    const custom = Object.fromEntries(
      Object.entries(properties).filter(([key]) => !['version', 'channel', 'platform'].includes(key)),
    );
    return limitFunnelProperties({
      version: CLIENT_RELEASE.version,
      channel: CLIENT_RELEASE.channel,
      platform: clientPlatform(),
      ...custom,
    });
  }

  private enqueueAnalytics(payload: { event: FunnelEventName; properties: FunnelProperties }): void {
    this.analyticsQueue.push(payload);
    if (this.analyticsQueue.length > 20) this.analyticsQueue.shift();
  }

  private async flushAnalytics(): Promise<void> {
    if (!this.analyticsConsent || !this.endpoint || !this.token || !this.analyticsQueue.length) return;
    const pending = this.analyticsQueue.splice(0);
    for (const payload of pending) {
      try {
        await this.authorized('/api/analytics/events', {
          method: 'POST', body: JSON.stringify(payload),
        });
      } catch {
        // Best-effort alpha telemetry must never block startup.
      }
    }
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
