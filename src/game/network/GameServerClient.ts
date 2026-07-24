import { Client, type Room } from '@colyseus/sdk';
import type {
  EnemyKind, GameInputMessage, GuestAuthResponse, PersonaChatResponse, PlayerProfile, ServerEventMessage,
} from '../../../packages/shared/src/protocol';
import { limitFunnelProperties, type FunnelEventName, type FunnelProperties } from '../../../packages/shared/src/analytics';
import type { CommercePlatform, StoreProduct, StoreProductId } from '../../../packages/shared/src/commerce';
import type { ReleaseChannel } from '../../../packages/shared/src/release';
import { CLIENT_RELEASE, clientPlatform } from '../../release';
import { gameEvents } from '../events';
import type { ClientErrorReport } from '../telemetry/ClientTelemetry';
import { isOperationId, type OperationId } from '../../../packages/shared/src/operations';
import type { GearId } from '../../../packages/shared/src/gear';
import type {
  ContractBoard, ContractId, ContractReward,
} from '../../../packages/shared/src/contracts';

export interface NetworkSnapshot {
  localSessionId: string;
  stormActive: boolean;
  operationId: OperationId;
  relaysDestroyed: number;
  bossDefeated: boolean;
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
  aiAvailable: boolean;
  aiDailyTurnLimit: number;
  serverTime: string;
}

export interface AlphaDiagnostics {
  appVersion: string;
  releaseChannel: ReleaseChannel;
  platform: 'android' | 'ios' | 'web';
  endpointConfigured: boolean;
  connected: boolean;
  recovering: boolean;
  reconnects: number;
  lastReconnectAt: string | null;
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
  private operationId: OperationId = 'operation-zero';
  private lifecycleEpoch = 0;
  private recoveryPromise?: Promise<void>;
  private reconnects = 0;
  private lastReconnectAt: string | null = null;
  connected = false;

  constructor(endpoint = import.meta.env.VITE_GAME_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:2567' : '')) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  setAnalyticsConsent(consented: boolean): void {
    this.analyticsConsent = consented;
    if (!consented) this.analyticsQueue.length = 0;
    else void this.flushAnalytics();
  }

  get accountAvailable(): boolean {
    return Boolean(this.endpoint && this.token);
  }

  async connect(operationId: OperationId = 'operation-zero'): Promise<void> {
    const epoch = ++this.lifecycleEpoch;
    this.operationId = operationId;
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
      await this.joinOperation(operationId, epoch);
      await this.flushAnalytics();
      void this.track('session_start', {
        mode: 'online', serverVersion: this.releaseInfo?.version ?? 'unknown',
      });
      void this.claimOffline();
    } catch {
      if (epoch !== this.lifecycleEpoch) return;
      this.connected = false;
      if (this.token) {
        gameEvents.emit('network-status', 'reconnecting', '작전 세션 복구 준비 중');
        void this.beginFreshRecovery(operationId, epoch);
      } else {
        gameEvents.emit('network-status', 'offline', '서버 없음 · 로컬 모드');
      }
    }
  }

  async switchOperation(operationId: OperationId): Promise<void> {
    if (!this.endpoint || !this.token) return;
    const epoch = ++this.lifecycleEpoch;
    this.operationId = operationId;
    const previousRoom = this.room;
    this.room = undefined;
    this.connected = false;
    await previousRoom?.leave().catch(() => undefined);
    gameEvents.emit('network-status', 'connecting', '다음 작전 연결 중');
    await this.joinOperation(operationId, epoch);
  }

  async resumeConnection(): Promise<void> {
    if (!this.endpoint || this.connected || this.recoveryPromise || this.room) return;
    if (!this.token) {
      await this.connect(this.operationId);
      return;
    }
    const epoch = ++this.lifecycleEpoch;
    this.room = undefined;
    gameEvents.emit('network-status', 'connecting', '네트워크 복귀 // 세션 확인 중');
    await this.beginFreshRecovery(this.operationId, epoch);
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

  async craftGear(gearId: GearId): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/economy/gear/craft', {
      method: 'POST', body: JSON.stringify({ gearId }),
    });
    gameEvents.emit('network-profile', response.profile);
    if (this.connected) this.room?.send('sync-loadout');
    return response.profile;
  }

  async setGearLoadout(equipped: GearId[]): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/profile/gear', {
      method: 'POST', body: JSON.stringify({ equipped }),
    });
    gameEvents.emit('network-profile', response.profile);
    if (this.connected) this.room?.send('sync-loadout');
    return response.profile;
  }

  async getContractBoard(): Promise<ContractBoard> {
    const response = await this.authorized<{ board: ContractBoard }>('/api/contracts', { method: 'GET' });
    return response.board;
  }

  async claimContract(contractId: ContractId): Promise<{
    profile: PlayerProfile;
    board: ContractBoard;
    reward: ContractReward;
    streakBonus: ContractReward | null;
  }> {
    const response = await this.authorized<{
      profile: PlayerProfile;
      board: ContractBoard;
      reward: ContractReward;
      streakBonus: ContractReward | null;
    }>(`/api/contracts/${encodeURIComponent(contractId)}/claim`, {
      method: 'POST', body: '{}',
    });
    gameEvents.emit('network-profile', response.profile);
    return response;
  }

  async setAiConsent(consent: boolean): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>('/api/profile/ai-consent', {
      method: 'PUT', body: JSON.stringify({ consent }),
    });
    gameEvents.emit('network-profile', response.profile);
    return response.profile;
  }

  async personaChat(
    operatorId: string,
    message: string,
    useExternalAi: boolean,
    requestId = crypto.randomUUID(),
  ): Promise<PersonaChatResponse> {
    const response = await this.authorized<PersonaChatResponse>('/api/persona/chat', {
      method: 'POST',
      headers: { 'idempotency-key': requestId },
      body: JSON.stringify({ operatorId, message, useExternalAi }),
    });
    gameEvents.emit('network-profile', response.profile);
    return response;
  }

  async clearPersonaMemories(operatorId: string): Promise<PlayerProfile> {
    const response = await this.authorized<{ profile: PlayerProfile }>(
      `/api/persona/${encodeURIComponent(operatorId)}/memories`,
      { method: 'DELETE' },
    );
    gameEvents.emit('network-profile', response.profile);
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
    ++this.lifecycleEpoch;
    const previousRoom = this.room;
    this.room = undefined;
    await previousRoom?.leave().catch(() => undefined);
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
      recovering: Boolean(this.recoveryPromise || this.room?.reconnection.isReconnecting),
      reconnects: this.reconnects,
      lastReconnectAt: this.lastReconnectAt,
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

  private async joinOperation(operationId: OperationId, epoch: number): Promise<void> {
    const client = new Client(this.endpoint);
    const room = await client.joinOrCreate('red_zone', { token: this.token, operationId });
    if (epoch !== this.lifecycleEpoch) {
      await room.leave().catch(() => undefined);
      throw new Error('STALE_CONNECTION');
    }
    room.reconnection.minUptime = 500;
    room.reconnection.delay = 200;
    room.reconnection.minDelay = 200;
    room.reconnection.maxDelay = 3_000;
    room.reconnection.maxRetries = 8;
    room.reconnection.maxEnqueuedMessages = 4;
    this.room = room;
    this.connected = true;
    gameEvents.emit('network-status', 'online', `ROOM ${room.roomId.slice(0, 6)} · ${operationId === 'operation-zero' ? 'OP-00' : 'OP-01'}`);
    room.onStateChange((state: unknown) => this.emitSnapshot(state));
    room.onMessage<ServerEventMessage>('server-event', (event) => {
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
    room.onDrop(() => {
      if (this.room !== room || epoch !== this.lifecycleEpoch) return;
      this.connected = false;
      gameEvents.emit('network-status', 'reconnecting', `ROOM ${room.roomId.slice(0, 6)} · 링크 복구 중`);
    });
    room.onReconnect(() => {
      if (this.room !== room || epoch !== this.lifecycleEpoch) return;
      this.connected = true;
      this.reconnects += 1;
      this.lastReconnectAt = new Date().toISOString();
      gameEvents.emit('network-status', 'online', `ROOM ${room.roomId.slice(0, 6)} · SESSION RESTORED`);
      gameEvents.emit('feed', '뉴럴 링크 복구 완료 // 현장 상태를 유지했습니다.');
      void this.refreshProfile();
    });
    room.onLeave(() => {
      if (this.room !== room || epoch !== this.lifecycleEpoch) return;
      this.connected = false;
      this.room = undefined;
      gameEvents.emit('network-status', 'reconnecting', '기존 링크 만료 · 새 세션 복구 중');
      void this.beginFreshRecovery(operationId, epoch);
    });
    room.onError((_code, message) => {
      if (!room.reconnection.isReconnecting) gameEvents.emit('feed', message ?? '게임룸 통신 오류', true);
    });
  }

  private beginFreshRecovery(operationId: OperationId, epoch: number): Promise<void> {
    if (this.recoveryPromise) return this.recoveryPromise;
    const recovery = this.recoverFreshSession(operationId, epoch).finally(() => {
      if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
    });
    this.recoveryPromise = recovery;
    return recovery;
  }

  private async recoverFreshSession(operationId: OperationId, epoch: number): Promise<void> {
    const delays = [500, 1_000, 2_000, 4_000, 8_000];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      await wait(delays[attempt]);
      if (epoch !== this.lifecycleEpoch || this.connected) return;
      try {
        await this.joinOperation(operationId, epoch);
        this.reconnects += 1;
        this.lastReconnectAt = new Date().toISOString();
        gameEvents.emit('feed', '새 작전 세션 연결 완료 // 서버 프로필을 다시 동기화합니다.');
        await this.refreshProfile();
        await this.flushAnalytics();
        return;
      } catch {
        if (epoch !== this.lifecycleEpoch) return;
        gameEvents.emit('network-status', 'reconnecting', `세션 복구 ${attempt + 1}/${delays.length}`);
      }
    }
    if (epoch !== this.lifecycleEpoch) return;
    this.connected = false;
    gameEvents.emit('network-status', 'offline', '복구 시간 초과 · 로컬 훈련 전환');
    gameEvents.emit('feed', '서버 연결을 복구하지 못해 현재 전장을 로컬 판정으로 전환합니다.', true);
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
      operationId: OperationId;
      relaysDestroyed: number;
      bossDefeated: boolean;
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
      operationId: isOperationId(state.operationId) ? state.operationId : 'operation-zero',
      relaysDestroyed: Number(state.relaysDestroyed ?? 0),
      bossDefeated: Boolean(state.bossDefeated),
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

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
