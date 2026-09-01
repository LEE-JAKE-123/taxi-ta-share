# E2E 정산 정책 작업 인계 메모 (2026-08-23)

> **역사적 인계 기록:** 이 문서는 2026-08-23 시점의 중단된 E2E 상태를 보존한다.
> 이후 변경의 출시 증거가 아니며, 현재 승인 기준과 필요한 증거는
> `docs/release-readiness.md`를 따른다.

## 현재 상태

- 로컬 Neon 메타데이터는 기본 `main` 브랜치로 복원했다. `.env.local`은 변경하지 않았다.
- 격리 E2E Neon 브랜치 `e2e-policy-v2-20260822`와 전용 DB `e2e_policy_v2_20260822`는 유지한다. 기존 E2E 증적 행은 삭제하지 않았다.
- 작업 트리에 아직 커밋하지 않은 변경이 있다. 다른 변경을 되돌리지 말 것.

## 변경 파일과 의도

- `lib/core/service.ts`
  - `submitActualFare`가 제출자를 자동 `fare_confirmations`에 넣지 않게 변경했다.
  - 방장을 포함한 예치 cohort 전원이 명시적으로 동의해야 v2 잠정정산으로 넘어간다.
- `e2e/designated-fare-submitter.spec.ts`
  - 직접 삽입 fixture를 트랜잭션으로 묶고 모든 `trip_settlement_participants` snapshot을 추가했다.
  - 예전 fixture가 PENDING settlement 2건에 snapshot 0건을 영구 생성하던 DB 불변식 실패를 막는다.
- `e2e/journey-settlement.spec.ts`
  - v2 흐름에 맞게 `SYSTEM_PROVISIONAL`까지 검증하고, 확인 행은 DB 폴링으로 읽는다.
- `e2e/admin-dispute-settlement.spec.ts`
  - legacy `PENDING_CONFIRMATION`에서 `ADJUSTED`가 보이지 않는 정책 경계를 검증한다.
- `e2e/policy-v2-provisional.spec.ts`
  - 두 번째 외상 fixture 전에 첫 외상에 연결된 OPEN dispute를 생성한다(DEC-014 예외).
  - 외상 상환 이벤트는 obligation 생성 순서로 정렬한다.
  - 포인트 요청 생성은 URL 변경이 아니라 DB 행 폴링으로 대기한다.
  - 관리자 지급 상환 테스트에서 재시도 클릭을 제거했다. 이 테스트의 목적은 oldest-first 상환이며, 그 클릭은 브라우저 server-action 연결을 120초까지 붙잡아 불안정했다.

## 확인된 검증

- `pnpm.cmd test`: 17 files, 139 tests passed.
- `.\\node_modules\\.bin\\tsc.cmd --noEmit`: passed.
- 격리 E2E 실행 시작 시 `migrate`와 `verify-db`가 `e2e_policy_v2_20260822`에서 통과했다.
- 전체 E2E는 최신의 마지막 테스트 정리 직전 실행에서 18/20을 통과했다. 남은 두 외상 상환 테스트는 이전 코드의 120초 UI 재시도 대기 때문에 실패했다.
- 최신 수정본으로 시작한 마지막 전체 E2E는 사용자 요청으로 중지했다. 따라서 재개 시 20/20 단일 실행 증적을 남겨야 한다.

## 재개 순서

1. `npx.cmd --yes neon@latest checkout br-withered-frog-azop9qg3 --no-env-pull`로 격리 E2E 브랜치 전환.
2. 프로세스 전용으로 아래 E2E 값을 설정하고 실행한다. 비밀값은 출력하거나 저장소에 기록하지 않는다.
   - `E2E_DATABASE_URL`: 전용 DB의 pooled URL
   - `E2E_DATABASE_MIGRATION_URL`: 전용 DB의 direct URL
   - expected name: `e2e_policy_v2_20260822`
   - fingerprint: `e2e-policy-v2-20260822`
   - runtime/migration role: direct URL의 role
3. `pnpm.cmd test:e2e` 전체 20개를 한 번 실행해 20/20을 확인한다.
   - 현재 `scripts/run-e2e.mjs`는 Playwright 인자를 `process.argv.slice(2)`로 전달한다. `pnpm ... -- --grep`는 Playwright에 여분의 `--`가 전달되어 grep를 무시한다. 단일 테스트가 필요하면 스크립트 전달 인자를 먼저 확인한다.
4. 끝나면 `npx.cmd --yes neon@latest checkout main --no-env-pull`로 복원한다.
5. E2E가 모두 통과하면 운영 결정 단계(TR-06~07, FR-14/32)로 넘어간다: 런타임/마이그레이션 역할 분리, 백업·복구, 지도·요금 제공자, 초기 포인트/노쇼/증빙, 파일럿 캠퍼스.

## 정책 근거와 주의점

- 관련: FR-30~40, FR-50~54, TR-01~03, DEC-011, DEC-014.
- v2는 `PENDING_CONFIRMATION` → `PROVISIONALLY_SETTLED/SYSTEM_PROVISIONAL` → 24시간 이의 창 종료 후 `COMPLETED/SYSTEM_FINALIZE` 흐름이다.
- 외상으로 정상 이용을 막는 DB trigger는 완화하거나 우회하지 않는다. 같은 trip/revision의 OPEN dispute가 있는 외상만 제한 예외다.
- append-only 원장/감사 데이터와 기존 격리 DB 증적 행을 삭제하지 않는다.
