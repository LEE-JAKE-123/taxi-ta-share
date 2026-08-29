# TaxiTaShare 디자인 톤앤매너 전환 계획 — Quiet Precision v3

- 기준 문서: `docs/design.md` v3.0
- 갱신일: 2026-08-28
- 제품 요구사항 기준: `docs/prd.md`
- 관련 요구사항: `FR-01~05`, `FR-10~22`, `FR-30~40`, `FR-50~55`, 접근성·위치정보·신뢰성 비기능 요구사항

## 1. 목표와 범위

기존의 Apple-inspired 단일 블루 문법을 Quiet Precision 시각 언어로 전환한다. 순수 흰색 캔버스, 딥 포레스트, 포레스트 에메랄드, 제한적인 세이지 포인트를 사용하고 지도·경로·시간·인원·요금·정산 결과가 디자인의 중심이 되게 한다. v3에서는 카드·CTA 표면 문법뿐 아니라 화면별 주 행동과 숫자·상태의 읽기 순서를 함께 정리한다.

이 작업은 UI 표현과 공통 컴포넌트의 변경이다. 모집/참여 상태 전이, 권한, 포인트 원장, 정산 계산, 지도·AI 추천의 근거와 서버 검증은 변경하지 않는다.

| 영역 | 새 기준 | 우선도 |
|---|---|---|
| 주요 색상 | `#2F6B57` Forest Emerald, `#12231D` Deep Forest | P0 |
| 기본 면 | `#FFFFFF` canvas + white surface | P0 |
| CTA | 48px 높이, 14px radius, brand 색 | P0 |
| 카드 | 18~22px radius, hairline, 기본 shadow 없음 | P0 |
| 홈 | dark route hero + 추천 모집 + 포인트 요약 | P0 |
| 지도 | 대표 시각 콘텐츠, 모바일 map-first | P0 |
| AI 추천 | brand-soft 정보 블록과 계산 근거 | P1 |
| 데스크톱 | 지도와 정보 패널 2열 구성 | P1 |
| 정보 위계 | 금액·상태·경로의 label/value pairing과 numeric 정렬 | P0 |
| 상호작용 | 짧고 절제된 feedback, reduced-motion 대응 | P1 |

기존 `--action: #0066cc`, `--action-focus`, `--action-on-dark`, 택시 옐로우·민트 CTA/배지 토큰은 deprecated로 처리한다. 짧은 호환 기간 alias는 허용하되 신규 화면·컴포넌트는 새 토큰만 사용한다.

## 2. 적용 원칙

1. `docs/prd.md`의 기능·안전·금액 요구사항이 시각적 모사보다 우선한다.
2. `docs/design.md`의 토큰과 variant를 재사용하며 페이지별 임의 색상, radius, shadow를 추가하지 않는다.
3. full pill은 상태 배지·필터 칩·짧은 선택자에만 남기고 CTA는 14px radius로 통일한다.
4. 기본 깊이는 surface 차이와 hairline으로 만들며 floating layer에만 soft shadow를 허용한다.
5. 지도와 실제 경로·금액 수치가 장식·AI 마케팅 표현보다 먼저 읽혀야 한다.
6. 상태는 텍스트와 색상을 함께 제공하고, 모바일 한 손 조작·키보드·포커스·44px 터치 영역을 보장한다.
7. 834px 이상에서는 모바일 프레임을 확대하지 않고 정보와 지도를 병렬 배치한다.

## 3. 작업 순서

### Design 0 — Token Reset

대상: `app/globals.css`, theme variables, Tailwind 토큰. Premium palette, typography, radius, focus ring을 정의하고 blue/yellow/mint legacy 토큰과 기본 card shadow를 정리한다.

### Design 1 — Base Components

대상: Button, Card, Input, StatusBadge, TopBar, BottomNavigation. CTA 14px radius, selected/dark/brand-soft/semantic variant, navigation의 focus 상태를 통일한다.

### Design 2 — Home & Room Cards

대상: `/home`, 모집 카드, AI recommendation block. dark route hero와 route line을 도입하고 비용·인원 정보 위계와 추천 근거를 개선한다. 카드 색상 변주나 그림자 대신 상태→경로→시간→인원/금액 순서를 고정한다.

### Design 3 — Create & Room Detail

대상: `/create`, `/room/[id]`, `/my-rooms`. step flow, map-first 모바일 구조, desktop 2-column, sticky action/summary와 grouped list를 적용한다. 한 section은 한 결정만 다루도록 label·value·help·action을 묶는다.

### Design 4 — Gathering & Settlement

대상: gathering, `/points`, settlement. live status header, point summary, dark settlement result와 위험 행동 확인 흐름을 적용한다. 사용 가능/예치/정산 중 금액을 명확히 구분하고 금액 기준과 분모를 가까이 둔다.

### Design 5 — Admin & Regression

대상: `/admin`, 전체 화면. 관리자 navigation 분리, 반응형·접근성 회귀, deprecated 토큰 제거를 수행한다.

각 단계는 기능 로직 변경 없이 독립적으로 검증·배포 가능해야 한다.

## 4. 검증과 수용 기준

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

390×844, 430×932, 640, 834, 1068, 1280px 이상에서 시각 검증한다. 모집 중·출발 임박·모집 실패, 포인트 부족, AI 추천 없음, 지도 로딩/실패/경로 없음, 정산 대기/이의제기/완료, 관리자 지급 실패 상태를 함께 점검한다.

- CTA가 forest emerald 계열로 일관되고 taxi yellow와 bright blue가 일반 상호작용에서 제거된다.
- full-pill은 필터·상태 중심으로 제한되고 shadow 없이도 정보 위계가 성립한다.
- 홈의 route hero와 모집 카드의 출발지·도착지·시간·인원·금액을 빠르게 파악할 수 있다.
- 정산 결과가 일반 화면과 구분되고 상태를 색상 없이도 이해할 수 있다.
- 200% 확대, `prefers-reduced-motion`, 지도 loading/error/no-route에서도 정보와 CTA의 의미가 유지된다.
- 모바일과 데스크톱이 단순 확대가 아니며 기능·DB·권한·포인트 원장 흐름은 바뀌지 않는다.

## 5. 유지 규칙과 열린 결정

- 세이지는 추가 CTA 색으로 확장하지 않는다. 새 radius와 shadow는 `docs/design.md`에 근거가 있을 때만 추가한다.
- 신규 페이지는 공통 토큰과 component variant를 먼저 사용한다.
- 브랜드 로고의 세이지 포인트 사용 여부, 지도 제공자·marker 방식, 랜딩 route hero의 지도 crop/abstract route, Pretendard 직접 포함 여부는 별도 결정이 필요하다.

**전체 화면이 순수 흰색 캔버스, 딥 포레스트, 포레스트 에메랄드 중심으로 통일되고 지도·경로·시간·요금이 디자인의 중심에 놓이며, 모바일과 데스크톱 각각에 맞는 프리미엄 모빌리티 UI로 동작하면 전환을 완료한 것으로 본다.**
