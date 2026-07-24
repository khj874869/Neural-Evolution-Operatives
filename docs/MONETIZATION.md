# 월 순매출 300만원 실험 계획

이 문서는 목표를 보장하는 사업계획이 아니라, **월 순현금 300만원** 가능성을 데이터로 검증하기 위한 운영 기준입니다. 플랫폼 수수료·세금·환불·서버비는 국가와 계약에 따라 달라지므로, 초기 내부 총결제액 목표는 완충치를 둔 **월 450만원**으로 잡습니다.

## 현재 상품 구조

| 상품 | 가격 예시 | 역할 | 지급 |
|---|---:|---|---|
| 뉴럴 코어 캐시 S | ₩3,900 | 소액 첫 결제 | 코어 10개 |
| 생존자 창립 보급 | ₩8,900 | 계정당 1회 스타터 | 코어 15, 데이터 100, 고철 500, 창립자 배지 |
| 뉴럴 싱크 30일 | ₩9,900 | 반복 매출 | 30일 방치 회수 1.5배, 코어 5, 데이터 50 |

표시 가격은 한국 원화 기준 기획값입니다. 실제 판매 가격과 통화는 각 플랫폼 콘솔에서 확정하고, 클라이언트는 플랫폼 결제창의 현지 가격을 최종값으로 표시해야 합니다.

## 목표 산식

출시월 총결제액 451만 3천원 예시:

- 창립 보급 200건 × ₩8,900 = ₩1,780,000
- 뉴럴 싱크 150건 × ₩9,900 = ₩1,485,000
- 코어 캐시 320건 × ₩3,900 = ₩1,248,000

합계는 ₩4,513,000입니다. 창립 보급은 1회성이므로 안정화월에는 싱크 250건과 코어 캐시 520건처럼 반복 상품 중심으로 같은 총결제액을 만들어야 합니다. 이 수량은 예측이 아니라 필요한 주문량을 역산한 실험 기준입니다.

월 결제자당 평균 결제액을 ₩22,500으로 가정하면 월 결제자 200명이 필요합니다. 월 결제 전환율 3% 가정 시 약 6,700 MAU가 필요합니다. 전환율이나 잔존율이 기준에 못 미치면 광고비를 늘리지 말고 콘텐츠와 온보딩부터 개선합니다.

## 소프트런치 KPI 게이트

아래 수치는 내부 목표이며 시장 성과를 주장하는 값이 아닙니다.

| 퍼널 | 1차 통과 목표 |
|---|---:|
| 튜토리얼 완료율 | 70% 이상 |
| OPERATION ZERO 완료율 | 35% 이상 |
| D1 잔존율 | 25% 이상 |
| D7 잔존율 | 8% 이상 |
| 일일 계약 보드 방문률 | DAU의 35% 이상 |
| 노출 계약 보상 수령률 | 20% 이상 |
| 월간 보급소 방문율 | 15% 이상 |
| 월 결제 전환율 | 2~4% |
| 월 ARPPU | ₩15,000~₩30,000 |

현재 서버는 `session_start`, `tutorial_complete`, `operation_complete`, `contract_view`, `contract_claim`, `store_view`, `checkout_intent`, `purchase_complete`를 `analytics_events`에 기록합니다.

```sql
SELECT
  date_trunc('month', created_at) AS month,
  COUNT(DISTINCT player_id) FILTER (WHERE event_name = 'session_start') AS active_players,
  COUNT(DISTINCT player_id) FILTER (WHERE event_name = 'operation_complete') AS operation_finishers,
  COUNT(DISTINCT player_id) FILTER (WHERE event_name = 'contract_view') AS contract_viewers,
  COUNT(DISTINCT player_id) FILTER (WHERE event_name = 'contract_claim') AS contract_claimers,
  COUNT(DISTINCT player_id) FILTER (WHERE event_name = 'store_view') AS store_viewers,
  COUNT(DISTINCT player_id) FILTER (WHERE event_name = 'purchase_complete') AS payers,
  SUM((properties->>'amountMinor')::bigint) FILTER (
    WHERE event_name = 'purchase_complete' AND properties->>'currency' = 'KRW'
  ) AS verified_krw_gross
FROM analytics_events
GROUP BY 1
ORDER BY 1 DESC;
```

## 결제 안전 설계

- 클라이언트는 플랫폼 영수증만 서버로 전달하며 재화를 직접 지급하지 않습니다.
- 서버가 상품·플랫폼·거래 ID를 검증한 후 PostgreSQL 트랜잭션에서 지급합니다.
- `(platform, transaction_id)`는 전 계정에서 유일합니다. 같은 계정 재시도는 기존 결과를 반환하고, 다른 계정의 영수증 복제는 차단합니다.
- 실결제 검증 어댑터가 구성되지 않은 환경은 `503 PLATFORM_BILLING_NOT_CONFIGURED`로 닫혀 있습니다.
- 환불·취소·차지백은 플랫폼별 일일 대사 작업으로 회수 또는 이용 권한 중지를 처리해야 합니다.

Google Play의 디지털 상품은 Play 결제 시스템을 사용하고 확률형 상품의 확률을 구매 지점 가까이에 공개해야 합니다. Apple도 앱 내 디지털 기능에는 IAP를 요구하며 확률형 아이템의 확률 공개와 복원 가능한 구매의 복원 수단을 요구합니다. Steam은 서버에서 `InitTxn`/`FinalizeTxn`을 처리하고 성공 확정 후에만 지급하며 정기적으로 거래를 대사하는 방식을 권장합니다.

- [Google Play Payments 정책](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Steam Microtransactions 구현 가이드](https://partner.steamgames.com/doc/features/microtransactions/implementation)

## 출시 전에 반드시 연결할 것

1. Google Play Billing, StoreKit 2, Steam MicroTxn 각각의 네이티브 결제 브리지
2. 플랫폼 서버 API를 호출하는 영수증 검증 어댑터와 비밀키 보관
3. 구독 갱신·취소·환불·차지백 웹훅 및 일일 대사 작업
4. 구매 복원과 게스트 계정 이전 UI
5. 개인정보처리방침, 이용약관, 고객지원, 환불 안내, 연령 등급
6. 네이티브 브리지의 `getProducts()`로 플랫폼 콘솔의 실제 현지 가격을 주입하고 `restorePurchases()`로 구매를 복원하는 기능

## 지키는 선

- 캐릭터 기억을 인질로 삼아 결제를 강요하지 않습니다.
- 애정·집착 표현을 결제 압박이나 미성년자 타기팅에 사용하지 않습니다.
- 무료 플레이어도 OPERATION ZERO와 기본 관계 성장을 끝까지 경험할 수 있게 유지합니다.
- 전투력 판매보다 편의·수집·외형 중심으로 운영하며 PvP 우위를 판매하지 않습니다.
- v1.3 비공개 알파에서는 딥 토크·기억·안전 기능과 계약 새로고침을 과금 등급으로 나누지 않고 호출 비용·만족도·자연 잔존율부터 측정합니다.
