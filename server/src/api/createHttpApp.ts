import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ServerConfig } from '../config/env.js';
import { EconomyError, EconomyService } from '../economy/EconomyService.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';
import { TokenService } from '../auth/TokenService.js';
import { CommerceError, CommerceService } from '../commerce/CommerceService.js';
import { FUNNEL_EVENTS } from '../../../packages/shared/src/analytics.js';
import { RECRUIT_ODDS, STORE_PRODUCT_IDS, STORE_PRODUCTS } from '../../../packages/shared/src/commerce.js';
import { APP_VERSION } from '../../../packages/shared/src/release.js';
import { GEAR_IDS } from '../../../packages/shared/src/gear.js';
import { PersonaError, PersonaService } from '../ai/PersonaService.js';
import { CONTRACT_IDS } from '../../../packages/shared/src/contracts.js';

export interface ApiDependencies {
  config: ServerConfig;
  repository: PlayerRepository;
  economy: EconomyService;
  tokens: TokenService;
  commerce?: CommerceService;
  persona?: PersonaService;
}

const deviceSchema = z.object({
  deviceId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
});
const upgradeSchema = z.object({ module: z.enum(['command', 'purifier', 'workshop', 'greenhouse']) });
const squadSchema = z.object({
  squad: z.array(z.string().min(1).max(32)).length(3)
    .refine((operators) => new Set(operators).size === operators.length, 'Squad operators must be unique'),
});
const craftGearSchema = z.object({ gearId: z.enum(GEAR_IDS) });
const gearLoadoutSchema = z.object({
  equipped: z.array(z.enum(GEAR_IDS)).max(2)
    .refine((gear) => new Set(gear).size === gear.length, 'Equipped gear must be unique'),
});
const purchaseSchema = z.object({
  platform: z.enum(['google', 'apple', 'steam']),
  productId: z.enum(STORE_PRODUCT_IDS),
  receipt: z.string().min(6).max(16_000),
});
const analyticsSchema = z.object({
  event: z.enum(FUNNEL_EVENTS),
  properties: z.record(
    z.string().min(1).max(32),
    z.union([z.string().max(120), z.number().finite(), z.boolean()]),
  ).refine((value) => Object.keys(value).length <= 12, 'Too many analytics properties').default({}),
});
const deleteAccountSchema = z.object({ confirmation: z.literal('DELETE') });
const aiConsentSchema = z.object({ consent: z.boolean() });
const personaChatSchema = z.object({
  operatorId: z.string().min(1).max(32).regex(/^[a-z0-9-]+$/),
  message: z.string().trim().min(1).max(280),
  useExternalAi: z.boolean().default(false),
});
const operatorIdSchema = z.string().min(1).max(32).regex(/^[a-z0-9-]+$/);
const contractIdSchema = z.enum(CONTRACT_IDS);

export function configureHttpApp(app: express.Application, deps: ApiDependencies): void {
  const commerce = deps.commerce ?? new CommerceService(deps.repository);
  const persona = deps.persona ?? new PersonaService(deps.repository);
  app.disable('x-powered-by');
  app.use(cors({ origin: deps.config.corsOrigin.split(',').map((origin) => origin.trim()), credentials: false }));
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', async (_request, response) => {
    response.json({
      status: 'ok', service: 'neural-evolution-game-server', version: APP_VERSION,
      channel: deps.config.releaseChannel, storage: deps.config.databaseUrl ? 'postgres' : 'memory',
    });
  });

  app.get('/ready', async (_request, response) => {
    try {
      await deps.repository.healthCheck();
      response.json({ status: 'ready', version: APP_VERSION, channel: deps.config.releaseChannel });
    } catch {
      response.status(503).json({ status: 'unavailable', requestId: response.locals.requestId });
    }
  });

  app.get('/api/release', (_request, response) => {
    response.json({
      version: APP_VERSION,
      channel: deps.config.releaseChannel,
      commit: deps.config.commitSha,
      commerceAvailable: commerce.checkoutAvailable,
      aiAvailable: persona.externalAiAvailable,
      aiDailyTurnLimit: persona.dailyTurnLimit,
      serverTime: new Date().toISOString(),
    });
  });

  app.post('/api/auth/guest', async (request, response) => {
    const body = deviceSchema.parse(request.body);
    const profile = await deps.repository.getOrCreateGuest(body.deviceId);
    response.status(200).json({ token: deps.tokens.issue(profile.playerId, profile.deviceId), profile });
  });

  app.get('/api/profile', requirePlayer(deps.tokens), async (_request, response) => {
    const profile = await deps.repository.getById(response.locals.playerId as string);
    if (!profile) return response.status(404).json({ error: 'PLAYER_NOT_FOUND' });
    return response.json({ profile });
  });

  app.get('/api/account/export', requirePlayer(deps.tokens), async (_request, response) => {
    const profile = await deps.repository.getById(response.locals.playerId as string);
    if (!profile) return response.status(404).json({ error: 'PLAYER_NOT_FOUND' });
    return response.json({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      dataUse: {
        required: ['인증 식별자', '게임 진행도', '구매 검증 기록'],
        optional: ['동의한 경우의 진행·오류 분석 이벤트'],
        ai: profile.ai.consentedAt
          ? '동의한 딥 토크 원문은 응답 생성 동안 외부 AI 제공자에게 전송될 수 있으며, 게임 서버에는 요약 기억과 마지막 응답이 저장됩니다.'
          : '외부 AI 전송 동의가 꺼져 있어 대화는 기기 및 게임 서버의 규칙 기반 페르소나로 처리됩니다.',
      },
    });
  });

  app.delete('/api/account', requirePlayer(deps.tokens), async (request, response) => {
    deleteAccountSchema.parse(request.body);
    const deleted = await deps.repository.deletePlayer(response.locals.playerId as string);
    if (!deleted) return response.status(404).json({ error: 'PLAYER_NOT_FOUND' });
    return response.json({ deleted: true });
  });

  app.post('/api/economy/offline/claim', requirePlayer(deps.tokens), async (request, response) => {
    const result = await deps.economy.claimOffline(
      response.locals.playerId as string,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.post('/api/economy/shelter/upgrade', requirePlayer(deps.tokens), async (request, response) => {
    const body = upgradeSchema.parse(request.body);
    const result = await deps.economy.upgradeShelter(
      response.locals.playerId as string,
      body.module,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.post('/api/economy/recruit', requirePlayer(deps.tokens), async (request, response) => {
    const result = await deps.economy.recruit(response.locals.playerId as string, idempotencyKey(request));
    response.json(result);
  });

  app.post('/api/profile/squad', requirePlayer(deps.tokens), async (request, response) => {
    const body = squadSchema.parse(request.body);
    const result = await deps.economy.setSquad(
      response.locals.playerId as string,
      body.squad,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.post('/api/economy/gear/craft', requirePlayer(deps.tokens), async (request, response) => {
    const body = craftGearSchema.parse(request.body);
    const result = await deps.economy.craftGear(
      response.locals.playerId as string,
      body.gearId,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.post('/api/profile/gear', requirePlayer(deps.tokens), async (request, response) => {
    const body = gearLoadoutSchema.parse(request.body);
    const result = await deps.economy.setGearLoadout(
      response.locals.playerId as string,
      body.equipped,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.get('/api/contracts', requirePlayer(deps.tokens), async (_request, response) => {
    const board = await deps.economy.getContractBoard(response.locals.playerId as string);
    response.json({ board, serverTime: new Date().toISOString() });
  });

  app.post('/api/contracts/:contractId/claim', requirePlayer(deps.tokens), async (request, response) => {
    const contractId = contractIdSchema.parse(request.params.contractId);
    const result = await deps.economy.claimContract(
      response.locals.playerId as string,
      contractId,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.put('/api/profile/ai-consent', requirePlayer(deps.tokens), async (request, response) => {
    const body = aiConsentSchema.parse(request.body);
    const profile = await persona.setConsent(
      response.locals.playerId as string,
      body.consent,
      idempotencyKey(request),
    );
    response.json({ profile });
  });

  app.post('/api/persona/chat', requirePlayer(deps.tokens), async (request, response) => {
    const body = personaChatSchema.parse(request.body);
    const result = await persona.chat(
      response.locals.playerId as string,
      body.operatorId,
      body.message,
      body.useExternalAi,
      idempotencyKey(request),
    );
    response.json(result);
  });

  app.delete('/api/persona/:operatorId/memories', requirePlayer(deps.tokens), async (request, response) => {
    const operatorId = operatorIdSchema.parse(request.params.operatorId);
    const profile = await persona.clearMemories(
      response.locals.playerId as string,
      operatorId,
      idempotencyKey(request),
    );
    response.json({ profile });
  });

  app.get('/api/store/catalog', (_request, response) => {
    response.json({
      products: STORE_PRODUCTS,
      recruitOdds: RECRUIT_ODDS,
      checkoutAvailable: commerce.checkoutAvailable,
      priceNotice: '최종 가격과 결제 통화는 플랫폼 결제창에 표시된 값이 우선합니다.',
    });
  });

  app.post('/api/store/verify', requirePlayer(deps.tokens), async (request, response) => {
    const body = purchaseSchema.parse(request.body);
    const playerId = response.locals.playerId as string;
    const result = await commerce.verifyAndGrant({ ...body, playerId });
    if (!result.replayed) {
      await deps.repository.recordAnalytics(playerId, 'purchase_complete', {
        productId: body.productId, platform: body.platform,
        amountMinor: result.purchase.amountMinor, currency: result.purchase.currency,
      });
    }
    response.json(result);
  });

  app.post('/api/analytics/events', requirePlayer(deps.tokens), async (request, response) => {
    const body = analyticsSchema.parse(request.body);
    await deps.repository.recordAnalytics(response.locals.playerId as string, body.event, body.properties);
    response.status(202).json({ accepted: true });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      return response.status(400).json({ error: 'INVALID_JSON' });
    }
    if (error instanceof z.ZodError) return response.status(400).json({ error: 'INVALID_REQUEST', issues: error.issues });
    if (error instanceof EconomyError) return response.status(error.status).json({ error: error.message });
    if (error instanceof CommerceError) return response.status(error.status).json({ error: error.message });
    if (error instanceof PersonaError) return response.status(error.status).json({ error: error.message });
    if (error instanceof Error && error.message === 'PLAYER_NOT_FOUND') return response.status(404).json({ error: error.message });
    console.error({ requestId: response.locals.requestId, error });
    return response.status(500).json({ error: 'INTERNAL_SERVER_ERROR', requestId: response.locals.requestId });
  });
}

export function createStandaloneHttpApp(deps: ApiDependencies): express.Application {
  const app = express();
  configureHttpApp(app, deps);
  return app;
}

function requirePlayer(tokens: TokenService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const authorization = request.header('authorization');
      if (!authorization?.startsWith('Bearer ')) {
        response.status(401).json({ error: 'AUTH_REQUIRED' });
        return;
      }
      response.locals.playerId = tokens.verify(authorization.slice(7)).sub;
      next();
    } catch {
      response.status(401).json({ error: 'INVALID_TOKEN' });
    }
  };
}

function idempotencyKey(request: Request): string {
  const header = request.header('idempotency-key');
  if (!header) return randomUUID();
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(header)) throw new EconomyError('INVALID_IDEMPOTENCY_KEY', 400);
  return header;
}
