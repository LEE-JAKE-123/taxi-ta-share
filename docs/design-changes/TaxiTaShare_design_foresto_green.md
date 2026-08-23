# TaxiTaShare Design System — Premium Mobility

- 문서 버전: v1.0
- 작성일: 2026-08-23
- 적용 대상: TaxiTaShare 전체 사용자 화면 및 관리자 화면
- 제품 기준 문서: `docs/prd.md`
- 목적: TaxiTaShare만의 고급스럽고 세련된 프리미엄 모빌리티 디자인 언어 정의

---

## 1. 디자인 방향

TaxiTaShare의 시각 언어는 **Premium Mobility, Calm Confidence, Clear Route**를 핵심으로 한다.

사용자가 앱을 열었을 때 택시 서비스 특유의 가벼운 노란색 이미지보다 신뢰도 높은 이동 서비스와 정돈된 금융·정산 경험을 먼저 느끼게 한다. 화면은 화려한 장식보다 출발지, 도착지, 시간, 인원, 예상 요금, 정산 상태가 주인공이 되도록 구성한다.

### 핵심 인상

- 대학생 서비스지만 가볍거나 장난스럽지 않다.
- 교통·위치·정산 정보를 다루는 서비스답게 신뢰감이 있다.
- 화면의 여백과 정렬이 넉넉해 복잡한 정보도 차분하게 읽힌다.
- 핵심 CTA는 분명하지만 과도하게 튀지 않는다.
- 지도와 경로 정보가 서비스의 대표 비주얼 역할을 한다.
- 초록 계열을 중심으로 하되 밝고 캐주얼한 그린보다 깊고 차분한 포레스트 에메랄드 톤을 사용한다.
- 세이지 그린은 브랜드 장식과 특별한 하이라이트에만 제한적으로 사용한다.

### 디자인 키워드

`Deep Forest` · `Porcelain` · `Forest Emerald` · `Muted Sage` · `Glass` · `Route-first` · `Quiet Luxury`

---

## 2. 시각 언어 원칙

### 2.1 정보가 장식보다 우선한다

TaxiTaShare의 핵심 콘텐츠는 이미지가 아니라 이동 정보다.

다음 정보는 항상 시각적 우선순위를 가진다.

1. 출발지와 도착지
2. 출발 시각과 남은 시간
3. 현재 인원과 최대 인원
4. 예상 총 요금과 1인 예상 분담금
5. 모집 상태와 다음 행동
6. AI 추천 근거

### 2.2 모든 요소를 pill로 만들지 않는다

과도한 pill UI는 캐주얼한 느낌을 만들 수 있으므로 TaxiTaShare에서는 용도에 따라 형태를 구분한다.

- Primary CTA: 14px radius
- Secondary CTA: 14px radius
- Search: 16px radius
- Filter chip: pill
- Status badge: pill
- Utility icon button: 12px radius 또는 원형
- Card: 18~22px radius

### 2.3 깊이는 그림자보다 면과 테두리로 만든다

기본 카드에는 강한 그림자를 사용하지 않는다.

- 기본 카드: surface 차이 + 1px hairline
- 선택된 카드: brand-soft 배경 + brand border
- floating bottom sheet 또는 지도 위 컨트롤: 제한적인 soft shadow 허용
- sticky navigation: translucent glass + hairline

### 2.4 숫자는 시각적으로 안정적으로 정렬한다

요금, 포인트, 시간, 거리에는 `font-variant-numeric: tabular-nums`를 적용한다.

숫자를 과도하게 굵게 만들지 않는다. 중요한 결과만 700을 허용하며 일반 금액 정보는 600으로 유지한다.

---

## 3. 컬러 시스템

### 3.1 Core Palette

| Token | Hex | 용도 |
|---|---:|---|
| `--canvas` | `#F7F8F5` | 전체 기본 배경. 차갑지 않은 쿨 아이보리 |
| `--surface` | `#FFFFFF` | 기본 카드와 입력 영역 |
| `--surface-subtle` | `#EEF2EF` | 보조 섹션과 비활성 영역 |
| `--surface-dark` | `#12231D` | 핵심 강조 섹션. 정산 완료. 프리미엄 정보 패널 |
| `--surface-deep` | `#0A1511` | 지도 오버레이. 아주 제한적인 딥 섹션 |
| `--ink` | `#15201C` | 기본 제목과 본문 |
| `--ink-secondary` | `#5C6862` | 보조 설명 |
| `--ink-tertiary` | `#8B948F` | placeholder와 비활성 텍스트 |
| `--brand` | `#2F6B57` | 핵심 상호작용. 선택. 링크. CTA |
| `--brand-strong` | `#255344` | pressed 또는 강조 상태 |
| `--brand-soft` | `#E5EFEA` | 선택 영역 배경. AI 추천 강조 |
| `--sage-accent` | `#879A8C` | 브랜드 장식. 프리미엄 포인트. 제한적 사용 |
| `--sage-soft` | `#EEF3EF` | 특별 안내와 브랜드성 보조 배경 |
| `--hairline` | `#DDE4DF` | 카드와 섹션 경계 |
| `--glass-light` | `rgba(255,255,255,0.78)` | frosted navigation |
| `--glass-dark` | `rgba(18,35,29,0.82)` | dark overlay |

### 3.2 Semantic Colors

| Token | Hex | 용도 |
|---|---:|---|
| `--success` | `#187A56` | 완료. 확인. 정상 정산 |
| `--success-soft` | `#E5F2EB` | 성공 배경 |
| `--warning` | `#A66A16` | 출발 임박. 확인 필요 |
| `--warning-soft` | `#FFF4DF` | 경고 배경 |
| `--danger` | `#C24752` | 취소. 오류. 위험 행동 |
| `--danger-soft` | `#FCEBED` | 오류 배경 |
| `--info` | `#3E7867` | 일반 안내. 경로 보조 정보 |
| `--info-soft` | `#E8F1ED` | 안내 배경 |

### 3.3 컬러 사용 규칙

- 일반 CTA와 링크는 `--brand`를 사용한다.
- `--sage-accent`는 클릭 가능한 요소의 기본 색으로 사용하지 않는다.
- 세이지 컬러는 로고 디테일, VIP처럼 보이는 장식이 아니라 브랜드 하이라이트와 추천 마커 정도에만 사용한다.
- semantic 색상은 상태 전달에만 사용한다.
- 한 화면에서 강한 색상은 최대 두 계열까지만 동시에 사용한다.
- `--surface-dark` 위 본문은 `#F7FAF8`, 보조 텍스트는 `#AAB8B0`을 사용한다.
- 직접 hex를 컴포넌트에 작성하지 않고 의미 토큰을 사용한다.

### 3.4 금지 색상

- 택시 옐로우를 주요 CTA로 사용하지 않는다.
- 형광 민트와 형광 블루를 사용하지 않는다.
- 동일 화면에서 보라, 핑크, 민트 등의 서브 액센트를 추가하지 않는다.
- 의미 없는 무지개 gradient를 사용하지 않는다.

---

## 4. Gradient 사용 규칙

TaxiTaShare는 gradient를 완전히 금지하지 않는다. 다만 배경 장식으로 반복 사용하지 않는다.

허용 범위는 다음과 같다.

### `brand-route-gradient`

```css
linear-gradient(135deg, #12231D 0%, #163428 55%, #285A45 100%)
```

사용 위치:

- 홈 상단의 route hero
- 정산 완료 핵심 결과 면
- 로그인 또는 랜딩 화면의 제한된 브랜드 영역

금지 위치:

- 모든 카드 배경
- 일반 버튼
- 필터 chip
- 리스트 행
- 상태 badge

---

## 5. Typography

### 5.1 Font Stack

한국어 UI에서는 다음 우선순위를 사용한다.

```css
font-family:
  "Pretendard Variable",
  Pretendard,
  Inter,
  "Noto Sans KR",
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  sans-serif;
```

Pretendard를 프로젝트에 포함하지 않는 환경에서는 시스템 글꼴을 사용한다.

### 5.2 Type Scale

| Token | Mobile | Desktop | Weight | Line Height | Use |
|---|---:|---:|---:|---:|---|
| `hero` | 34px | 46px | 700 | 1.12 | 랜딩 핵심 문구 |
| `display` | 28px | 36px | 700 | 1.18 | 페이지 핵심 제목 |
| `title-lg` | 24px | 28px | 700 | 1.22 | 주요 정보 결과 |
| `section` | 21px | 24px | 600 | 1.28 | 섹션 제목 |
| `body-lg` | 17px | 17px | 400 | 1.5 | 설명이 긴 본문 |
| `body` | 16px | 16px | 400 | 1.5 | 기본 UI 본문 |
| `body-strong` | 16px | 16px | 600 | 1.4 | 중요 본문 |
| `label` | 14px | 14px | 600 | 1.35 | 필드명. 버튼 보조 |
| `caption` | 13px | 13px | 400 | 1.4 | 보조 설명 |
| `micro` | 12px | 12px | 500 | 1.35 | 상태 보조. 법적 문구 |

### 5.3 Typography Rules

- 헤드라인은 `letter-spacing: -0.02em`을 기본으로 한다.
- 본문은 `letter-spacing: -0.01em`을 기본으로 한다.
- 기본 UI에서 800 이상 굵기를 사용하지 않는다.
- 금액 강조는 600. 최종 정산 결과나 포인트 잔액의 핵심 숫자만 700을 허용한다.
- 긴 장소명은 2줄까지 허용하고 말줄임표는 상세 화면보다 리스트 카드에서만 사용한다.

---

## 6. Spacing & Layout

### 6.1 Spacing Scale

- `4px`: micro gap
- `8px`: icon-text gap
- `12px`: compact control gap
- `16px`: standard content gap
- `20px`: card internal small gap
- `24px`: default card padding
- `32px`: section gap
- `40px`: major content gap
- `56px`: hero internal spacing
- `72px`: desktop major section spacing

### 6.2 Mobile Container

- 기본 좌우 padding: 20px
- 390px 이하: 16px
- 430px 이상: 24px 허용
- 콘텐츠를 항상 430px 프레임에 가두지 않는다.

### 6.3 Desktop Container

- 읽기 중심 페이지: max-width 960px
- 대시보드 및 리스트: max-width 1180px
- 지도 포함 2-column 페이지: max-width 1280px
- 좌우 gutter: 32~48px

### 6.4 Desktop Composition

640px 이상부터 무조건 모바일 화면을 확대하지 않는다.

- 방 상세: 지도 56% + 정보 패널 44%
- 방 만들기: 단계 입력 52% + route summary 48%
- 정산: 결과 60% + 거래 상세 40%
- 홈: 추천 hero + 2열 모집 grid

---

## 7. Shape System

| Token | Value | Use |
|---|---:|---|
| `radius-xs` | 8px | 작은 utility |
| `radius-sm` | 12px | icon button. compact input |
| `radius-md` | 14px | primary button. secondary button |
| `radius-lg` | 18px | 일반 card |
| `radius-xl` | 22px | hero card. route card |
| `radius-pill` | 9999px | filter chip. status badge |
| `radius-full` | 50% | avatar. circular control |

### 규칙

- 카드마다 무조건 `rounded-2xl`을 사용하지 않는다.
- primary CTA는 full pill 대신 14px radius를 기본으로 한다.
- filter와 status처럼 짧은 선택·상태 요소만 pill을 사용한다.
- full-bleed map과 large section surface에는 radius를 사용하지 않아도 된다.

---

## 8. Depth & Surface

### 8.1 Elevation Levels

| Level | Treatment | Use |
|---|---|---|
| `flat` | shadow 없음 | 기본 section |
| `hairline` | 1px solid `--hairline` | 기본 card |
| `selected` | 1px solid `--brand` + `--brand-soft` | 선택된 room/filter |
| `floating` | 아주 약한 shadow + backdrop blur | bottom sheet. 지도 control |
| `dark-focus` | dark surface + contrast typography | 정산 결과. 핵심 route hero |

### 8.2 Allowed Shadow

```css
0 8px 28px rgba(15, 23, 42, 0.10)
```

허용 위치:

- mobile bottom sheet
- 지도 위 floating control
- sticky action panel

금지 위치:

- 일반 모집 카드
- 버튼
- 텍스트
- 상태 배지

---

## 9. Navigation

### 9.1 Mobile Top Bar

- 높이: 56px
- 배경: `--glass-light`
- backdrop blur: `saturate(150%) blur(18px)`
- 하단 1px hairline
- 좌측: 현재 위치 또는 페이지 title
- 우측: 알림. 포인트

홈에서는 로고를 작게 노출하고 위치 정보가 주 시선이 되도록 한다.

### 9.2 Mobile Bottom Navigation

- 높이: safe area 제외 64px
- background: `rgba(255,255,255,0.88)`
- backdrop blur 사용
- 상단 hairline
- 활성 아이콘과 레이블: `--brand`
- 비활성: `--ink-tertiary`
- 중앙 플로팅 버튼 없음

항목:

1. 홈
2. 모집 찾기
3. 방 만들기
4. 이용 내역
5. 마이

### 9.3 Desktop Navigation

834px 이상에서는 bottom navigation을 제거한다.

- 좌측 slim sidebar 또는 top navigation 사용
- 페이지 성격에 따라 최대 220px sidebar
- 현재 페이지는 brand-soft surface와 brand icon으로 표시
- 관리자 화면은 사용자 영역과 navigation surface를 명확히 분리

---

## 10. Core Components

## 10.1 Primary Button

- height: 48px
- background: `--brand`
- text: white
- radius: 14px
- font: 16px/600
- padding: 0 20px
- active: `scale(0.98)`
- focus: 2px brand focus ring + 2px canvas offset

모바일 핵심 CTA는 가능하면 full width를 사용한다.

## 10.2 Secondary Button

- height: 48px
- background: transparent 또는 white
- border: 1px solid `--hairline`
- text: `--ink`
- radius: 14px

선택 상태가 필요한 경우 border를 `--brand`로 변경한다.

## 10.3 Destructive Button

- danger 색상을 사용하되 기본 화면에서는 낮은 시각적 우선순위를 유지한다.
- 위험 행동 직전 확인 modal을 반드시 제공한다.

## 10.4 Search Field

- height: 50px
- radius: 16px
- background: white
- border: 1px solid `--hairline`
- leading search/location icon
- focus: brand border + brand-soft outer ring

## 10.5 Filter Chip

- height: 36~40px
- pill
- default: surface + hairline
- selected: brand-soft + brand text + brand border

## 10.6 Room Card

모집 카드는 TaxiTaShare의 대표 컴포넌트다.

### 구조

1. 상단 메타
   - status badge
   - 출발까지 남은 시간
2. route
   - 출발지
   - route line
   - 도착지
3. 핵심 수치
   - 현재 인원 / 최대 인원
   - 예상 1인 분담금
4. 추천 근거
   - AI 아이콘 또는 작은 sage marker
   - 한 줄 추천 사유
5. action
   - 상세보기 또는 참여하기

### 시각 규칙

- background: white
- radius: 18px
- border: 1px solid `--hairline`
- padding: 20~24px
- shadow 없음
- 추천 room은 brand-soft tint를 아주 약하게 사용 가능
- divider 대신 간격으로 그룹을 나눈다.

## 10.7 Route Line

경로는 텍스트 두 줄보다 시각적으로 빠르게 읽히도록 만든다.

- 출발 marker: filled brand dot
- vertical route line: hairline dark
- 도착 marker: ring 또는 sage point
- 장소명은 16~17px/600
- 상세 주소는 13~14px secondary

## 10.8 Status Badge

모든 상태는 색상과 문구를 함께 사용한다.

예시:

- 모집 중 · `OPEN`
- 출발 임박 · `LEAVING SOON`
- 출발 확정 · `CONFIRMED`
- 이동 중 · `IN PROGRESS`
- 정산 대기 · `SETTLEMENT`
- 완료 · `COMPLETED`

상태 badge는 12~13px/600. 내부 padding 6px 10px를 사용한다.

## 10.9 Point Summary

포인트는 fintech처럼 과도하게 화려하게 보이지 않도록 한다.

- 사용 가능 포인트
- 예치 중 포인트
- 최근 변동

핵심 잔액은 28~32px/700. 나머지는 14~16px로 차분하게 정리한다.

---

## 11. Map Treatment

지도는 장식이 아니라 TaxiTaShare의 핵심 콘텐츠다.

### 기본 원칙

- 지도 영역은 모바일에서 최소 240px 높이
- 방 상세와 방 만들기에서는 300~380px 권장
- desktop에서는 화면 높이의 60~72%까지 확대 가능
- 지도 위 floating control은 44px 이상
- 경로 정보와 예상 시간은 지도 하단의 floating summary로 제공 가능

### 지도 UI

- 현재 위치: brand
- 출발 위치: brand filled marker
- 도착 위치: sage point 또는 dark marker
- 추천 경유지: brand-soft ring
- route polyline: brand 80% opacity

지도 SDK 자체 스타일을 지나치게 변경하지 않는다.

---

## 12. Page Composition

## 12.1 Landing

브랜드 영역은 어두운 `brand-route-gradient`를 사용한다.

구성:

- 작은 TaxiTaShare wordmark
- “같은 방향이면 택시비도 같이.”
- 출발지와 도착지를 연결하는 최소한의 route motif
- Primary CTA
- Secondary login CTA

하단은 white surface로 전환해 서비스 작동 방식을 간단히 설명한다.

## 12.2 Home

홈은 작은 카드 여러 개를 늘어놓지 않는다.

### 첫 화면

1. greeting + location
2. dark route hero
3. 추천 모집 1~2개
4. 곧 출발하는 모집
5. 포인트 summary

### Route Hero

- dark gradient surface
- 출발지 입력
- 도착지 입력
- 희망 시간
- “추천 모집 찾기” CTA
- 지도 전체를 넣지 않고 route preview를 사용

## 12.3 Room Search

- filter bar는 sticky
- mobile: horizontal scroll chips
- desktop: left filter rail + room grid
- 결과는 1열 또는 2열 grid
- 추천 이유가 없는 카드보다 경로와 비용이 먼저 읽혀야 한다.

## 12.4 Create Room

한 화면에 모든 입력을 넣지 않는다.

단계:

1. Route
2. Time & Seats
3. Approval & Detour
4. Fare Preview
5. Confirm

모바일은 stepper. desktop은 좌측 form + 우측 sticky summary.

## 12.5 Room Detail

mobile:

`map → route → fare → participants → policy → CTA`

desktop:

`map 56% / sticky detail panel 44%`

CTA는 모바일에서 bottom sticky action bar를 사용한다.

## 12.6 Gathering

집결 화면은 dashboard보다 live status 화면처럼 보이게 한다.

- dark time header
- 출발까지 남은 시간
- 집결지 map
- 참여자별 상태 timeline
- 이동 시작 CTA

## 12.7 Settlement

금융 서비스 느낌을 과하게 내지 않되 금액 관계는 명확히 한다.

정산 화면의 hierarchy:

1. 실제 총 택시비
2. 내 최종 부담액
3. 예치금
4. 반환 또는 추가 차감
5. 영수증
6. 동의 또는 이의 제기

정산 완료는 `surface-dark`를 사용해 결과를 강하게 마감한다.

## 12.8 Profile & History

정보를 카드마다 잘게 나누지 않는다.

- section header
- grouped list
- 필요한 곳만 hairline divider
- 개인정보와 계정 행동은 별도 section

---

## 13. AI Recommendation Visual Language

AI는 서비스의 기능이지 별도 캐릭터가 아니다.

따라서 반짝이 아이콘. 보라색 gradient. AI 전용 무지개 색상은 사용하지 않는다.

### AI Recommendation Block

- brand-soft background
- 작은 route sparkle 또는 compass icon
- sage dot는 최대 1개
- 추천 사유를 자연어로 표시
- 거리와 시간 수치는 강조

예시:

> 희망 목적지에서 230m 떨어진 방이에요. 예상 우회 시간은 약 3분입니다.

AI 추천은 자동 확정이 아니라는 보조 문구를 함께 표시한다.

---

## 14. Motion

TaxiTaShare의 motion은 빠르고 절제되어야 한다.

- button press: 120ms, scale 0.98
- page transition: 180~220ms opacity/translate
- bottom sheet: 220~260ms
- chip selection: 140ms
- skeleton shimmer는 매우 약하게 사용
- `prefers-reduced-motion` 지원

bounce와 과도한 spring motion은 사용하지 않는다.

---

## 15. Accessibility

- 모든 핵심 터치 영역은 최소 44×44px
- 본문 텍스트는 WCAG AA 대비 확보
- 상태는 색상만으로 구분하지 않는다.
- focus ring을 제거하지 않는다.
- icon-only button에는 accessible label을 제공한다.
- 지도 조작 없이도 출발지와 도착지 정보를 읽을 수 있어야 한다.
- 200% 확대에서도 핵심 CTA와 금액 정보가 잘리지 않아야 한다.

---

## 16. Do & Don't

### Do

- 딥 포레스트와 포레스트 에메랄드를 주축으로 사용한다.
- white card와 cool ivory canvas의 미세한 면 차이를 활용한다.
- 핵심 수치와 route를 시각적 중심으로 둔다.
- 카드보다 section과 정보 그룹을 먼저 설계한다.
- 세이지 컬러는 작은 브랜드 디테일에만 사용한다.
- 지도 위에는 필요한 control만 띄운다.
- desktop에서 정보 패널과 지도를 적극적으로 병렬 배치한다.

### Don't

- 택시 옐로우를 메인 컬러로 사용하지 않는다.
- 모든 요소를 pill로 만들지 않는다.
- 모든 카드에 그림자를 넣지 않는다.
- Apple의 제품 타일 구성이나 네비게이션을 그대로 복제하지 않는다.
- AI 기능에 보라색 gradient와 sparkle 장식을 반복하지 않는다.
- 포인트 화면을 암호화폐 지갑처럼 디자인하지 않는다.
- 의미 없이 glassmorphism을 남발하지 않는다.
- 한 화면에 4개 이상의 강한 색상을 사용하지 않는다.

---

## 17. Responsive Rules

| Breakpoint | 적용 |
|---|---|
| `≤ 389px` | 좌우 16px. single column. sticky CTA |
| `390~639px` | 모바일 기본. 좌우 20px |
| `640~833px` | 넓은 모바일/태블릿. 2열 일부 허용 |
| `834~1067px` | bottom nav 제거. desktop navigation 시작 |
| `1068~1279px` | 지도 + 정보 2-column 적극 사용 |
| `≥ 1280px` | max-width 1180~1280px. 넓은 여백 유지 |

---

## 18. Component Contract

공통 컴포넌트는 다음 variant를 우선 제공한다.

### Button

- `primary`
- `secondary`
- `ghost`
- `destructive`
- `dark`

### Card

- `surface`
- `subtle`
- `selected`
- `dark`
- `interactive`

### Badge

- `neutral`
- `brand`
- `success`
- `warning`
- `danger`

### Input

- `default`
- `search`
- `location`
- `error`

페이지에서 직접 임의의 버튼과 카드 스타일을 조합하지 않는다.

---

## 19. Implementation Tokens Example

```css
:root {
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

  --success: #187A56;
  --success-soft: #E5F2EB;
  --warning: #A66A16;
  --warning-soft: #FFF4DF;
  --danger: #C24752;
  --danger-soft: #FCEBED;

  --radius-sm: 12px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 22px;
}
```

---

## 20. 최종 디자인 한 줄 정의

**TaxiTaShare는 쿨 아이보리 위에 딥 포레스트와 포레스트 에메랄드를 중심으로 사용하고 세이지 포인트를 절제해 더 신뢰감 있고 고급스러운 이동 경험을 제공하는 프리미엄 캠퍼스 모빌리티 UI를 지향한다.**
