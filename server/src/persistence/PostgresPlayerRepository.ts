import { Pool, type PoolClient } from 'pg';
import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import type { FunnelEventName, FunnelProperties } from '../../../packages/shared/src/analytics.js';
import type { CommercePlatform, StoreProductId } from '../../../packages/shared/src/commerce.js';
import { PurchaseReceiptConflictError, type PlayerRepository, type ProfileMutation } from './PlayerRepository.js';
import { createPlayerProfile, normalizePlayerProfile } from './profileFactory.js';

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
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        event_name VARCHAR(48) NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_event_created
        ON analytics_events(event_name, created_at DESC);
      CREATE TABLE IF NOT EXISTS commerce_receipts (
        platform VARCHAR(16) NOT NULL,
        transaction_id VARCHAR(180) NOT NULL,
        player_id UUID REFERENCES players(id) ON DELETE SET NULL,
        product_id VARCHAR(64) NOT NULL,
        result_profile JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(platform, transaction_id)
      );
      CREATE INDEX IF NOT EXISTS idx_commerce_receipts_player_created
        ON commerce_receipts(player_id, created_at DESC);
      ALTER TABLE commerce_receipts DROP CONSTRAINT IF EXISTS commerce_receipts_player_id_fkey;
      ALTER TABLE commerce_receipts ALTER COLUMN player_id DROP NOT NULL;
      ALTER TABLE commerce_receipts ADD CONSTRAINT commerce_receipts_player_id_fkey
        FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE SET NULL;
    `);
  }

  async shutdown(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async getOrCreateGuest(deviceId: string): Promise<PlayerProfile> {
    const existing = await this.pool.query<{ profile: PlayerProfile }>('SELECT profile FROM players WHERE device_id = $1', [deviceId]);
    if (existing.rowCount) return normalizePlayerProfile(existing.rows[0].profile);
    const profile = createPlayerProfile(deviceId);
    const inserted = await this.pool.query<{ profile: PlayerProfile }>(`
      INSERT INTO players(id, device_id, profile, last_seen_at, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
      ON CONFLICT(device_id) DO UPDATE SET updated_at = NOW()
      RETURNING profile
    `, [profile.playerId, deviceId, JSON.stringify(profile), profile.lastSeenAt, profile.createdAt]);
    return normalizePlayerProfile(inserted.rows[0].profile);
  }

  async getById(playerId: string): Promise<PlayerProfile | null> {
    const result = await this.pool.query<{ profile: PlayerProfile }>('SELECT profile FROM players WHERE id = $1', [playerId]);
    return result.rows[0] ? normalizePlayerProfile(result.rows[0].profile) : null;
  }

  async deletePlayer(playerId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE commerce_receipts SET result_profile = '{"deleted":true}'::jsonb WHERE player_id = $1`,
        [playerId],
      );
      const result = await client.query('DELETE FROM players WHERE id = $1', [playerId]);
      await client.query('COMMIT');
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAnalytics(playerId: string, event: FunnelEventName, properties: FunnelProperties): Promise<void> {
    await this.pool.query(
      'INSERT INTO analytics_events(player_id, event_name, properties) VALUES ($1, $2, $3::jsonb)',
      [playerId, event, JSON.stringify(properties)],
    );
  }

  async mutatePurchase(
    playerId: string,
    platform: CommercePlatform,
    transactionId: string,
    productId: StoreProductId,
    mutation: ProfileMutation,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await client.query<{ player_id: string | null; product_id: StoreProductId; result_profile: PlayerProfile }>(
        'SELECT player_id, product_id, result_profile FROM commerce_receipts WHERE platform = $1 AND transaction_id = $2',
        [platform, transactionId],
      );
      if (receipt.rowCount) {
        if (receipt.rows[0].player_id !== playerId || receipt.rows[0].product_id !== productId) {
          throw new PurchaseReceiptConflictError();
        }
        await client.query('COMMIT');
        return { profile: normalizePlayerProfile(receipt.rows[0].result_profile), replayed: true };
      }

      const profile = await this.lockProfile(client, playerId);
      await mutation(profile);
      profile.lastSeenAt = new Date().toISOString();
      await client.query(
        'UPDATE players SET profile = $2::jsonb, last_seen_at = $3, updated_at = NOW() WHERE id = $1',
        [playerId, JSON.stringify(profile), profile.lastSeenAt],
      );
      await client.query(`
        INSERT INTO commerce_receipts(platform, transaction_id, player_id, product_id, result_profile)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [platform, transactionId, playerId, productId, JSON.stringify(profile)]);
      await client.query('COMMIT');
      return { profile, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const receipt = await this.pool.query<{ player_id: string | null; product_id: StoreProductId; result_profile: PlayerProfile }>(
          'SELECT player_id, product_id, result_profile FROM commerce_receipts WHERE platform = $1 AND transaction_id = $2',
          [platform, transactionId],
        );
        if (receipt.rows[0]?.player_id === playerId && receipt.rows[0]?.product_id === productId) {
          return { profile: normalizePlayerProfile(receipt.rows[0].result_profile), replayed: true };
        }
        throw new PurchaseReceiptConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
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
    return normalizePlayerProfile(result.rows[0].profile);
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
