import type { CommercePlatform, StoreProduct, StoreProductId } from '../../../packages/shared/src/commerce.js';
import { getStoreProduct } from '../../../packages/shared/src/commerce.js';
import type { PlayerProfile } from '../../../packages/shared/src/protocol.js';
import type { PlayerRepository } from '../persistence/PlayerRepository.js';
import { PurchaseReceiptConflictError } from '../persistence/PlayerRepository.js';

export interface ReceiptVerificationRequest {
  platform: CommercePlatform;
  productId: StoreProductId;
  receipt: string;
  playerId: string;
}

export interface VerifiedPurchase {
  transactionId: string;
  productId: StoreProductId;
  purchasedAt: string;
  amountMinor: number;
  currency: string;
}

export interface ReceiptVerifier {
  readonly available: boolean;
  verify(request: ReceiptVerificationRequest, expectedProduct: StoreProduct): Promise<VerifiedPurchase>;
}

export class DisabledReceiptVerifier implements ReceiptVerifier {
  readonly available = false;

  async verify(): Promise<VerifiedPurchase> {
    throw new CommerceError('PLATFORM_BILLING_NOT_CONFIGURED', 503);
  }
}

export class CommerceService {
  constructor(
    private readonly repository: PlayerRepository,
    private readonly verifier: ReceiptVerifier = new DisabledReceiptVerifier(),
  ) {}

  get checkoutAvailable(): boolean {
    return this.verifier.available;
  }

  async verifyAndGrant(request: ReceiptVerificationRequest) {
    const product = getStoreProduct(request.productId);
    if (!product) throw new CommerceError('PRODUCT_NOT_FOUND', 404);
    const verified = await this.verifier.verify(request, product);
    if (verified.productId !== product.id || !/^[a-zA-Z0-9:._-]{6,180}$/.test(verified.transactionId)) {
      throw new CommerceError('INVALID_PURCHASE_RECEIPT', 400);
    }
    if (!Number.isSafeInteger(verified.amountMinor) || verified.amountMinor < 0 || verified.amountMinor > 1_000_000_000
      || !/^[A-Z]{3}$/.test(verified.currency)) {
      throw new CommerceError('INVALID_PURCHASE_AMOUNT', 400);
    }
    const purchasedAt = validIsoDate(verified.purchasedAt);
    try {
      const mutation = await this.repository.mutatePurchase(
        request.playerId,
        request.platform,
        verified.transactionId,
        product.id,
        (profile) => grantProduct(
          profile, product, request.platform, verified.transactionId, purchasedAt,
          verified.amountMinor, verified.currency,
        ),
      );
      return { ...mutation, purchase: { amountMinor: verified.amountMinor, currency: verified.currency } };
    } catch (error) {
      if (error instanceof PurchaseReceiptConflictError) throw new CommerceError('PURCHASE_RECEIPT_ALREADY_CLAIMED', 409);
      throw error;
    }
  }
}

function grantProduct(
  profile: PlayerProfile,
  product: StoreProduct,
  platform: CommercePlatform,
  transactionId: string,
  purchasedAt: string,
  amountMinor: number,
  currency: string,
): void {
  profile.commerce ??= { entitlements: [], subscriptionUntil: null, purchases: [] };
  if (product.type === 'non_consumable'
    && profile.commerce.purchases.some((purchase) => purchase.productId === product.id)) {
    throw new CommerceError('PRODUCT_ALREADY_OWNED', 409);
  }
  for (const [key, value] of Object.entries(product.grant.resources ?? {})) {
    const resource = key as keyof PlayerProfile['resources'];
    profile.resources[resource] += Math.max(0, Math.floor(value ?? 0));
  }
  profile.commerce.entitlements = [...new Set([
    ...profile.commerce.entitlements,
    ...(product.grant.entitlements ?? []),
  ])];
  if (product.grant.subscriptionDays) {
    const now = new Date(purchasedAt).getTime();
    const current = profile.commerce.subscriptionUntil
      ? new Date(profile.commerce.subscriptionUntil).getTime() : 0;
    const startsAt = Math.max(now, Number.isFinite(current) ? current : 0);
    profile.commerce.subscriptionUntil = new Date(
      startsAt + product.grant.subscriptionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
  }
  profile.commerce.purchases = [
    ...profile.commerce.purchases,
    { transactionId, productId: product.id, platform, purchasedAt, amountMinor, currency },
  ].slice(-200);
}

function validIsoDate(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new CommerceError('INVALID_PURCHASE_DATE', 400);
  return new Date(timestamp).toISOString();
}

export class CommerceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
