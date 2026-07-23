import type {
  PersonaChatResponse, PersonaExchange, PlayerProfile,
} from '../../../packages/shared/src/protocol.js';
import {
  createDeepTalkFallback, getOperatorPersona, operatorMemoryLimit,
} from '../../../packages/shared/src/persona.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';
import {
  DisabledPersonaProvider, PersonaSafetyError, type PersonaProvider,
} from './OpenAIResponsesPersonaProvider.js';

export class PersonaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class PersonaService {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly rateWindows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly repository: PlayerRepository,
    private readonly provider: PersonaProvider = new DisabledPersonaProvider(),
    readonly dailyTurnLimit = 12,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get externalAiAvailable(): boolean {
    return this.provider.available;
  }

  async setConsent(playerId: string, consent: boolean, idempotencyKey: string): Promise<PlayerProfile> {
    const result = await this.repository.mutate(playerId, idempotencyKey, 'ai_consent', (profile) => {
      profile.ai.consentedAt = consent ? profile.ai.consentedAt ?? this.now().toISOString() : null;
      if (!consent && profile.ai.lastExchange?.source === 'ai') profile.ai.lastExchange = null;
    });
    return result.profile;
  }

  async clearMemories(playerId: string, operatorId: string, idempotencyKey: string): Promise<PlayerProfile> {
    const result = await this.repository.mutate(playerId, idempotencyKey, 'persona_memory_clear', (profile) => {
      const owned = profile.operators.find((operator) => operator.id === operatorId);
      if (!owned) throw new PersonaError('OPERATOR_NOT_OWNED', 409);
      owned.memories = [];
      if (profile.ai.lastExchange?.operatorId === operatorId) profile.ai.lastExchange = null;
    });
    return result.profile;
  }

  async chat(
    playerId: string,
    operatorId: string,
    message: string,
    allowExternalAi: boolean,
    idempotencyKey: string,
  ): Promise<PersonaChatResponse> {
    return this.withPlayerLock(playerId, async () => {
      const current = await this.repository.getById(playerId);
      if (!current) throw new PersonaError('PLAYER_NOT_FOUND', 404);
      const replay = current.ai.lastExchange;
      if (replay?.requestId === idempotencyKey) return this.response(current, replay);
      this.consumeRateLimit(playerId);

      const owned = current.operators.find((operator) => operator.id === operatorId);
      if (!owned) throw new PersonaError('OPERATOR_NOT_OWNED', 409);
      const persona = getOperatorPersona(operatorId);
      const today = this.now().toISOString().slice(0, 10);
      const used = current.ai.dailyUsageDate === today ? current.ai.dailyTurnsUsed : 0;
      let source: PersonaExchange['source'] = 'rules';
      let reply = createDeepTalkFallback(persona, message, used + owned.bond);

      if (allowExternalAi && current.ai.consentedAt && this.provider.available && used < this.dailyTurnLimit) {
        try {
          reply = await this.provider.generate({
            playerId,
            persona,
            message,
            bond: owned.bond,
            memories: owned.memories,
          });
          source = 'ai';
        } catch (error) {
          if (error instanceof PersonaSafetyError) throw new PersonaError(error.code, 422);
          source = 'rules';
        }
      }

      const memory = buildMemory(persona.name, message);
      const exchange: PersonaExchange = {
        requestId: idempotencyKey,
        operatorId,
        reply,
        memory,
        source,
        createdAt: this.now().toISOString(),
      };
      const result = await this.repository.mutate(playerId, idempotencyKey, 'persona_chat', (profile) => {
        const target = profile.operators.find((operator) => operator.id === operatorId);
        if (!target) throw new PersonaError('OPERATOR_NOT_OWNED', 409);
        const profileToday = this.now().toISOString().slice(0, 10);
        if (profile.ai.dailyUsageDate !== profileToday) {
          profile.ai.dailyUsageDate = profileToday;
          profile.ai.dailyTurnsUsed = 0;
        }
        if (source === 'ai') profile.ai.dailyTurnsUsed += 1;
        target.memories = [
          memory,
          ...target.memories.filter((item) => item !== memory),
        ].slice(0, operatorMemoryLimit(persona.rarity));
        target.bond = Math.min(100, target.bond + 1);
        profile.ai.lastExchange = exchange;
      });
      return this.response(result.profile, result.profile.ai.lastExchange ?? exchange);
    });
  }

  private response(profile: PlayerProfile, exchange: PersonaExchange): PersonaChatResponse {
    const today = this.now().toISOString().slice(0, 10);
    return {
      profile,
      exchange,
      usage: {
        used: profile.ai.dailyUsageDate === today ? profile.ai.dailyTurnsUsed : 0,
        limit: this.dailyTurnLimit,
      },
    };
  }

  private consumeRateLimit(playerId: string): void {
    const now = this.now().getTime();
    if (this.rateWindows.size > 10_000) {
      for (const [id, window] of this.rateWindows) {
        if (now - window.startedAt >= 60_000) this.rateWindows.delete(id);
      }
    }
    const current = this.rateWindows.get(playerId);
    if (!current || now - current.startedAt >= 60_000) {
      this.rateWindows.set(playerId, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= 4) throw new PersonaError('AI_RATE_LIMITED', 429);
    current.count += 1;
  }

  private async withPlayerLock<T>(playerId: string, task: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.queues.get(playerId) ?? Promise.resolve();
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.queues.set(playerId, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.queues.get(playerId) === queued) this.queues.delete(playerId);
    }
  }
}

function buildMemory(operatorName: string, message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim().slice(0, 72);
  return `${operatorName}와 “${compact}”에 관해 쉘터에서 대화했다.`;
}
