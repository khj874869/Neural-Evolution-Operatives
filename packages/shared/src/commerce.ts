export const STORE_PRODUCT_IDS = ['core_cache_s', 'founder_supply', 'neural_sync_30d'] as const;
export type StoreProductId = typeof STORE_PRODUCT_IDS[number];
export type CommercePlatform = 'google' | 'apple' | 'steam';

export interface StoreProduct {
  id: StoreProductId;
  type: 'consumable' | 'non_consumable' | 'subscription';
  title: string;
  description: string;
  displayPriceKrw: number;
  badge?: string;
  skus: Record<CommercePlatform, string>;
  grant: {
    resources?: Partial<{ scrap: number; water: number; data: number; cores: number }>;
    entitlements?: string[];
    subscriptionDays?: number;
  };
}

export const STORE_PRODUCTS: readonly StoreProduct[] = [
  {
    id: 'core_cache_s', type: 'consumable', title: '뉴럴 코어 캐시 S',
    description: '오퍼레이터 링크 2회분. 구매한 코어는 만료되지 않습니다.',
    displayPriceKrw: 3_900,
    skus: { google: 'neo_core_cache_s', apple: 'neo_core_cache_s', steam: '1001' },
    grant: { resources: { cores: 10 } },
  },
  {
    id: 'founder_supply', type: 'non_consumable', title: '생존자 창립 보급',
    description: '계정당 1회. 코어 15, 데이터 100, 고철 500과 창립자 식별자를 지급합니다.',
    displayPriceKrw: 8_900, badge: 'BEST START',
    skus: { google: 'neo_founder_supply', apple: 'neo_founder_supply', steam: '1002' },
    grant: { resources: { cores: 15, data: 100, scrap: 500 }, entitlements: ['founder_badge'] },
  },
  {
    id: 'neural_sync_30d', type: 'subscription', title: '뉴럴 싱크 30일',
    description: '30일간 방치 회수량 1.5배. 시작 보너스로 코어 5와 데이터 50을 지급합니다.',
    displayPriceKrw: 9_900, badge: '30 DAYS',
    skus: { google: 'neo_neural_sync_monthly', apple: 'neo_neural_sync_monthly', steam: '1003' },
    grant: { resources: { cores: 5, data: 50 }, entitlements: ['neural_sync'], subscriptionDays: 30 },
  },
] as const;

export const RECRUIT_ODDS = {
  SSR: 0.04,
  SR: 0.24,
  R: 0.72,
  pityAt: 20,
} as const;

export function getStoreProduct(id: string): StoreProduct | undefined {
  return STORE_PRODUCTS.find((product) => product.id === id);
}

export function isStoreProductId(value: unknown): value is StoreProductId {
  return typeof value === 'string' && (STORE_PRODUCT_IDS as readonly string[]).includes(value);
}
