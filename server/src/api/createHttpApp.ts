import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ServerConfig } from '../config/env.js';
import { EconomyError, EconomyService } from '../economy/EconomyService.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';
import { TokenService } from '../auth/TokenService.js';

export interface ApiDependencies {
  config: ServerConfig;
  repository: PlayerRepository;
  economy: EconomyService;
  tokens: TokenService;
}

const deviceSchema = z.object({
  deviceId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
});
const upgradeSchema = z.object({ module: z.enum(['command', 'purifier', 'workshop', 'greenhouse']) });

export function configureHttpApp(app: express.Application, deps: ApiDependencies): void {
  app.disable('x-powered-by');
  app.use(cors({ origin: deps.config.corsOrigin.split(',').map((origin) => origin.trim()), credentials: false }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', async (_request, response) => {
    response.json({ status: 'ok', service: 'neural-evolution-game-server', storage: deps.config.databaseUrl ? 'postgres' : 'memory' });
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

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: 'INVALID_REQUEST', issues: error.issues });
    if (error instanceof EconomyError) return response.status(error.status).json({ error: error.message });
    if (error instanceof Error && error.message === 'PLAYER_NOT_FOUND') return response.status(404).json({ error: error.message });
    console.error(error);
    return response.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
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
