# TaxiTaShare 디자인 톤앤매너 전환 계획 — Premium Mobility v2

- 기준 문서: `docs/design.md`
- 작성일: 2026-08-23
- 상태: Design 0 재정의 예정
- 제품 요구사항 기준: `docs/prd.md`
- 관련 요구사항: `FR-01~05`, `FR-10~22`, `FR-30~40`, `FR-50~55`, 접근성·위치정보·신뢰성 비기능 요구사항

---

## 1. 전환 목표

TaxiTaShare의 UI를 기존의 Apple-inspired 단일 블루 디자인에서 벗어나 **Premium Mobility**라는 독립적인 디자인 언어로 전환한다.

새 디자인은 딥 포레스트, 쿨 아이보리, 포레스트 에메랄드와 제한적인 세이지 포인트를 사용한다. 전체 화면은 화려함보다 정돈된 정보 구조와 높은 신뢰감을 우선하며 지도, 경로, 시간, 인원, 요금, 정산 결과를 시각적 중심에 둔다.

전환 후 사용자는 다음을 일관되게 경험해야 한다.

- 밝은 쿨 아이보리 canvas와 white surface가 만드는 깨끗한 기본 화면
- 깊은 deep forest surface가 만드는 고급스러운 핵심 강조
- 밝은 앱 그린보다 차분한 forest emerald 중심의 상호작용
- 세이지 포인트를 최소한으로 사용한 브랜드 디테일
- full-pill 남용을 줄인 성숙한 버튼과 카드 형태
- 카드 그림자보다 surface와 hairline으로 만든 정돈된 깊이
- route와 금액을 빠르게 읽을 수 있는 안정적인 정보 위계
- 모바일 우선이면서 desktop에서는 지도와 정보 패널을 병렬 배치하는 구조

---

## 2. 변경 방향 요약

| 영역 | 기존 방향 | 변경 방향 | 우선도 |
|---|---|---|---|
| 브랜드 인상 | Apple-inspired minimal | Premium Mobility. Quiet Luxury | P0 |
| 주요 색상 | Action Blue `#0066cc` | Forest Emerald `#2F6B57` + Deep Forest `#12231D` | P0 |
| 보조 브랜드색 | 없음 | Muted Sage `#879A8C` 제한적 사용 | P1 |
| 기본 배경 | white/parchment | Cool Ivory `#F7F8F5` + white | P0 |
| CTA 형태 | full pill 중심 | 14px radius 중심 | P0 |
| 카드 형태 | flat/hairline | 18~22px radius + hairline + surface contrast | P0 |
| 깊이 | 거의 완전 flat | 기본은 flat. floating layer만 soft shadow | P1 |
| 홈 | white → parchment → dark tile | dark route hero + white recommendation surface | P0 |
| 지도 | 정보 중 하나 | 대표 시각 콘텐츠 | P0 |
| AI 추천 | 기존 blue text 중심 | brand-soft block + 근거 수치 강조 | P1 |
| 정산 | 일반 카드 흐름 | dark result surface + 명확한 금액 hierarchy | P0 |
| 데스크톱 | 모바일 프레임 확대 | map + info 2-column | P1 |

---

## 3. 핵심 디자인 토큰 교체

### P0 Color Tokens

```css
--canvas: #F7F8F5;
--surface: #FFFFFF;
--surface-subtle: #EEF2EF;
--surface-dark: #12231D;
--surface-deep: #0A1511;

--ink: #15201C;
--ink-secondary: #5C6862;
--ink-tertiary: #8B948F;

--brand: #2F6B57;
--brand-strong: #255344;
--brand-soft: #E5EFEA;

--sage-accent: #879A8C;
--sage-soft: #EEF3EF;

--hairline: #DDE4DF;
```

### Semantic Tokens

```css
--success: #187A56;
--success-soft: #E5F2EB;
--warning: #A66A16;
--warning-soft: #FFF4DF;
--danger: #C24752;
--danger-soft: #FCEBED;
```

### 제거 또는 deprecated 처리

- 기존 `--action: #0066cc`
- 기존 `--action-focus`
- 기존 `--action-on-dark`
- taxi yellow 일반 상호작용 token
- mint CTA 및 badge token

한 단계 동안 alias는 유지할 수 있지만 신규 컴포넌트에서는 새 token만 사용한다.

---

## 4. Typography 전환

기존의 Apple식 17px/600 체계를 완전히 복제하지 않고 한국어 서비스에 맞는 위계를 사용한다.

### 목표

- Hero: 34px/700
- Display: 28px/700
- Section: 21px/600
- Body Large: 17px/400
- Body: 16px/400
- Body Strong: 16px/600
- Label: 14px/600
- Caption: 13px/400
- Micro: 12px/500

### 원칙

- 800 이상 사용 금지
- 기본 CTA 16px/600
- 금액은 tabular number 적용
- 긴 장소명과 금액의 line wrapping을 우선 검증
- 모든 텍스트를 무조건 17px로 키우지 않는다.

---

## 5. 형태 전환

기존의 pill 중심 문법을 다음과 같이 변경한다.

### Button

- primary: 48px height. 14px radius
- secondary: 48px height. 14px radius
- destructive: 48px height. 14px radius
- icon: 44px minimum. 12px radius 또는 circular

### Pill 유지 대상

- status badge
- filter chip
- short selector

### Card

- utility: 18px radius
- route hero: 22px radius
- selected card: brand border + brand-soft
- 일반 card shadow 없음

---

## 6. 홈 화면 재설계

### 현재 문제

기존 홈이 작은 카드가 연속되는 구조라면 화면이 SaaS dashboard처럼 보일 가능성이 높다.

### 목표 구성

1. Top Bar
   - 위치
   - 알림
   - 포인트
2. Route Hero
   - dark gradient surface
   - 출발지
   - 도착지
   - 희망 시간
   - 추천 모집 찾기 CTA
3. AI 추천 모집
   - 1~2개 큰 room card
4. 곧 출발하는 모집
5. 포인트 summary
6. 최근 이용

### Route Hero 디자인

- `surface-dark` 기반
- subtle route gradient 허용
- 큰 장식 이미지는 사용하지 않는다.
- 출발/도착 정보와 CTA를 중심으로 한다.
- 세이지 색은 도착 marker 또는 작은 brand detail에만 사용한다.

---

## 7. 모집 카드 재설계

### 카드 정보 순서

`상태 → 경로 → 시간 → 인원/분담금 → AI 추천 사유 → 행동`

### 시각 변경

- shadow 제거
- border 1px
- 18px radius
- padding 20~24px
- route line 적용
- 중요 숫자는 오른쪽 정렬 또는 동일 baseline 정렬
- AI 추천은 별도 브랜드 블록으로 분리

### 금지

- 민트/옐로우/블루 badge 다중 사용
- 불필요한 아이콘 여러 개
- 카드 내부 divider 남발

---

## 8. 지도 중심 화면 전환

대상:

- `/create`
- `/room/[id]`
- `/room/[id]/gathering`

### 모바일

`map → 정보 → CTA`

### 데스크톱

`map 56% / info panel 44%`

### 지도 위 control

- current location
- zoom 또는 recenter
- route summary

floating control에만 제한적인 soft shadow를 허용한다.

---

## 9. 방 만들기 전환

기존 입력 카드 나열 방식을 step flow로 변경한다.

### Step 1. Route

- 출발지
- 도착지
- map

### Step 2. Time & Seats

- 출발 날짜
- 출발 시각
- 2~4명

### Step 3. Approval & Detour

- 자동/수동 승인
- 인접 목적지 허용

### Step 4. Fare Preview

- 예상 거리
- 예상 시간
- 예상 총 요금
- 예상 1인 분담금

### Step 5. Confirm

- 전체 요약
- 노쇼 정책
- 포인트 안내

Desktop에서는 우측에 sticky route summary를 유지한다.

---

## 10. 집결 화면 전환

집결 화면은 일반 상세 페이지와 다르게 live operation 느낌을 준다.

### 구성

- dark time header
- 출발까지 남은 시간
- map
- 참여자 상태 timeline
- 집결 완료
- 이동 시작 CTA

### 참여자 상태

- 확인 전
- 이동 중
- 도착 완료
- 노쇼

상태색보다 아이콘과 텍스트를 우선한다.

---

## 11. 포인트·정산 화면 전환

### 포인트

- fintech dashboard처럼 과도하게 꾸미지 않는다.
- 잔액 1개를 큰 숫자로 보여주고 예치 중과 최근 변동을 보조한다.
- 관리자 지급 포인트라는 성격을 항상 설명한다.

### 정산

화면 우선순위:

1. 실제 총 택시비
2. 내 최종 부담액
3. 예치금
4. 반환/추가 차감
5. 영수증
6. 동의/이의 제기

### 정산 완료

`surface-dark` 결과 카드 또는 full-width result section을 사용한다.

- 핵심 금액
- 완료 상태
- 반환 또는 추가 차감
- 홈으로 이동 CTA

성공색을 전체 배경으로 사용하지 않는다.

---

## 12. Navigation 전환

### Mobile

- top bar: frosted light
- bottom nav: translucent white
- active: brand forest green
- inactive: ink tertiary
- floating center CTA 제거

### Desktop

834px 이상:

- bottom nav 제거
- sidebar 또는 compact top nav 적용
- 사용자 페이지와 관리자 페이지 navigation 구분

---

## 13. 공통 컴포넌트 작업 순서

### Design 0 — Token Reset

대상:

- `app/globals.css`
- `tailwind.config.*`
- theme variables

작업:

- 색상 token 교체
- typography token 교체
- radius scale 교체
- shadow 제한 규칙 추가
- focus ring 정의

### Design 1 — Base Components

대상:

- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/input.tsx`
- `components/status-badge.tsx`
- `components/top-bar.tsx`
- `components/tab-bar.tsx`

작업:

- primary CTA pill 제거
- 14px radius 적용
- selected state 정의
- brand-soft 적용
- semantic status variant 정리

### Design 2 — Home & Room Cards

대상:

- `/home`
- room card
- AI recommendation block

작업:

- dark route hero 도입
- 작은 카드 밀도 축소
- route line 컴포넌트 도입
- 추천 이유 시각 구조 개선

### Design 3 — Create & Room Detail

대상:

- `/create`
- `/room/[id]`
- `/my-rooms`

작업:

- step flow
- mobile map 중심 구조
- desktop 2-column
- sticky action panel

### Design 4 — Gathering & Settlement

대상:

- gathering
- `/points`
- settle
- settle complete

작업:

- live status header
- point summary 정리
- dark settlement result
- 위험 행동 confirm flow

### Design 5 — Admin & Regression

대상:

- `/admin`
- 전체 페이지

작업:

- 관리자 navigation 분리
- 반응형 회귀
- 접근성
- 남은 old token 제거

---

## 14. 구현 스프린트

| Sprint | 범위 | 결과물 |
|---|---|---|
| Design 0 | 토큰 재정의 | Premium palette. typography. radius. focus |
| Design 1 | 공통 UI | Button. Card. Input. Badge. Nav |
| Design 2 | 홈 | Route Hero. 추천 모집. Room Card |
| Design 3 | 생성/방 상세 | Map-first flow. Stepper. Sticky summary |
| Design 4 | 집결/정산 | Live status. Point. Settlement result |
| Design 5 | 관리자/회귀 | Responsive. Accessibility. Token cleanup |

각 sprint는 기능 로직과 독립적으로 배포 가능해야 한다.

---

## 15. 검증 기준

### 자동 검증

- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `pnpm test`
- `pnpm build`

### 스타일 금지 패턴

- page 직접 hex
- yellow/mint legacy token
- 임의 `shadow-lg`, `shadow-xl`
- 모든 button에 `rounded-full`
- 공통 CTA 직접 Tailwind 조합
- 44px 미만 핵심 action

### 시각 검증

- 390×844
- 430×932
- 640px
- 834px
- 1068px
- 1280px 이상

### 상태 검증

- 모집 중
- 출발 임박
- 모집 실패
- 포인트 부족
- AI 추천 없음
- 지도 로딩
- 지도 실패
- 경로 없음
- 정산 대기
- 정산 이의제기
- 정산 완료
- 관리자 지급 실패

---

## 16. 수용 기준

- TaxiTaShare가 Apple 웹사이트의 축소판처럼 보이지 않는다.
- 주요 CTA가 기존 bright blue보다 깊은 forest emerald 계열로 일관된다.
- taxi yellow가 일반 상호작용에서 제거된다.
- full-pill 사용이 filter와 status 중심으로 제한된다.
- 홈에서 route hero가 첫 번째 주요 콘텐츠로 보인다.
- 모집 카드에서 출발지, 도착지, 시간, 인원, 금액을 3초 안에 파악할 수 있다.
- 정산 결과 화면은 다른 일반 화면과 명확히 구분된다.
- 모바일과 desktop이 같은 레이아웃의 단순 확대가 아니다.
- shadow 없이도 대부분의 정보 위계가 성립한다.
- 상태를 색상 없이도 이해할 수 있다.
- 기능 로직. DB. 권한. 포인트 원장 흐름은 디자인 전환 과정에서 변경하지 않는다.

---

## 17. 유지 규칙

1. `docs/prd.md`가 기능 요구사항의 최상위 기준이다.
2. `docs/design.md`가 시각 시스템의 최상위 기준이다.
3. 이 문서는 디자인 적용 순서와 migration 기준을 정의한다.
4. 신규 페이지는 기존 token과 component variant를 먼저 재사용한다.
5. 세이지 색을 추가 CTA 색으로 확대하지 않는다.
6. 새로운 radius를 페이지에서 임의 생성하지 않는다.
7. 새 shadow는 design 문서에 근거가 있을 때만 추가한다.
8. desktop 화면은 모바일 430px 프레임을 그대로 확대하지 않는다.
9. map과 실제 수치 정보가 시각 장식보다 우선한다.
10. 접근성과 정확한 상태 전달이 브랜드 연출보다 우선한다.

---

## 18. 결정 완료 항목

- 메인 interaction color: `#2F6B57`
- dark surface: `#12231D`
- default canvas: `#F7F8F5`
- accent detail: `#879A8C`
- primary button radius: 14px
- utility card radius: 18px
- route hero radius: 22px
- 기본 card shadow: 없음
- floating layer shadow: 제한 허용
- mobile bottom navigation: 유지
- desktop fixed 430px frame: 폐기
- AI 전용 보라색/gradient: 사용하지 않음

---

## 19. 열린 결정

1. 실제 브랜드 로고에서 세이지 포인트를 사용할지 완전 단색 로고로 갈지
2. 지도 제공자를 Kakao 또는 Naver 중 어느 쪽으로 확정할지
3. 지도 marker 디자인을 custom SVG로 통일할지 SDK 기본 marker를 사용할지
4. landing route hero에서 실제 지도 crop을 사용할지 abstract route line을 사용할지
5. Pretendard를 프로젝트에 직접 포함할지 시스템 font stack으로 유지할지

---

## 20. 전환 완료 정의

**TaxiTaShare의 전체 화면이 쿨 아이보리, 딥 포레스트, 포레스트 에메랄드를 중심으로 통일되고 지도·경로·시간·요금이 디자인의 중심에 놓이며 모바일과 데스크톱 각각에 맞는 고급스러운 모빌리티 UI로 동작하면 전환을 완료한 것으로 본다.**
