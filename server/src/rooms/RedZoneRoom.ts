import { Room, type Client } from '@colyseus/core';
import { z } from 'zod';
import type { GameInputMessage, ServerEventMessage, TacticalMessage } from '../../../packages/shared/src/protocol.js';
import { RedZoneSimulation } from '../simulation/RedZoneSimulation.js';
import { EnemyState, PlayerState, RedZoneState, ResourceState } from '../state/RedZoneState.js';
import { roomDependencies } from './dependencies.js';
import {
  isOperationId, isOperationUnlocked, type OperationId,
} from '../../../packages/shared/src/operations.js';

const inputSchema = z.object({
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  moveX: z.number().finite().min(-1.2).max(1.2),
  moveY: z.number().finite().min(-1.2).max(1.2),
  aimAngle: z.number().finite().min(-Math.PI * 4).max(Math.PI * 4),
  fire: z.boolean(),
  extract: z.boolean(),
  weapon: z.enum(['carbine', 'scatter', 'rail']),
  activateLink: z.boolean().optional().default(false),
  dash: z.boolean().optional().default(false),
});
const tacticalSchema = z.object({ text: z.string().trim().min(1).max(100) });

interface PlayerAuth {
  playerId: string;
  deviceId: string;
  operationId: OperationId;
}

export class RedZoneRoom extends Room<{ state: RedZoneState }> {
  state = new RedZoneState();
  maxClients = 4;
  private simulation!: RedZoneSimulation;
  private operationId: OperationId = 'operation-zero';

  onCreate(options: { operationId?: unknown } = {}): void {
    this.operationId = isOperationId(options.operationId) ? options.operationId : 'operation-zero';
    this.simulation = new RedZoneSimulation(Math.random, this.operationId);
    this.state.operationId = this.operationId;
    this.setSimulationInterval((deltaMs) => this.updateSimulation(deltaMs), 50);
    this.onMessage('input', (client, message: GameInputMessage) => {
      const parsed = inputSchema.safeParse(message);
      if (parsed.success) this.simulation.applyInput(client.sessionId, parsed.data);
    });
    this.onMessage('tactical', (client, message: TacticalMessage) => {
      const parsed = tacticalSchema.safeParse(message);
      if (!parsed.success) return;
      client.send('server-event', {
        type: 'feed',
        message: `전술 링크 수신: ${parsed.data.text}`,
      } satisfies ServerEventMessage);
    });
    this.onMessage('sync-squad', async (client) => {
      try {
        const playerId = this.simulation.getPlayerId(client.sessionId);
        if (!playerId) return;
        const profile = await roomDependencies().repository.getById(playerId);
        if (!profile || !this.simulation.updateSquad(client.sessionId, profile.squad)) return;
        client.send('server-event', {
          type: 'feed', message: '분대 링크 재동기화 // 전투 보너스 적용 완료',
        } satisfies ServerEventMessage);
      } catch {
        client.send('server-event', {
          type: 'error', message: '분대 링크 재동기화에 실패했습니다.',
        } satisfies ServerEventMessage);
      }
    });
    this.onMessage('sync-loadout', async (client) => {
      try {
        const playerId = this.simulation.getPlayerId(client.sessionId);
        if (!playerId) return;
        const profile = await roomDependencies().repository.getById(playerId);
        if (!profile || !this.simulation.updateGear(client.sessionId, profile.gear.equipped)) return;
        client.send('server-event', {
          type: 'feed', message: '전술 장비 재동기화 // 서버 전투 보너스 적용 완료',
        } satisfies ServerEventMessage);
      } catch {
        client.send('server-event', {
          type: 'error', message: '전술 장비 재동기화에 실패했습니다.',
        } satisfies ServerEventMessage);
      }
    });
  }

  async onAuth(_client: Client, options: { token?: string; operationId?: unknown }): Promise<PlayerAuth> {
    if (!options.token) throw new Error('AUTH_REQUIRED');
    const claims = roomDependencies().tokens.verify(options.token);
    const profile = await roomDependencies().repository.getById(claims.sub);
    if (!profile) throw new Error('PLAYER_NOT_FOUND');
    const requestedOperation = isOperationId(options.operationId) ? options.operationId : 'operation-zero';
    if (requestedOperation !== this.operationId || !isOperationUnlocked(requestedOperation, profile.campaign.completedOperations)) {
      throw new Error('OPERATION_LOCKED');
    }
    return { playerId: claims.sub, deviceId: claims.deviceId, operationId: requestedOperation };
  }

  async onJoin(client: Client, _options: unknown, auth: PlayerAuth): Promise<void> {
    const profile = await roomDependencies().repository.getById(auth.playerId);
    if (!profile) throw new Error('PLAYER_NOT_FOUND');
    this.simulation.addPlayer(
      client.sessionId, profile.playerId, profile.displayName, profile.squad, profile.gear.equipped,
    );
  }

  onLeave(client: Client): void {
    this.simulation.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private updateSimulation(deltaMs: number): void {
    this.simulation.tick(deltaMs);
    this.syncState();
    for (const event of this.simulation.drainEvents()) {
      if (event.type === 'extraction') {
        const idempotencyId = `${this.roomId}:${event.playerId}:${event.extractionNumber}`;
        void roomDependencies().economy.grantExtraction(event.playerId, event.cargo, idempotencyId)
          .then(async () => {
            if (event.operationComplete) {
              await roomDependencies().economy.completeOperation(event.playerId, event.operationId, idempotencyId);
            }
            this.clients.find((client) => client.sessionId === event.playerSessionId)?.send('server-event', {
              type: 'extraction', message: '화물 추출이 서버에 확정되었습니다.',
              payload: { ...event.cargo, operationId: event.operationId, operationComplete: event.operationComplete },
            } satisfies ServerEventMessage);
          })
          .catch(() => this.clients.find((client) => client.sessionId === event.playerSessionId)?.send('server-event', {
            type: 'error', message: '추출 저장에 실패했습니다. 동일 세션 키로 재처리할 수 있습니다.',
          } satisfies ServerEventMessage));
      } else if (event.type === 'death') {
        this.clients.find((client) => client.sessionId === event.playerSessionId)?.send('server-event', {
          type: 'feed', message: event.message,
        } satisfies ServerEventMessage);
      } else if (event.type === 'boss-defeated') {
        this.broadcast('server-event', {
          type: 'mission', message: event.message,
          payload: { bossDefeated: true, operationId: event.operationId },
        } satisfies ServerEventMessage);
      } else if (event.type === 'neural-link') {
        this.clients.find((client) => client.sessionId === event.playerSessionId)?.send('server-event', {
          type: 'neural-link', message: event.message,
          payload: { operatorId: event.operatorId, skillName: event.skillName },
        } satisfies ServerEventMessage);
      } else {
        this.broadcast('server-event', { type: 'feed', message: event.message } satisfies ServerEventMessage);
      }
    }
  }

  private syncState(): void {
    this.state.serverTime = Date.now();
    this.state.stormActive = this.simulation.stormActive;
    this.state.operationId = this.simulation.operationId;
    this.state.relaysDestroyed = this.simulation.relaysDestroyed;
    this.state.bossDefeated = this.simulation.bossWasDefeated;
    syncMap(this.state.players, this.simulation.players, () => new PlayerState(), (target, source) => {
      target.playerId = source.playerId;
      target.displayName = source.displayName;
      target.x = source.x;
      target.y = source.y;
      target.aimAngle = source.aimAngle;
      target.hp = source.hp;
      target.radiation = source.radiation;
      target.cargoScrap = source.cargo.scrap;
      target.cargoWater = source.cargo.water;
      target.cargoData = source.cargo.data;
      target.cargoCores = source.cargo.cores;
      target.kills = source.kills;
      target.lastSequence = source.lastSequence;
      target.linkCharge = source.linkCharge;
      target.dashCooldownMs = source.dashCooldownMs;
    });
    syncMap(this.state.enemies, this.simulation.enemies, () => new EnemyState(), (target, source) => {
      target.kind = source.kind;
      target.x = source.x;
      target.y = source.y;
      target.hp = source.hp;
    });
    syncMap(this.state.resources, this.simulation.resources, () => new ResourceState(), (target, source) => {
      target.kind = source.kind;
      target.x = source.x;
      target.y = source.y;
      target.value = source.value;
    });
  }
}

function syncMap<TState extends object, TSource>(
  target: {
    forEach(callback: (value: TState, key: string) => void): void;
    has(key: string): boolean;
    get(key: string): TState | undefined;
    set(key: string, value: TState): unknown;
    delete(key: string): boolean;
  },
  source: Map<string, TSource>,
  create: () => TState,
  assign: (targetValue: TState, sourceValue: TSource) => void,
): void {
  const removed: string[] = [];
  target.forEach((_value, key) => { if (!source.has(key)) removed.push(key); });
  for (const key of removed) target.delete(key);
  for (const [key, sourceValue] of source) {
    const targetValue = target.get(key) ?? create();
    assign(targetValue, sourceValue);
    if (!target.has(key)) target.set(key, targetValue);
  }
}
