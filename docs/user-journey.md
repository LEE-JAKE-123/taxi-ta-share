# TaxiTaShare 사용자 여정

관련 요구사항: `FR-01`~`FR-04`, `FR-10`~`FR-15`, `FR-17`~`FR-19`,
`FR-20`~`FR-25`, `FR-30`~`FR-40`, `FR-50`~`FR-54`, `TR-01`~`TR-03`.

이 문서는 `docs/prd.md`의 MVP 사용자 시나리오와 상태 정의를 한눈에
검토하기 위한 흐름도다. 실제 카드 결제·사용자 직접 충전·현금 인출은
MVP 범위에 포함하지 않는다.

## 한눈에 보는 6단계

실선은 사용자가 정상적으로 진행하는 길이고, 점선은 여정에서 이탈하거나
별도 처리가 필요한 예외다. 자세한 권한·상태 전이는 다음 섹션에서 확인한다.

```mermaid
flowchart LR
  signup([1. 가입]) --> discover[2. 모집 탐색 또는 생성]
  discover --> match[3. 참여 확정]
  match --> escrow[4. 예상 분담금 예치]
  escrow --> ride[5. 집결·이동]
  ride --> settlement[6. 실제 요금 확인·최종 정산]
  settlement --> completed([여정 완료])

  signup -. 필수 정보 미완료 .-> restricted[모집 생성·참여 제한]
  match -. 확정 인원 2명 미만 .-> expired[EXPIRED]
  ride -. 집결 미도착 .-> noShow[NO_SHOW<br/>정산 cohort 유지]
  settlement -. 이의제기 .-> dispute[정산 보류·해결 후 재진행]
```

| 단계 | 사용자가 확인하는 핵심 정보 | 통과 조건 |
|---|---|---|
| 1. 가입 | 필수 프로필 | 필수 정보 완성 |
| 2. 탐색/생성 | 출발·도착·시간·예상 분담금 | 열린 모집 또는 새 모집 |
| 3. 참여 확정 | 승인 결과·확정 인원 | 2~4명 확정 |
| 4. 예치 | 1인 예상 분담금·예치 잔액·예치 부족분 | 확정 참여자별 보유분 예치와 필요한 부족분 기록 |
| 5. 집결·이동 | 집결 정보·체크인 상태 | 체크인 또는 노쇼 확정 |
| 6. 정산 | 실제 요금·잠정/최종 분담금·거래 내역 | 10분 동의 후 잠정 정산, 24시간 이의 기간 뒤 최종 완료 |

## 정상 사용자 여정

```mermaid
flowchart TD
  start([서비스 시작]) --> profile[필수 정보 입력]
  profile --> complete{필수 정보가<br/>완료됐는가?}
  complete -- 아니오 --> blocked[모집 생성·참여 제한]
  complete -- 예 --> home[홈: 모집 탐색 또는 생성]

  home --> create[방장: 출발지·도착지·시간·목표 인원 입력]
  create --> estimate[경로·예상 시간·예상 요금 계산]
  estimate --> open[모집 게시: OPEN]

  home --> recommend[참여자: AI 추천 또는 직접 탐색]
  recommend --> detail[모집 상세·예상 분담금·상태 확인]
  detail --> request[참여 신청]
  request --> approve{방장 승인을<br/>받았는가?}
  approve -- 아니오 --> waiting[신청 대기 또는 미승인]
  approve -- 예 --> approved[참여 확정: APPROVED]

  open --> close{방장 수동 종료 또는<br/>출발 시각 도달?}
  approved --> close
  close --> capacity{확정 인원 2~4명?}
  capacity -- 아니오 --> expired[미성립 종료: EXPIRED]
  capacity -- 예 --> deposit[확정 참여자별 보유 포인트 예치<br/>부족분은 사용자별 기록]
  deposit --> confirmed[모집 확정: CONFIRMED<br/>보유분 예치·부족분 기록 완료]

  confirmed --> gathering[집결 정보]
  gathering --> checkin{집결 시각에 도착?}
  checkin -- 예 --> checkedin[체크인: CHECKED_IN]
  checkin -- 아니오 --> noshow[미도착 기록 또는 신고: NO_SHOW]
  checkedin --> progress[이동 시작: IN_PROGRESS]
  noshow --> progress

  progress --> fare[방장 또는 지정 제출자: 실제 요금 제출]
  fare --> pending[정산 확인 대기: SETTLEMENT_PENDING]
  pending --> confirm[확정 cohort: 10분 안 동의 또는 이의제기]
  confirm --> ready{전원 동의 또는<br/>10분 동의 기한 만료?}
  ready -- 예 --> provisional[시스템 잠정 정산<br/>append-only 원장 기록]
  provisional --> disputeWindow{등록 후 24시간 이의 기한 만료 및<br/>모든 이의 처리?}
  disputeWindow -- 예 --> done[모집·참여 최종 완료: COMPLETED]
  disputeWindow -- 아니오 --> confirm
  ready -- 아니오 --> pending
```

## 모집 및 참여 상태

```mermaid
stateDiagram-v2
  [*] --> DRAFT: 방 작성
  DRAFT --> OPEN: 방 게시
  OPEN --> CLOSED: 방장 수동 종료 또는 출발 시각 도달·2~4명
  OPEN --> EXPIRED: 방장 수동 종료 또는 출발 시각 도달·2명 미만
  OPEN --> CANCELLED: 방장, 출발 전·확정/예치 없음
  CLOSED --> CONFIRMED: 2~4명 + 보유분 예치·부족분 기록
  CLOSED --> EXPIRED: 출발 전 예치 확정 실패
  CONFIRMED --> IN_PROGRESS: 집결·이동 시작
  IN_PROGRESS --> SETTLEMENT_PENDING: 실제 요금 제출
  SETTLEMENT_PENDING --> COMPLETED: 잠정 정산 뒤 24시간 이의 기한 만료·이의 처리

  state "참여자" as participant {
    [*] --> APPLIED: 참여 신청
    APPLIED --> APPROVED: 방장 승인
    APPROVED --> DEPOSITED: 보유분 예치·필요한 부족분 기록
    DEPOSITED --> CHECKED_IN: 집결 확인
    DEPOSITED --> NO_SHOW: 미도착 확정
    CHECKED_IN --> COMPLETED: 정산 완료
    NO_SHOW --> COMPLETED: 정산 완료
    APPLIED --> CANCELLED: 참여 취소 가능 구간
    APPROVED --> CANCELLED: 정책상 허용된 취소 구간
  }
```

`OPEN` 상태에서만 신규 신청과 승인이 가능하다. 출발 전 모집이 닫힌 뒤에는
신규 참여·승인·예치 확정을 허용하지 않는다. 출발 시각까지 예치 확정을 끝내지
못하면 모집은 `EXPIRED`가 되며 보류 포인트는 멱등적으로 반환한다. 자동 승인은
`FR-16` Should 범위로 현재 이월되어 있다.

확정 참여자별로 가용 포인트를 예치하고, 1인 예상 예치액보다 부족하면 정확한
예치 부족분을 append-only로 기록한 뒤 모집을 확정한다. 부족분은 현재 모집의
집결·이동을 막지 않지만, 남은 사용자의 다른 모집 생성·신청·예치는 막는다.
부족분은 실제 요금 잠정 정산에서 해당 참여자별로만 상계하며 이중 청구하거나
다른 참여자에게 재배분하지 않는다.

## 정산과 이의제기 흐름

```mermaid
flowchart TD
  arrival[목적지 도착] --> submit[권한 있는 제출자: 실제 총요금 입력]
  submit --> snapshot[확정·예치 cohort와<br/>1인 최종 분담금 스냅샷 생성]
  snapshot --> proposed[정산 상태: PENDING_CONFIRMATION]
  proposed --> response{등록 후 10분 안<br/>각 참여자의 응답}

  response -- 동의 --> accepted[동의 기록]
  accepted --> all{전원 동의?}
  all -- 예 --> provisional[시스템: 잠정 정산 실행]
  all -- 아니오 --> response

  response -- 이의제기 --> disputed[이의제기 접수: 최종 완료 보류]
  disputed --> resolved{관리자 해결 또는<br/>철회?}
  resolved -- 실제 요금 수정 --> resubmit[수정된 실제 요금 재제출]
  resolved -- 이의 기각 또는 철회 --> provisional
  resubmit --> proposed

  proposed --> deadline{10분 동의 기한 만료?}
  deadline -- 예 --> provisional
  deadline -- 아니오 --> response

  provisional --> calculation[확정 cohort 기준 최종 부담액 계산<br/>반환·추가 차감·필요 시 외상 원장 기록]
  calculation --> disputeDeadline{등록 후 24시간 이의 기한 만료 및<br/>열린 이의가 모두 처리됐는가?}
  disputeDeadline -- 아니오 --> disputed
  disputeDeadline -- 예 --> completed[최종 정산 완료·거래 내역 표시]
```

정산 대상은 실제 탑승 인원이 아니라 **확정 cohort**다. 따라서 노쇼도 정산
대상에서 제외되지 않는다. 전원 동의 또는 10분 동의 기한 만료는 잠정 정산만
실행하며, 실제 요금 등록 후 24시간 이의 기한이 끝나고 열린 이의가 모두
처리돼야 최종 완료한다. 예치·반환·추가 차감·외상·정산은 서버 권한 검증,
데이터베이스 트랜잭션, 멱등성 키 및 append-only 원장으로 처리한다.

`NO_SHOW` 신고 또는 미도착 기록은 귀책의 자동 확정이 아니다. 추가 차감이나
이용 제한에는 서버 기록·허용된 증빙·반박 기회와 운영자 또는 사전 정의된 서버
규칙의 판정이 필요하다. 이동이 시작된 모집은 노쇼를 포함한 확정 cohort로
정산하며 비용을 재배분하지 않는다. 이동 미개시에서 `HOST_NO_START` 책임이
확정되면 관리자가 별도 실행으로 모집을 `CANCELLED`로 전이하고 비귀책 `MEMBER`
예치금만 전액 반환한다. 모집자 예치금·패널티·유예 시간은 열린 정책이다.

## 관리자 운영 흐름

관리자는 `ADMIN` 역할의 활성 계정만 수행할 수 있다. 관리자는 사용자를 대신해
포인트를 충전하거나 현금을 지급하지 않으며, MVP에서는 가상 포인트 지급과
정산·이의제기 처리만 수행한다.

### 포인트 지급 요청 처리

```mermaid
flowchart LR
  request[사용자: 포인트 지급 요청] --> queue[관리자 지급 요청 목록]
  queue --> review[대상 계정·요청 금액·사유 확인]
  review --> valid{관리자 권한·양의 금액·<br/>대상 계정이 유효한가?}

  valid -- 아니오 --> reject[거절 또는 오류 반환<br/>잔액·원장 변경 없음]
  valid -- 예 --> propose[관리자 A: 지급 실행 기안]
  propose --> approval[다른 활성 관리자 B: 독립 승인]
  approval --> execute[기안 관리자 A: 지급 실행]
  execute --> transaction[서버 트랜잭션]
  transaction --> ledger[ADMIN_GRANT 원장 행 추가]
  ledger --> balance[대상 사용자의 사용 가능 포인트 증가]
  balance --> audit[지급 관리자·대상·금액·사유·시각 기록]
  audit --> fulfilled([요청 처리 완료])
```

### 정산 이의제기 처리

```mermaid
flowchart TD
  dispute[정산 대기 중 이의제기 접수] --> inbox[관리자: 이의제기 목록 확인]
  inbox --> evidence[실제 요금·확정 cohort·증빙·이의 내용 검토]
  evidence --> choice{관리자 조치 선택}

  choice -- 기각 --> rejected[이의제기 REJECTED 기록]
  rejected --> resume[기존 정산 확인 흐름 재개]

  choice -- 실제 요금 수정 --> revise[수정 요금과 사유 입력]
  revise --> revisionCheck{열린 이의가 없고<br/>정산 대기 상태인가?}
  revisionCheck -- 아니오 --> blocked[처리 거부<br/>정산·원장 변경 없음]
  revisionCheck -- 예 --> resubmit[새 요금 revision 생성<br/>확인 기한 재시작]
  resubmit --> pending[참여자 확인 대기]

  choice -- 강제 정산 --> forceCheck{열린 이의가 없는가?}
  forceCheck -- 아니오 --> blocked
  forceCheck -- 예 --> force[관리자 정산 명령]
  force --> atomic[직렬화 트랜잭션]
  atomic --> settlement[정산·참여자·모집 상태 완료]
  settlement --> entries[반환·정산 차감·필요 시 추가 차감 원장 기록]
  entries --> command[관리자 명령·사유·멱등성 키 감사 기록]
  command --> completed([강제 정산 완료])
```

| 관리자 조치 | 선행 조건 | 변경 결과 | 감사·재시도 경계 |
|---|---|---|---|
| 포인트 지급 | 활성 `ADMIN`의 기안, 유효 대상·양의 금액·사유, 다른 활성 관리자의 승인 | 기안자가 승인 뒤 실행하여 사용 가능 포인트 증가 | 승인·실행 근거가 연결된 `ADMIN_GRANT` 원장 및 지급 이력 |
| 이의 기각 | 정산 대기 중 열린 이의 | 기존 실제 요금 제안 유지 | 이의 해결 이력 |
| 실제 요금 수정 | 정산 대기, 다른 열린 이의 없음 | 새 요금 revision·새 확인 기한 | 관리자 명령과 수정 사유 |
| 정산 명령 | 정산 대기, 다른 열린 이의 없음 | 잠정/최종 정산 정책에 따른 처리 | 단일 트랜잭션, 원장, 멱등성 키; 부족분은 개인 외상으로 기록 |

관리자 조치로도 확정 cohort를 임의로 바꾸거나, 완료된 정산을 수정하거나,
기존 원장 행을 수정·삭제할 수 없다. 지급의 기안자와 승인자는 같을 수 없고
자신 또는 자신의 요청에는 승인·지급할 수 없다. 실패·권한 부족·중복 요청은
완료로 표시하지 않고 상태와 원장을 보존한다.

## 정책상 미결 항목

- 모집 종료 후 또는 예치 후 취소의 수수료·환불 기준
- 노쇼 예치금 중 최종 분담금을 초과한 금액의 전액 반환 또는 제재 차감 여부
- 실제 택시 기사 요금의 지급·안내 방식
- 분쟁 판단에 사용할 증빙과 운영 기준

위 항목은 PRD에서 열린 결정으로 남아 있으므로, 다이어그램은 현재 확정된
상태·권한 경계만 표현한다.
