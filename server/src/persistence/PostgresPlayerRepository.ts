import { Pool, type PoolClient } from 'pg';
import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import type { PlayerRepository, ProfileMutation } from './PlayerRepository.js';
import { createPlayerProfile } from './profileFactory.js';

export class PostgresPlayerRepository implements PlayerRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id UUID PRIMARY KEY,
        device_id VARCHAR(128) NOT NULL UNIQUE,
        profile JSONB NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS economy_events (
        id BIGSERIAL PRIMARY KEY,
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        idempotency_key VARCHAR(128) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        result_profile JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(player_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_economy_events_player_created
        ON economy_events(player_id, created_at DESC);
    `);
  }

  async shutdown(): Promise<void> {
    await this.pool.end();
  }

  async getOrCreateGuest(deviceId: string): Promise<PlayerProfile> {
    const existing = await this.pool.query<{ profile: PlayerProfile }>('SELECT profile FROM players WHERE device_id = $1', [deviceId]);
    if (existing.rowCount) return existing.rows[0].profile;
    const profile = createPlayerProfile(deviceId);
    const inserted = await this.pool.query<{ profile: PlayerProfile }>(`
      INSERT INTO players(id, device_id, profile, last_seen_at, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
      ON CONFLICT(device_id) DO UPDATE SET updated_at = NOW()
      RETURNING profile
    `, [profile.playerId, deviceId, JSON.stringify(profile), profile.lastSeenAt, profile.createdAt]);
    return inserted.rows[0].profile;
  }

  async getById(playerId: string): Promise<PlayerProfile | null> {
    const result = await this.pool.query<{ profile: PlayerProfile }>('SELECT profile FROM players WHERE id = $1', [playerId]);
    return result.rows[0]?.profile ?? null;
  }

  async mutate(playerId: string, idempotencyKey: string, eventType: string, mutation: ProfileMutation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await client.query<{ result_profile: PlayerProfile }>(
        'SELECT result_profile FROM economy_events WHERE player_id = $1 AND idempotency_key = $2',
        [playerId, idempotencyKey],
      );
      if (replay.rowCount) {
        await client.query('COMMIT');
        return { profile: replay.rows[0].result_profile, replayed: true };
      }
      const profile = await this.lockProfile(client, playerId);
      await mutation(profile);
      profile.lastSeenAt = new Date().toISOString();
      await client.query(
        'UPDATE players SET profile = $2::jsonb, last_seen_at = $3, updated_at = NOW() WHERE id = $1',
        [playerId, JSON.stringify(profile), profile.lastSeenAt],
      );
      await client.query(`
        INSERT INTO economy_events(player_id, idempotency_key, event_type, result_profile)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [playerId, idempotencyKey, eventType, JSON.stringify(profile)]);
      await client.query('COMMIT');
      return { profile, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockProfile(client: PoolClient, playerId: string): Promise<PlayerProfile> {
    const result = await client.query<{ profile: PlayerProfile }>('SELECT profile FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (!result.rowCount) throw new Error('PLAYER_NOT_FOUND');
    return result.rows[0].profile;
  }
}
