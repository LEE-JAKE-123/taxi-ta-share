# TaxiTaShare Design System — Quiet Precision

- 문서 버전: v3.1
- 갱신일: 2026-08-30
- 적용 대상: TaxiTaShare 전체 사용자·관리자 화면
- 제품 기준 문서: `docs/prd.md`

TaxiTaShare는 **Quiet Precision, Premium Mobility, Calm Confidence**를 핵심 인상으로 한다. 택시 서비스의 가볍고 노란 이미지, 금융 앱의 과도한 잔고 강조, AI의 장식적 표현을 따르지 않는다. 이동·위치·정산 정보를 차분하고 신뢰감 있게 전달하며, 출발지·도착지·시간·인원·예상 요금·정산 상태가 모든 화면의 주인공이다.

`Quiet Precision`은 화려함을 뜻하지 않는다. 충분한 여백, 절제된 색, 정확히 정렬된 수치, 지도의 깊이감, 필요한 순간에만 드러나는 움직임으로 신뢰를 만든다. 사용자는 화면이 고급스럽다고 느끼는 동시에 정산 금액과 상태를 절대 오해하지 않아야 한다.

디자인 키워드: `Deep Forest` · `Porcelain` · `Forest Emerald` · `Route Ribbon` · `Editorial Utility` · `Soft Depth` · `Quiet Luxury`

## 0. 문서 역할과 운영 기준

이 문서는 TaxiTaShare UI의 **사람이 읽는 디자인 계약**이다. 제품 요구사항, 접근성, 안전 및 금액·상태의 명확성은 시각적 표현보다 우선한다. 화면이나 컴포넌트를 바꿀 때는 이 문서와 `docs/prd.md`를 함께 확인한다.

| 구분 | 기준 | 책임 |
|---|---|---|
| 제품 동작·권한·상태·금액 | `docs/prd.md` | UI가 의미를 바꾸지 않도록 보호 |
| 디자인 의도·사용 규칙 | 이 문서 | 토큰, 컴포넌트, 패턴, 에셋, 문구의 공통 언어 |
| 구현 토큰 | `app/globals.css` | CSS 변수와 Tailwind/shadcn alias의 실제 값 |
| 화면 전환 순서·회귀 기준 | `docs/design-transition-plan.md` | 기존 화면을 안전하게 전환하는 실행 계획 |
| 패턴·에셋·문구·변경 절차 | `docs/design-changes/TaxiTaShare_design_system_operations_foundations_v1.md` | 화면 조립과 운영의 상세 계약 |

CSS의 값과 이 문서의 표가 달라지면, 구현을 임의로 따르지 말고 왜 다른지 먼저 확인한다. 값 변경은 `app/globals.css`, 이 문서의 토큰 표, 영향을 받는 공통 컴포넌트를 한 변경 단위로 다룬다.

TaxiTaShare는 SEED와 같은 외부 디자인 시스템의 **운영 방식**(Foundations → Components → Patterns → 변경 관리)은 참고하지만, 색상·에셋·문구·컴포넌트 외형을 복제하지 않는다. 이 시스템의 브랜드 기준은 Quiet Precision이다.

## 1. 시각 언어 원칙

정보의 우선순위는 다음과 같다.

1. 출발지와 도착지
2. 출발 시각과 남은 시간
3. 현재 인원과 최대 인원
4. 예상 총 요금과 1인 예상 분담금
5. 모집 상태와 다음 행동
6. AI 추천 근거

- 한 화면의 주 행동은 하나다. 이동 전에는 방 찾기/만들기, 모집 중에는 참여 신청/승인, 집결 중에는 체크인/이동 시작, 정산 중에는 동의/이의 제기를 가장 명확하게 둔다. 보조 행동은 ghost 또는 텍스트 링크로 낮춘다.
- 딥 포레스트와 포레스트 에메랄드를 주축으로 사용하고, 세이지는 작은 브랜드 포인트에만 제한한다.
- 여백, surface 차이, 1px hairline으로 정보 구조를 만든다. 일반 카드·버튼·배지에 그림자를 반복하지 않는다.
- 지도와 경로는 장식이 아닌 핵심 콘텐츠다. 출발지는 solid brand point, 도착지는 porcelain 중심의 ring point, 실제 또는 예상 경로는 하나의 Route Ribbon으로 표현한다. 경로가 없을 때는 가짜 선을 만들지 않고 장소 정보와 오류/재시도 상태를 우선한다.
- AI 추천은 별도 캐릭터나 보라색 효과가 아니라 계산 근거를 보여 주는 정보 블록이다.
- 요금·포인트·시간·거리에는 `font-variant-numeric: tabular-nums`를 적용한다. 금액의 기준(예상/예치/최종/반환/추가 차감), 분모, 산정 시각, 상태를 가까이 배치한다. 일반 금액은 600, 최종 정산 결과와 핵심 잔액만 700을 허용하며 800 이상의 굵기는 사용하지 않는다.

## 2. 토큰

| Token | Value | Use |
|---|---:|---|
| `--canvas` | `#FFFFFF` | 전체 화면의 순수 흰색 기본 배경; `app-canvas`에서만 정적인 미세 광택과 낮은 대비의 fine grain을 더할 수 있음 |
| `--surface` | `#FFFFFF` | 카드와 입력 영역 |
| `--surface-subtle` | `#EEF2EF` | 보조 섹션·비활성 영역 |
| `--surface-dark` | `#12231D` | route hero·정산 완료 결과 |
| `--surface-deep` | `#0A1511` | 제한적인 지도 오버레이 |
| `--ink` | `#15201C` | 제목과 본문 |
| `--ink-secondary` | `#5C6862` | 보조 설명 |
| `--ink-tertiary` | `#8B948F` | placeholder·비활성 텍스트 |
| `--brand` | `#2F6B57` | CTA·선택·링크 |
| `--brand-strong` | `#255344` | pressed·강조 상태 |
| `--brand-soft` | `#E5EFEA` | 선택·AI 추천 배경 |
| `--sage-accent` | `#879A8C` | 제한적인 브랜드 포인트 |
| `--sage-soft` | `#EEF3EF` | 특별 안내 배경 |
| `--hairline` | `#DDE4DF` | 카드·섹션 경계 |
| `--success` / `--success-soft` | `#187A56` / `#E5F2EB` | 완료·정상 정산 |
| `--warning` / `--warning-soft` | `#8A5713` / `#FFF4DF` | 출발 임박·확인 필요 |
| `--danger` / `--danger-soft` | `#B43A46` / `#FCEBED` | 취소·오류·위험 행동 |
| `--info` / `--info-soft` | `#3C7563` / `#E8F1ED` | 일반 안내·경로 보조 |

- 직접 hex를 컴포넌트에 작성하지 않고 의미 토큰을 사용한다.
- taxi yellow, 형광 민트·블루, 보라·핑크 서브 액센트, 무지개 gradient를 사용하지 않는다.
- `--sage-accent`는 클릭 가능한 요소의 기본 색이 아니다. 한 화면에서 강한 색은 brand와 semantic state 한 종류까지만 쓴다.

허용 gradient는 `brand-route-gradient`와 Route Hero 전용의 낮은 대비 `route-grid`뿐이며, 앱 전역 배경인 `app-canvas`에는 순수 흰색 위계를 유지하는 정적인 near-white 광택과 static fine grain을 단 한 번 예외로 허용한다. fine grain은 CSS background layer만으로 구현하고, 아주 낮은 대비의 불규칙한 점 밀도로 제한한다. 텍스트·카드·버튼·입력 위에 겹치거나 대비를 낮추지 않으며, 같은 표면에 반복 적용하지 않는다. `route-grid`는 경로·지도 Hero 안에서만 사용하고 일반 카드·버튼·배지·입력·필터·리스트 또는 상태 배경에는 사용하지 않는다. `app-canvas` 효과는 blur·shadow·애니메이션을 포함하지 않는다.

```css
linear-gradient(135deg, #12231D 0%, #163428 55%, #285A45 100%)
```

홈 route hero, 정산 완료 핵심 결과, 랜딩·로그인의 제한된 브랜드 영역에만 사용한다. 일반 카드, 버튼, 필터, 리스트 행, 상태 배지에서는 사용하지 않는다.

## 3. Typography, layout, shape

- Font stack: `"Pretendard Variable", Pretendard, Inter, "Noto Sans KR", system-ui, sans-serif`
- hero 32/40px 700, display amount 28/34px 700, page title 24/32px 700, section 18/26px 600
- body 16px/400, body-lg 17px/400, label 14px/600, caption 13px/400, micro 12px/500
- 헤드라인 `letter-spacing: -0.02em`, 본문 `-0.01em`
- 간격: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72px
- radius: 8, 12, 14, 18, 22px; full pill은 상태 배지·필터 칩·짧은 선택자에만 사용

숫자와 단위는 `12,500P`처럼 한 덩어리로 읽게 하고, 설명 label은 수치보다 한 단계 낮은 대비로 둔다. 한 card에 display 숫자를 여러 개 두지 않으며 전부 대문자 라벨과 800 이상의 굵기는 사용하지 않는다.

모바일 기본 좌우 여백은 20px(390px 이하 16px)이다. 데스크톱은 읽기 중심 960px, 리스트 1180px, 지도 2열 페이지 1280px을 최대 폭으로 사용한다. 834px 이상에서는 모바일 430px 프레임을 단순 확대하지 않는다.

## 4. 공통 컴포넌트 계약

| Component | Permitted variants |
|---|---|
| Button | `primary`, `secondary`, `ghost`, `destructive`, `dark` |
| Card | `surface`, `subtle`, `selected`, `dark`, `interactive` |
| Badge | `neutral`, `brand`, `success`, `warning`, `danger` |
| Input | `default`, `search`, `location`, `error` |

- Primary button: 48px, `--brand`, white text, 14px radius, 16px/600, 44×44px 이상의 터치 영역과 포커스 링을 제공한다.
- Secondary button: 48px, white/transparent, `--hairline` border, 14px radius를 사용한다.
- Search field: 50px, 16px radius, `--hairline` border, focus 시 brand border와 soft ring을 제공한다.
- 기본 card는 white surface, 18px radius, 1px `--hairline`, 20~24px padding, shadow 없음이다. 선택 card는 `--brand-soft`와 `--brand` border를 사용한다.
- Room card는 `상태 → 경로 → 시간 → 인원/분담금 → AI 근거 → 행동` 순서다. 출발은 brand dot, 도착은 ring/sage point가 있는 route line을 사용한다.
- Status badge는 색상과 문구를 함께 사용한다. 예: `모집 중 · OPEN`, `정산 대기 · SETTLEMENT`.
- RouteMap은 `loading`, `ready`, `no-route`, `error`, `no-key` 상태를 구분하며, 지도 조작 없이도 장소·거리·시간·경로 상태를 읽을 수 있게 한다.
- modal, bottom bar, 지도 위 floating control처럼 실제로 떠 있는 요소에만 `0 12px 32px rgba(18,35,29,.12)` 한 단계의 soft shadow를 허용한다.

페이지에서 임의의 버튼·카드 스타일을 새로 조합하지 않고 위 variant와 토큰을 우선 재사용한다.

## 5. 화면 구성

- 홈: greeting/location → dark route hero → 추천 모집 1~2개 → 곧 출발하는 모집 → 포인트 요약
- 방 찾기: sticky filter, 모바일 가로 칩, 데스크톱 filter rail + room grid
- 방 만들기: `Route → Time & Seats → Approval & Detour → Fare Preview → Confirm`
- 방 상세: 모바일 `map → route → fare → participants → policy → CTA`; 데스크톱 `map 56% / sticky detail 44%`
- 집결: dark time header, 남은 시간, 지도, 참여자 상태 timeline, 이동 시작 CTA
- 정산: 실제 총 택시비 → 내 최종 부담액 → 예치금 → 반환/추가 차감 → 영수증 → 동의/이의 제기; 완료 결과는 `--surface-dark`
- 프로필·이용 기록: 작은 카드 난립 대신 section header와 grouped list

포인트 화면은 지갑이나 투자 대시보드가 아니다. 사용 가능 포인트, 예치 포인트, 정산 중인 금액을 라벨과 설명으로 명시적으로 구분한다. 관리자 화면은 소비자 앱보다 정보 밀도가 높아도 같은 token과 상태 문법을 쓰며, 파괴적 조치 바로 앞에 대상·사유·금액·확정 상태를 재노출한다.

지도는 모바일에서 최소 240px, 방 상세·생성에서는 300~380px 높이를 권장한다. 지도 위 control은 최소 44px이며 SDK 자체 스타일을 과도하게 바꾸지 않는다.

## 6. 상호작용과 모션

- 상태 변화에는 150~200ms의 opacity/color/transform 전환만 사용한다. 경로 조회·정산처럼 시간이 걸리는 동작에는 진행 문구를 항상 함께 제공한다.
- primary button은 pressed 시에만 `scale(.98)`을 허용한다. card hover의 큰 이동, 지속적인 pulse, 금액 count-up은 사용하지 않는다.
- skeleton은 surface-subtle 위의 낮은 대비로 실제 텍스트 길이와 비슷한 구조를 유지한다.
- `prefers-reduced-motion`에서는 비필수 전환과 smooth scroll을 제거한다.

## 7. 접근성·금지 규칙

- 핵심 터치 영역은 최소 44×44px이며 focus ring을 제거하지 않는다.
- 상태는 색상만으로 전달하지 않으며 icon-only button에는 접근 가능한 이름을 제공한다.
- 지도 조작 없이도 출발지와 도착지 정보를 읽을 수 있어야 한다.
- 200% 확대에서도 CTA와 금액이 잘리지 않아야 하며 `prefers-reduced-motion`을 지원한다.
- 일반 카드·버튼·배지에 shadow를 넣거나 모든 요소를 `rounded-full`로 만들지 않는다.
- AI 기능에 보라색 gradient·반짝이 장식을 반복하지 않으며 포인트 화면을 암호화폐 지갑처럼 꾸미지 않는다.
- glassmorphism, 과도한 blur, neon, 3D 아이콘을 사용하지 않는다.
- 실제 지도·경로·금액·정산 상태가 없을 때 대체 데이터를 그럴듯하게 만들지 않는다.

**TaxiTaShare는 순수 흰색 캔버스 위에 딥 포레스트와 포레스트 에메랄드를 중심으로 사용하고, 실제 경로와 정확한 수치를 가장 앞에 두며, 절제된 깊이와 명료한 행동으로 신뢰감 있는 프리미엄 캠퍼스 모빌리티 경험을 제공한다.**
