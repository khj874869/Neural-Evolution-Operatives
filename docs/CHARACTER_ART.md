# 오퍼레이터 캐릭터 아트 가이드

게임에 구현된 7명의 오퍼레이터는 하나의 포스트 아포칼립스 세계관과 모바일 수집형 RPG의 가독성을 공유하되, 실루엣·색·장비로 역할을 즉시 구별하도록 설계했습니다. 배포용 이미지는 `public/assets/operators`에 WebP로 저장됩니다.

## 공통 생성 프롬프트

```text
Use case: stylized-concept
Asset type: individual operator character card art for a PC/mobile post-apocalyptic sci-fi gacha survival shooter
Style/medium: premium Korean/Japanese mobile game key art, polished semi-realistic anime illustration, crisp painterly rendering, grounded tactical sci-fi, production-ready concept art
Composition/framing: vertical 4:5 character card, one single adult character only, full body visible, centered heroic three-quarter pose, clear face and silhouette, generous edge padding
Scene/backdrop: ruined near-future city and underground shelter atmosphere, subtle environmental storytelling, softly defocused so the character remains dominant
Lighting/mood: cinematic rim lighting, dramatic but readable, tragic post-apocalyptic hope
Shared world palette: charcoal, oxidized metal, muted military fabric, selective neon neural-link accents
Constraints: clearly adult character; practical layered tactical clothing and armor; nonsexual presentation; anatomically coherent hands and weapons; no real brands
Avoid: any text, letters, UI, logo, watermark, border, duplicate person, extra limbs, cropped feet, chibi proportions, school uniform, excessive exposed skin
```

## 캐릭터별 프롬프트 지시

| 파일 | 캐릭터 | 핵심 지시 |
|---|---|---|
| `aegis-07.webp` | 세라 / AEGIS-07 | 성인 여성 구세대 호위 안드로이드, 은회색 단발과 긴 옆머리, 호박색 눈, 아이보리·흑연 장갑 코트, 왼팔 방패 투사기, 카빈, 금빛 코어 |
| `morrow.webp` | 모로 / MORROW | 성인 여성 기록 보존 안드로이드, 긴 남색 머리, 푸른 눈, 정찰 코트, 정밀 소총, 기억 캡슐, 해질녘 폐영화관 |
| `ratchet.webp` | 래칫 / RATCHET | 성인 여성 스캐빈저 정비사, 구리색 헝클어진 머리와 고글, 올리브색 작업복, 공구 하네스, 수리 드론, 코일 무기, 폐공장 |
| `ember.webp` | 엠버 / EMBER-3 | 성인 여성 화재 진압 안드로이드, 주황색 언더컷, 검정·적색 내열 돌격 장갑, 브리칭 무기, 열 방패, 불꽃과 잔해 |
| `lumen.webp` | 루멘 / LUMEN | 성인 여성 의료 바이오로이드, 민트빛 백발, 청록색 눈, 흰색·청록색 의료 전투복, 진단 드론, 작은 식물, 지하철 진료소 |
| `rook.webp` | 룩 / R-11 | 성인 남성형 보안 안드로이드, 짧은 흑발과 기계 관자놀이, 흑연색 진압 장갑, 대형 방탄 방패, 쉘터 방어문 |
| `patch.webp` | 패치 / PATCH | 성인 여성 응급 처치 오퍼레이터, 자주색 단발, 회색·보라색 패치워크 의료복, 구급 배낭, 관절형 의료 드론 팔, 야전병원 |

이미지는 내장 이미지 생성 모델로 제작한 뒤, 클라이언트 전송량을 줄이기 위해 최대 폭 720px의 WebP로 변환했습니다. 텍스트와 등급·역할 UI는 이미지에 굽지 않고 게임 UI가 별도로 렌더링합니다.
