import { Server } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { ServerConfig } from './config/env.js';
import { configureHttpApp } from './api/createHttpApp.js';
import { TokenService } from './auth/TokenService.js';
import { EconomyService } from './economy/EconomyService.js';
import { InMemoryPlayerRepository } from './persistence/InMemoryPlayerRepository.js';
import { PostgresPlayerRepository } from './persistence/PostgresPlayerRepository.js';
import type { PlayerRepository } from './persistence/PlayerRepository.js';
import { configureRoomDependencies } from './rooms/dependencies.js';
import { RedZoneRoom } from './rooms/RedZoneRoom.js';

export interface GameServerBundle {
  gameServer: Server;
  repository: PlayerRepository;
}

export function createGameServer(config: ServerConfig): GameServerBundle {
  const repository: PlayerRepository = config.databaseUrl
    ? new PostgresPlayerRepository(config.databaseUrl)
    : new InMemoryPlayerRepository();
  const tokens = new TokenService(config.jwtSecret);
  const economy = new EconomyService(repository);
  configureRoomDependencies({ tokens, repository, economy });

  const gameServer = new Server({
    transport: new WebSocketTransport({ maxPayload: 8 * 1024 }),
    presence: config.redisUrl ? new RedisPresence(config.redisUrl) : undefined,
    driver: config.redisUrl ? new RedisDriver(config.redisUrl) : undefined,
    greet: config.nodeEnv !== 'test',
    beforeListen: () => repository.initialize(),
    express: (app) => configureHttpApp(app, { config, repository, economy, tokens }),
  });
  gameServer.define('red_zone', RedZoneRoom);
  gameServer.onShutdown(() => repository.shutdown());
  return { gameServer, repository };
}
