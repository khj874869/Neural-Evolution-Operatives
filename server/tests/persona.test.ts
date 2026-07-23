import { describe, expect, it, vi } from 'vitest';
import {
  OpenAIResponsesPersonaProvider, PersonaSafetyError, type PersonaProvider,
} from '../src/ai/OpenAIResponsesPersonaProvider.js';
import { PersonaError, PersonaService } from '../src/ai/PersonaService.js';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';
import { getOperatorPersona } from '../../packages/shared/src/persona.js';

describe('persona service', () => {
  it('requires consent for external AI, persists bounded memories, and replays idempotently', async () => {
    const repository = new InMemoryPlayerRepository();
    const profile = await repository.getOrCreateGuest('persona:test-device-0001');
    const provider: PersonaProvider = {
      available: true,
      generate: vi.fn(async ({ persona }) => `${persona.callsign}: 외부 링크 응답입니다.`),
    };
    const now = () => new Date('2026-07-23T06:00:00.000Z');
    const service = new PersonaService(repository, provider, 2, now);

    const local = await service.chat(profile.playerId, 'aegis-07', '오늘 작전은 어땠어?', false, 'talk:req:0001');
    expect(local.exchange.source).toBe('rules');
    expect(provider.generate).not.toHaveBeenCalled();

    await service.setConsent(profile.playerId, true, 'consent:req:0001');
    const external = await service.chat(profile.playerId, 'aegis-07', '내 판단을 믿어?', true, 'talk:req:0002');
    expect(external.exchange).toMatchObject({ source: 'ai', reply: 'AEGIS-07: 외부 링크 응답입니다.' });
    expect(external.usage).toEqual({ used: 1, limit: 2 });
    expect(external.profile.operators.find((operator) => operator.id === 'aegis-07')?.memories[0]).toContain('내 판단');

    const replay = await service.chat(profile.playerId, 'aegis-07', '바뀐 입력', true, 'talk:req:0002');
    expect(replay.exchange).toEqual(external.exchange);
    expect(provider.generate).toHaveBeenCalledTimes(1);

    await service.chat(profile.playerId, 'aegis-07', '두 번째 외부 호출', true, 'talk:req:0003');
    const capped = await service.chat(profile.playerId, 'aegis-07', '할당량 이후 호출', true, 'talk:req:0004');
    expect(capped.exchange.source).toBe('rules');
    expect(capped.usage.used).toBe(2);

    const cleared = await service.clearMemories(profile.playerId, 'aegis-07', 'memory:req:0001');
    expect(cleared.operators.find((operator) => operator.id === 'aegis-07')?.memories).toEqual([]);
  });

  it('fails closed when provider moderation blocks the input', async () => {
    const repository = new InMemoryPlayerRepository();
    const profile = await repository.getOrCreateGuest('persona:test-device-0002');
    const provider: PersonaProvider = {
      available: true,
      generate: vi.fn(async () => { throw new PersonaSafetyError('AI_INPUT_BLOCKED'); }),
    };
    const service = new PersonaService(repository, provider);
    await service.setConsent(profile.playerId, true, 'consent:req:0002');

    await expect(service.chat(
      profile.playerId, 'lumen', '차단 대상 입력', true, 'talk:req:blocked',
    )).rejects.toMatchObject({ message: 'AI_INPUT_BLOCKED', status: 422 } satisfies Partial<PersonaError>);
    const unchanged = await repository.getById(profile.playerId);
    expect(unchanged?.operators.find((operator) => operator.id === 'lumen')?.memories).toEqual([]);
  });
});

describe('OpenAI Responses persona provider', () => {
  it('moderates both sides, disables response storage, and sends a pseudonymous safety id', async () => {
    const fetcherMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ flagged: false }] }))
      .mockResolvedValueOnce(jsonResponse({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '링크 상태는 안정적입니다.' }] }],
      }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ flagged: false }] }));
    const fetcher = fetcherMock as unknown as typeof fetch;
    const provider = new OpenAIResponsesPersonaProvider('test-key', 'gpt-5.6-terra', 8_000, true, fetcher);

    const reply = await provider.generate({
      playerId: 'player-secret-id',
      persona: getOperatorPersona('aegis-07'),
      message: '오늘도 지켜줄 거야?',
      bond: 24,
      memories: ['첫 작전을 함께 완료했다.'],
    });

    expect(reply).toBe('링크 상태는 안정적입니다.');
    expect(fetcherMock).toHaveBeenCalledTimes(3);
    const responseRequest = fetcherMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(responseRequest[0]).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(responseRequest[1].body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.6-terra',
      store: false,
      input: '오늘도 지켜줄 거야?',
      max_output_tokens: 180,
    });
    expect(body.safety_identifier).toMatch(/^[a-f0-9]{32}$/);
    expect(body.safety_identifier).not.toContain('player-secret-id');
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
