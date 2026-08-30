# TaxiTaShare Design System Operations — Foundations v1

- 기준 문서: `docs/design.md` v3.1
- 구현 토큰: `app/globals.css`
- 적용 범위: 사용자·관리자 전체 화면
- 관련 제품 요구사항: `FR-01~05`, `FR-10~22`, `FR-30~40`, `FR-50~55` 및 접근성 요구사항

이 문서는 `docs/design.md`의 Quiet Precision을 화면에서 반복 가능하게 만드는 상세 계약이다. 새 UI는 아래 Foundations, Components, Patterns, Assets, Content 순서로 검토한다. 화면별 새 색상, radius, 그림자, 버튼 문법을 추가하는 것은 허용하지 않는다.

## 1. Foundations

### 1.1 토큰 계층

토큰은 raw value를 직접 화면에 쓰지 않고 아래 두 계층으로 사용한다.

1. **Scale token**: 색상값, 간격, radius, 시간처럼 값의 범위를 제한한다.
2. **Semantic token**: 값 대신 의도를 나타낸다. 화면과 공통 컴포넌트는 semantic token을 우선 사용한다.

현재 `app/globals.css`의 다음 변수는 이 시스템의 canonical scale이다. 컴포넌트와 페이지에서 hex 값을 직접 쓰지 않는다.

| 역할 | 구현 변수 | 사용 |
|---|---|---|
| 기본 캔버스/표면 | `--canvas`, `--surface`, `--surface-subtle` | 페이지, 카드, 비활성·보조 영역 |
| 어두운 계층 | `--surface-dark`, `--surface-deep` | route hero, 완료 정산 결과, 제한적 overlay |
| 텍스트 | `--ink`, `--ink-secondary`, `--ink-tertiary` | 본문, 보조 설명, placeholder |
| 주요 행동 | `--brand`, `--brand-strong`, `--brand-soft` | CTA, 선택, 추천 근거 |
| 상태 | `--success`, `--warning`, `--danger`, `--info` 및 soft pair | 완료, 확인 필요, 위험, 안내 |
| 구분 | `--hairline` | surface와 섹션 경계 |

다음 semantic role은 문서·디자인 검토에서 사용한다. 코드 alias가 아직 없으면 추가 전 영향 화면을 확인하고 `globals.css`에 함께 정의한다.

| Semantic role | 기본 값의 출처 | 금지 |
|---|---|---|
| `action.primary.*` | brand / brand-strong / white | bright blue, taxi yellow CTA |
| `action.danger.*` | danger / white | 위험 행동을 brand CTA처럼 보이게 처리 |
| `surface.default/subtle/dark` | surface 계열 | 일반 카드의 gradient·shadow |
| `content.primary/secondary/tertiary` | ink 계열 | 낮은 대비의 본문 |
| `status.success/warning/danger/info` | 각 semantic pair | 색상만으로 상태 전달 |
| `route.origin/destination/ribbon` | brand / sage / 실제 경로 데이터 | 가짜 지도·추정 경로 이미지 |

### 1.2 Typography, spacing, shape, elevation, motion

| 역할 | 규칙 |
|---|---|
| Screen title | 24/32px 700. 모바일의 hero만 32/40px 700 허용 |
| Section title | 18/26px 600 |
| Body | 16px 400. 긴 설명은 line-height를 줄이지 않음 |
| Label / caption / micro | 14px 600 / 13px 400 / 12px 500 |
| Amount | tabular numbers, 600. 최종 정산 결과만 700 허용 |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 40, 56, 72px 스케일만 사용 |
| Radius | control 14px, compact content 12px, card 18px, hero 22px. full pill은 filter·status·선택 칩만 허용 |
| Elevation | hairline과 surface 차이를 기본으로 한다. modal, bottom bar, 지도 floating control만 soft shadow 허용 |
| Motion | 기능 피드백은 150ms, 상태 전환은 150~200ms. pressed scale은 primary control에만 `.98` 허용 |

`prefers-reduced-motion`에서는 transform, smooth scroll, 반복 animation을 제거한다. 모션은 대기 시간을 숨기거나 금액 변화를 과장하는 수단으로 사용하지 않는다.

### 1.3 접근성 기준

- 조작 가능한 모든 대상은 최소 44×44px이다.
- focus ring을 제거하지 않는다. 색상만으로 선택·위험·완료를 전달하지 않는다.
- 200% 확대에서 금액, CTA, 정산 기준이 겹치거나 잘리지 않아야 한다.
- 지도 SDK를 조작하지 않아도 출발지·도착지·거리·시간·경로 상태를 읽을 수 있어야 한다.
- `loading`, `empty`, `error`, `disabled`, `success`, `retry`를 각 패턴에서 명시한다.

## 2. Components

화면은 아래 공통 컴포넌트와 허용된 variant를 먼저 사용한다. 새 variant가 필요한 경우 문서와 구현을 같은 변경에서 갱신한다.

| Component | 허용 variant / 상태 | 사용 규칙 |
|---|---|---|
| Button | primary, secondary, ghost, destructive, dark; disabled, busy | 주 행동은 하나만. destructive는 원복하기 어려운 조치에만 사용 |
| Card | surface, subtle, selected, dark, interactive | 기본은 hairline + shadow 없음. 정보 구조를 카드 중첩으로 만들지 않음 |
| Input | default, search, location, error; focus, invalid, disabled | label, 도움말, 오류 메시지의 연결을 유지 |
| StatusBadge | neutral, brand, success, warning, danger | 상태명 텍스트를 항상 포함. full pill은 이 컴포넌트에 한정 |
| TopBar / BottomBar / TabBar | default, compact, action | navigation과 주요 행동의 책임을 섞지 않음 |
| RouteMap | loading, ready, no-route, error, no-key | 실제 제공자 데이터와 문장형 대체 정보를 함께 제공 |

## 3. Patterns

### 3.1 모집 카드와 추천

정보는 `상태 → 출발·도착 → 시각 → 인원·1인 예상 부담 → 추천/우회 근거 → CTA` 순서로 배치한다. 출발지는 brand dot, 도착지는 porcelain/sage ring, 경로는 하나의 route ribbon으로 표현한다. AI 추천은 별도 브랜드 효과가 아니라 계산 근거를 담는 brand-soft 정보 블록이다.

### 3.2 장소 검색과 경로

- 검색 중: 입력값을 유지하고 짧은 진행 피드백을 보인다.
- 결과 없음: 장소를 찾지 못했음을 명시하고 검색어 수정 행동을 안내한다.
- 경로 로딩: 지도와 거리·시간·요금 위치를 skeleton 또는 progress로 보존한다.
- no-route / provider error / no-key: 추정값을 만들지 않는다. 원인, 재시도, 가능한 대체 행동을 보인다.

### 3.3 방 생성과 상세

생성은 `Route → Time & Seats → Approval & Detour → Fare Preview → Confirm` 흐름을 유지한다. 상세는 모바일에서 `map → route → fare → participants → policy → CTA`, 데스크톱에서 지도와 상세 정보의 2열 구조를 사용한다.

### 3.4 집결과 정산

집결은 출발 시각, 참여자 상태, 체크인, 이동 시작 행동을 시간 순서로 보인다. 정산은 `실제 총요금 → 인원별 결과 → 예치금 → 반환/추가 차감 → 확정 시각·상태 → 동의/이의제기` 순서로 보인다. 금액에는 항상 기준, 인원, 상태를 가까이 둔다.

### 3.5 관리자 위험 조치

관리자 화면은 사용자 화면보다 정보 밀도가 높을 수 있으나 같은 token과 상태 문법을 사용한다. 위험도와 조치 가능 여부는 텍스트·아이콘·색을 함께 사용하고, 근거·조치·감사 기록을 별도 블록으로 분리한다.

### 3.6 Loading 선택 기준

| 상황 | 기본 표현 |
|---|---|
| 1초 미만 예상 | 별도 전체 화면 로딩 없음 |
| 폼 제출·상태 전환 | 해당 버튼 busy + 짧은 상태 문구 |
| 목록·지도·정산 요약 로딩 | 실제 콘텐츠 구조를 닮은 skeleton |
| 진행률을 알 수 있는 오래 걸리는 작업 | progress bar와 진행 설명 |
| 실패 | 보존 가능한 입력/기존 데이터 + 재시도 행동 |

## 4. Assets

에셋은 제품 판단을 돕는 역할만 가진다. 장식용 이미지를 기본 UI에 추가하지 않는다.

| Asset type | 기준 | 관리 원칙 |
|---|---|---|
| Brand mark | TaxiTaShare 식별 | 원본과 웹용 최적화 SVG/PNG를 구분하고 safe area·사용 크기 문서화 |
| Functional icon | Lucide 우선 | 크기, stroke, semantic color만 변경. 3D·emoji·혼합 icon set 금지 |
| Route/map | 실제 제공자 지도·실제 경로 | provider attribution과 오류 상태를 보존. 가짜 지도 이미지 금지 |
| Empty/error visual | 단색 선형 아이콘 또는 간단한 SVG | 상태 설명과 재시도 행동을 대체하지 않음 |
| Placeholder | 개발용임을 명시 | production 화면의 영구 에셋으로 사용하지 않음 |

새 브랜드 에셋은 출처, 라이선스, 원본 경로, 웹 배포 형식, dark/light 필요 여부를 기록한다. 실제 사용자·장소·경로·금액 데이터를 연상시키는 AI 생성 이미지는 사용하지 않는다.

## 5. Content

문체는 **명확한, 이해하기 쉬운, 사려 깊은** 순서다. 친근한 표현은 허용하되, 금액·제재·정산에서는 안전과 신뢰가 먼저다.

- 익숙한 단어와 아라비아 숫자를 사용한다. 내부 상태명, 약어, 기술 오류를 사용자에게 노출하지 않는다.
- 오류는 `무엇이 문제인지 → 사용자가 할 수 있는 행동 → 재시도/문의` 순서로 쓴다.
- 위험·제재는 낙인찍는 표현 대신 사실, 영향, 다음 절차를 분리해 쓴다.
- 금액은 `12,500P` 형식과 tabular figures를 사용하고, 예상/예치/최종/반환/추가 차감을 혼동하지 않게 label을 붙인다.
- CTA는 기능명이 아니라 결과를 표현한다. 예: “정산에 동의하기”, “이의제기 제출하기”.

## 6. Governance

### 6.1 변경 절차

1. 관련 `FR`/`TR`, 사용자 흐름, 서버 상태를 확인한다.
2. 기존 token, component, pattern으로 해결 가능한지 먼저 확인한다.
3. 새 token·variant·asset이 꼭 필요하면 이름, 역할, 허용/금지 사례, 영향 화면을 문서화한다.
4. `app/globals.css`, 공통 컴포넌트, 화면, 문서를 같은 변경 단위로 갱신한다.
5. 아래 검수 기준과 회귀 화면을 확인하고 변경 로그에 남긴다.

### 6.2 리뷰 체크리스트

- [ ] 직접 hex, 새 radius, 새 shadow, 임의 gradient를 추가하지 않았는가?
- [ ] 기존 Button/Card/Input/StatusBadge/RouteMap으로 조립했는가?
- [ ] loading, empty, error, disabled, success, retry가 보이는가?
- [ ] 상태가 색만으로 전달되지 않는가?
- [ ] 금액의 기준·인원·상태·확정 시각이 가까이 있는가?
- [ ] 390, 430, 834, 1280px와 200% 확대에서 읽히는가?
- [ ] keyboard focus와 reduced motion을 보장하는가?
- [ ] 지도·AI·정산의 근거 없는 장식 또는 추정값이 없는가?

### 6.3 변경 로그

| 날짜 | 변경 | 영향 범위 | 상태 |
|---|---|---|---|
| 2026-08-30 | Foundations v1 운영 계약 추가 | 전체 UI, 이후 화면 전환 | 완료 |
