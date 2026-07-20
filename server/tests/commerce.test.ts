import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreProduct } from '../../packages/shared/src/commerce.js';
import {
  CommerceService,
  type ReceiptVerificationRequest,
  type ReceiptVerifier,
  type VerifiedPurchase,
} from '../src/commerce/CommerceService.js';
import { InMemoryPlayerRepository } from '../src/persistence/InMemoryPlayerRepository.js';

class TestReceiptVerifier implements ReceiptVerifier {
  readonly available = true;

  async verify(request: ReceiptVerificationRequest, product: StoreProduct): Promise<VerifiedPurchase> {
    return {
      transactionId: request.receipt,
      productId: request.productId,
      purchasedAt: '2026-07-16T00:00:00.000Z',
      amountMinor: product.displayPriceKrw,
      currency: 'KRW',
    };
  }
}

describe('server authoritative commerce', () => {
  let repository: InMemoryPlayerRepository;

  beforeEach(async () => {
    repository = new InMemoryPlayerRepository();
    await repository.initialize();
  });

  it('grants a verified founder purchase exactly once', async () => {
    const profile = await repository.getOrCreateGuest('test:commerce-founder');
    const commerce = new CommerceService(repository, new TestReceiptVerifier());
    const request = {
      playerId: profile.playerId,
      platform: 'google' as const,
      productId: 'founder_supply' as const,
      receipt: 'google-order-000001',
    };
    const first = await commerce.verifyAndGrant(request);
    const replay = await commerce.verifyAndGrant(request);
    expect(first.profile.resources.cores).toBe(25);
    expect(first.profile.commerce.entitlements).toContain('founder_badge');
    expect(replay.profile.resources.cores).toBe(25);
    expect(replay.replayed).toBe(true);
  });

  it('stacks subscription time from a verified renewal', async () => {
    const profile = await repository.getOrCreateGuest('test:commerce-sync');
    const commerce = new CommerceService(repository, new TestReceiptVerifier());
    const first = await commerce.verifyAndGrant({
      playerId: profile.playerId, platform: 'apple', productId: 'neural_sync_30d', receipt: 'apple-order-000001',
    });
    const second = await commerce.verifyAndGrant({
      playerId: profile.playerId, platform: 'apple', productId: 'neural_sync_30d', receipt: 'apple-order-000002',
    });
    const firstUntil = new Date(first.profile.commerce.subscriptionUntil!).getTime();
    const secondUntil = new Date(second.profile.commerce.subscriptionUntil!).getTime();
    expect(secondUntil - firstUntil).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it('blocks a verified transaction from being copied to another account', async () => {
    const firstPlayer = await repository.getOrCreateGuest('test:commerce-owner');
    const secondPlayer = await repository.getOrCreateGuest('test:commerce-attacker');
    const commerce = new CommerceService(repository, new TestReceiptVerifier());
    await commerce.verifyAndGrant({
      playerId: firstPlayer.playerId, platform: 'steam', productId: 'core_cache_s', receipt: 'steam-order-global-01',
    });
    await expect(commerce.verifyAndGrant({
      playerId: secondPlayer.playerId, platform: 'steam', productId: 'core_cache_s', receipt: 'steam-order-global-01',
    })).rejects.toMatchObject({ message: 'PURCHASE_RECEIPT_ALREADY_CLAIMED', status: 409 });
    const attacker = await repository.getById(secondPlayer.playerId);
    expect(attacker?.resources.cores).toBe(10);
  });

  it('keeps only a receipt tombstone after account deletion to block duplicate grants', async () => {
    const firstPlayer = await repository.getOrCreateGuest('test:commerce-delete-owner');
    const commerce = new CommerceService(repository, new TestReceiptVerifier());
    await commerce.verifyAndGrant({
      playerId: firstPlayer.playerId, platform: 'google', productId: 'core_cache_s', receipt: 'deleted-order-global-01',
    });
    await repository.deletePlayer(firstPlayer.playerId);
    const nextPlayer = await repository.getOrCreateGuest('test:commerce-delete-owner');
    await expect(commerce.verifyAndGrant({
      playerId: nextPlayer.playerId, platform: 'google', productId: 'core_cache_s', receipt: 'deleted-order-global-01',
    })).rejects.toMatchObject({ message: 'PURCHASE_RECEIPT_ALREADY_CLAIMED', status: 409 });
  });
});
