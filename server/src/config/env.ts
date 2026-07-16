export interface ServerConfig {
  host: string;
  port: number;
  corsOrigin: string;
  jwtSecret: string;
  databaseUrl?: string;
  redisUrl?: string;
  nodeEnv: string;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? 'development-only-change-me-before-production';
  if (nodeEnv === 'production' && (!env.JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be explicitly set to at least 32 characters in production');
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    jwtSecret,
    databaseUrl: env.DATABASE_URL || undefined,
    redisUrl: env.REDIS_URL || undefined,
    nodeEnv,
  };
}
