import { randomBytes } from 'node:crypto';
import { normalizeReleaseChannel, type ReleaseChannel } from '../../../packages/shared/src/release.js';

export interface ServerConfig {
  host: string;
  port: number;
  corsOrigin: string;
  jwtSecret: string;
  databaseUrl?: string;
  redisUrl?: string;
  nodeEnv: string;
  releaseChannel: ReleaseChannel;
  commitSha: string;
  aiApiKey?: string;
  aiModel: string;
  aiDailyTurnLimit: number;
  aiTimeoutMs: number;
  aiModerationEnabled: boolean;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? randomBytes(32).toString('hex');
  if (nodeEnv === 'production' && (!env.JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be explicitly set to at least 32 characters in production');
  }
  if (nodeEnv === 'production' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be configured in production');
  }
  if (nodeEnv === 'production' && !env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be explicitly configured in production');
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    jwtSecret,
    databaseUrl: env.DATABASE_URL || undefined,
    redisUrl: env.REDIS_URL || undefined,
    nodeEnv,
    releaseChannel: normalizeReleaseChannel(env.RELEASE_CHANNEL, nodeEnv === 'development' ? 'development' : 'alpha'),
    commitSha: sanitizeCommitSha(env.COMMIT_SHA),
    aiApiKey: env.OPENAI_API_KEY || undefined,
    aiModel: sanitizeModel(env.OPENAI_MODEL),
    aiDailyTurnLimit: boundedInteger(env.AI_DAILY_TURN_LIMIT, 12, 1, 100),
    aiTimeoutMs: boundedInteger(env.AI_TIMEOUT_MS, 8_000, 1_000, 30_000),
    aiModerationEnabled: env.AI_MODERATION_ENABLED !== 'false',
  };
}

function sanitizeCommitSha(value: string | undefined): string {
  return value && /^[a-f0-9]{7,40}$/i.test(value) ? value.toLowerCase() : 'unknown';
}

function sanitizeModel(value: string | undefined): string {
  return value && /^[a-zA-Z0-9._-]{3,80}$/.test(value) ? value : 'gpt-5.6-terra';
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
