# TaxiTaShare Design System — Premium Mobility

- 문서 버전: v2.0
- 작성일: 2026-08-23
- 적용 대상: TaxiTaShare 전체 사용자·관리자 화면
- 제품 기준 문서: `docs/prd.md`

TaxiTaShare는 **Premium Mobility, Calm Confidence, Clear Route**를 핵심 인상으로 한다. 택시 서비스의 가볍고 노란 이미지를 따르지 않고, 이동·위치·정산 정보를 차분하고 신뢰감 있게 전달한다. 출발지, 도착지, 시간, 인원, 예상 요금과 정산 상태가 모든 화면의 주인공이다.

디자인 키워드: `Deep Forest` · `Porcelain` · `Forest Emerald` · `Muted Sage` · `Glass` · `Route-first` · `Quiet Luxury`

## 1. 시각 언어 원칙

정보의 우선순위는 다음과 같다.

1. 출발지와 도착지
2. 출발 시각과 남은 시간
3. 현재 인원과 최대 인원
4. 예상 총 요금과 1인 예상 분담금
5. 모집 상태와 다음 행동
6. AI 추천 근거

- 딥 포레스트와 포레스트 에메랄드를 주축으로 사용하고, 세이지는 작은 브랜드 포인트에만 제한한다.
- 여백, surface 차이, 1px hairline으로 정보 구조를 만든다. 일반 카드·버튼·배지에 그림자를 반복하지 않는다.
- 지도와 경로는 장식이 아닌 핵심 콘텐츠다.
- AI 추천은 별도 캐릭터나 보라색 효과가 아니라 계산 근거를 보여 주는 정보 블록이다.
- 요금·포인트·시간·거리에는 `font-variant-numeric: tabular-nums`를 적용한다. 일반 금액은 600, 최종 정산 결과와 핵심 잔액만 700을 허용하며 800 이상의 굵기는 사용하지 않는다.

## 2. 토큰

| Token | Value | Use |
|---|---:|---|
| `--canvas` | `#FFFFFF` | 전체 화면의 순수 흰색 기본 배경 |
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
| `--warning` / `--warning-soft` | `#A66A16` / `#FFF4DF` | 출발 임박·확인 필요 |
| `--danger` / `--danger-soft` | `#C24752` / `#FCEBED` | 취소·오류·위험 행동 |
| `--info` / `--info-soft` | `#3E7867` / `#E8F1ED` | 일반 안내·경로 보조 |

- 직접 hex를 컴포넌트에 작성하지 않고 의미 토큰을 사용한다.
- taxi yellow, 형광 민트·블루, 보라·핑크 서브 액센트, 무지개 gradient를 사용하지 않는다.
- `--sage-accent`는 클릭 가능한 요소의 기본 색이 아니다. 한 화면에서 강한 색은 두 계열까지만 쓴다.

허용 gradient는 `brand-route-gradient`뿐이다.

```css
linear-gradient(135deg, #12231D 0%, #163428 55%, #285A45 100%)
```

홈 route hero, 정산 완료 핵심 결과, 랜딩·로그인의 제한된 브랜드 영역에만 사용한다. 일반 카드, 버튼, 필터, 리스트 행, 상태 배지에서는 사용하지 않는다.

## 3. Typography, layout, shape

- Font stack: `"Pretendard Variable", Pretendard, Inter, "Noto Sans KR", system-ui, sans-serif`
- hero 34/46px 700, display 28/36px 700, section 21/24px 600
- body 16px/400, body-lg 17px/400, label 14px/600, caption 13px/400, micro 12px/500
- 헤드라인 `letter-spacing: -0.02em`, 본문 `-0.01em`
- 간격: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72px
- radius: 8, 12, 14, 18, 22px; full pill은 상태 배지·필터 칩·짧은 선택자에만 사용

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

페이지에서 임의의 버튼·카드 스타일을 새로 조합하지 않고 위 variant와 토큰을 우선 재사용한다.

## 5. 화면 구성

- 홈: greeting/location → dark route hero → 추천 모집 1~2개 → 곧 출발하는 모집 → 포인트 요약
- 방 찾기: sticky filter, 모바일 가로 칩, 데스크톱 filter rail + room grid
- 방 만들기: `Route → Time & Seats → Approval & Detour → Fare Preview → Confirm`
- 방 상세: 모바일 `map → route → fare → participants → policy → CTA`; 데스크톱 `map 56% / sticky detail 44%`
- 집결: dark time header, 남은 시간, 지도, 참여자 상태 timeline, 이동 시작 CTA
- 정산: 실제 총 택시비 → 내 최종 부담액 → 예치금 → 반환/추가 차감 → 영수증 → 동의/이의 제기; 완료 결과는 `--surface-dark`
- 프로필·이용 기록: 작은 카드 난립 대신 section header와 grouped list

지도는 모바일에서 최소 240px, 방 상세·생성에서는 300~380px 높이를 권장한다. 지도 위 control은 최소 44px이며 SDK 자체 스타일을 과도하게 바꾸지 않는다.

## 6. 접근성·금지 규칙

- 핵심 터치 영역은 최소 44×44px이며 focus ring을 제거하지 않는다.
- 상태는 색상만으로 전달하지 않으며 icon-only button에는 접근 가능한 이름을 제공한다.
- 지도 조작 없이도 출발지와 도착지 정보를 읽을 수 있어야 한다.
- 200% 확대에서도 CTA와 금액이 잘리지 않아야 하며 `prefers-reduced-motion`을 지원한다.
- 일반 카드·버튼·배지에 shadow를 넣거나 모든 요소를 `rounded-full`로 만들지 않는다.
- AI 기능에 보라색 gradient·반짝이 장식을 반복하지 않으며 포인트 화면을 암호화폐 지갑처럼 꾸미지 않는다.

**TaxiTaShare는 순수 흰색 캔버스 위에 딥 포레스트와 포레스트 에메랄드를 중심으로 사용하고, 세이지 포인트를 절제해 신뢰감 있고 고급스러운 이동·정산 경험을 제공하는 프리미엄 캠퍼스 모빌리티 UI를 지향한다.**
