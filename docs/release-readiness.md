# MVP 파일럿 출시 준비 점검표

관련 요구사항: `FR-01~05`, `FR-10~15`, `FR-12`, `FR-17~19`,
`FR-20~25`, `FR-30~40`, `FR-50~54`, `TR-01~08`, PRD §14.

이 문서는 배포 승인을 대신하지 않는다. 각 항목은 책임자, 일자, 실행 로그 또는
스크린샷을 릴리스 티켓에 남긴 뒤에만 완료로 표시한다.

## 핵심 흐름 추적 범위

- 필수 프로필이 없는 사용자의 모집 생성·참여·포인트 거래 차단, 2~4명 제한,
  수동/자동 모집 종료와 신규 입장 차단을 증명한다.
- 참여 취소 허용 구간(`OPEN`·출발 전·예치 전), 최소 인원 미충족, 예치 부족분,
  노쇼와 `HOST_NO_START` 예외를 다중 사용자 E2E에 포함한다.
- 실제 요금 등록 뒤 10분 동의 기한의 잠정 정산, 24시간 이의 기한과 모든 이의
  처리 뒤 최종 완료를 별도 증거로 남긴다. 부족분은 다른 참여자에게 재배분하지
  않고 개인 외상으로 기록되는지 확인한다.
- 신고·차단·고객 문의와 운영자 검토 흐름은 `FR-05` 증거로, 관리자 지급의
  기안·독립 승인·기안자 실행 분리는 `FR-31~31b` 증거로 남긴다.

## 환경 분리와 비밀값

- Development, Preview, Production에 서로 다른 Neon branch 또는 project와
  서로 다른 `DATABASE_FINGERPRINT`를 사용한다.
- 각 환경의 `DATABASE_URL`은 런타임 전용 pooled credential이고,
  `DATABASE_MIGRATION_URL`은 migration runner 전용 direct credential이다.
- 각 환경에서 `APP_ENVIRONMENT`, 예상 DB 이름·역할, fingerprint를 설정한 뒤
  `pnpm.cmd db:verify`가 해당 환경 이름과 역할로 통과하는 것을 기록한다.
- `SESSION_SECRET`, `CRON_SECRET`, 지도 제공자 서버 키는 환경별로 생성하며
  `NEXT_PUBLIC_` 변수 또는 저장소에 넣지 않는다.
- Preview 또는 Production에 Development DB URL이 연결되지 않았음을 Vercel
  환경 변수 목록과 DB identity 검증 결과로 확인한다.

## 마이그레이션·복구·관측

1. 적용 전 Neon restore point 또는 격리 branch를 만들고 대상 환경·시각을 기록한다.
2. `pnpm.cmd db:migrate` 후 `pnpm.cmd db:verify`를 실행한다. 정책 v2에서는
   `0022`~`0028` checksum, 원장·외상 트리거, 배분 제약이 모두 통과해야 한다.
3. PITR/백업 보존 기간, 목표 RPO/RTO, 복구 담당자와 장애 알림 채널을 운영
   책임자가 확정한다. 아직 정해지지 않으면 `TR-07`은 출시 차단 상태다.
4. 격리된 branch로 복구 훈련을 수행하고 checksum, 사용자·원장 행 수, 미결
   정산 상태를 대조한다. 실제 RPO/RTO와 증거 링크를 기록한다.
5. DB 연결 실패, migration 실패, due-transition 실패 및 지도 API 오류에 대한
   알림 수신자를 테스트한다.

## 자동 마감과 정산 기한 작업

- GitHub Actions `Process due transitions`의 `CRON_SECRET`와
  `DUE_TRANSITIONS_URL`을 Production 값으로 설정한다. URL은
  `/api/internal/due-transitions`의 Production HTTPS endpoint여야 한다.
- `workflow_dispatch`로 한 번 실행해 2xx 응답과 실행 시각을 기록한다.
- 격리 DB에서 출발 시각이 지난 `OPEN` 모집을 만들고, 1명은 `EXPIRED`,
  2명·4명은 `CLOSED`로 바뀌며 이후 신청·승인이 거절되는 것을 E2E로 확인한다.
- 10분 동의 기한 뒤 `PROVISIONALLY_SETTLED`, 24시간 이의 기한 뒤
  `COMPLETED`가 되는 경로와, 열린 이의가 최종 완료를 막는 경로를 확인한다.
- 100건 이상 backlog와 중복 workflow 실행 시 중복 전이·중복 원장이 없음을
  격리 DB에서 확인한다.

## 격리 E2E 환경 계약

`pnpm.cmd test:e2e`는 대상 DB에 migration·검증·fixture 쓰기를 수행한다. 따라서
Production 자격 증명을 사용하지 않고 다음의 격리 환경변수를 모두 설정한 경우에만
실행한다: `E2E_DATABASE_URL`, `E2E_DATABASE_MIGRATION_URL`,
`E2E_DATABASE_EXPECTED_NAME`, `E2E_DATABASE_FINGERPRINT`,
`E2E_DATABASE_EXPECTED_RUNTIME_ROLE`, `E2E_DATABASE_EXPECTED_MIGRATION_ROLE`,
`E2E_SESSION_SECRET`. 값은 저장소, trace, 이슈 또는 로그에 기록하지 않는다.

## 지도와 추천 출시 전제

- 운영 제공자, 활성 API 상품, 요금·할증·포인트 환산, TTL 및 fallback 정책은
  `DEC-003`으로 확정한다.
- 인접 목적지 추천은 `DEC-005`의 경유 동의, 최대 우회 거리·시간, 경로 없음
  처리, 반경 정책이 확정되기 전까지 비활성 상태를 유지한다.
- 현재 위치는 사용자 권한, 위치 정확도·신선도, 짧은 수명의 서명된 위치 토큰과
  `CURRENT_LOCATION` 저장 규칙이 구현·검증되기 전까지 출발지 선택 수단으로
  제공하지 않는다.
- 각 환경에서 실제 인증 사용자로 장소 검색, 선택 토큰, 경로·요금, 방 생성과
  확정 재검증을 수행하고 제공자/계산 시각/오류 결과를 기록한다.

## 법률·개인정보·운영 승인

- 개인정보·위치정보 처리 고지, 보관·삭제 기준, 포인트 운영 안내, 분쟁 증빙
  보관 기준을 책임자와 검토일이 있는 문서로 확정하고 가입 화면의 링크와 일치시킨다.
- 최초 운영 대학·지역(`DEC-012`), 호출 주체(`DEC-004`), 취소·노쇼 정책
  (`DEC-007~010`)의 담당자와 결정 기한을 기록한다.
- 이의제기 제출자 예외와 동의 뒤 이의 권한, 두 번째 정책 v2 요금 보정의
  처리 모델을 확정하기 전에는 해당 시나리오를 출시 완료로 표시하지 않는다.

## 필수 증거 묶음

- `pnpm.cmd lint`, `node_modules\\.bin\\tsc.cmd --noEmit`,
  `node_modules\\.bin\\vitest.cmd run`, `node_modules\\.bin\\next.cmd build`
  결과.
- 격리 환경 `pnpm.cmd test:e2e` 결과와 Playwright trace.
- 관리자 지급→예치→노쇼→실제 요금→잠정 정산→이의→최종 원장까지의
  다중 사용자 E2E 결과.
- 환경 fingerprint, restore exercise, due-transition workflow, 지도 API
  smoke test와 법률/운영 승인 기록.
