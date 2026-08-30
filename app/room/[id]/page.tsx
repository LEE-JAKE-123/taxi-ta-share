import { randomUUID } from 'node:crypto'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Clock, Flag, MapPin, Play, ShieldCheck, UserX, UsersRound } from 'lucide-react'
import {
  approveFromRoomAction,
  applyFromRoomAction,
  blockUserFromRoomAction,
  cancelParticipationFromRoomAction,
  closeTripFromRoomAction,
  confirmTripAndDepositFromRoomAction,
  setDesignatedFareSubmitterAction,
  startTripFromRoomAction,
  submitUserReportFromRoomAction,
} from '@/app/core/actions'
import { ArrivalSettlementControl } from '@/components/arrival-settlement-control'
import { Avatar } from '@/components/avatar'
import { BottomBar } from '@/components/bottom-bar'
import {
  estimatedShareLabel,
  formatDeparture,
  maskName,
  participantStatusLabel,
  roomStatusLabel,
} from '@/components/database-room-card'
import { MobileShell } from '@/components/mobile-shell'
import { OpenRoomHostActions } from '@/components/open-room-host-actions'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { StatusBadge } from '@/components/status-badge'
import { TopBar } from '@/components/top-bar'
import { RouteMap } from '@/components/route-map'
import { Card, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { requireCompleteUser } from '@/lib/auth/session'
import { getCoreDashboard } from '@/lib/core/service'

export default async function RoomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const user = await requireCompleteUser()
  const [{ id }, query] = await Promise.all([params, searchParams])
  const data = await getCoreDashboard(user.userId, user.role === 'ADMIN')
  const room = data.trips.find((item) => item.tripId === id)

  if (!room) notFound()

  const isHost = room.hostUserId === user.userId
  const departureOpen = new Date(room.departureAt) > new Date()
  const isAtCapacity = room.approvedCount >= room.maxParticipants
  const canApply =
    !isHost &&
    room.status === 'OPEN' &&
    departureOpen &&
    !isAtCapacity &&
    room.currentUserStatus === null
  const roomParticipants = data.participants.filter(
    (participant) => participant.tripId === room.tripId,
  )
  const applicants = isHost
    ? roomParticipants.filter((participant) => participant.status === 'APPLIED')
    : []
  const confirmedParticipants = roomParticipants.filter(
    (participant) =>
      participant.status !== 'APPLIED' && participant.status !== 'CANCELLED',
  )
  const canApprove =
    isHost && room.status === 'OPEN' && departureOpen && !isAtCapacity
  const canCancelParticipation =
    !isHost &&
    room.status === 'OPEN' &&
    departureOpen &&
    ['APPLIED', 'APPROVED'].includes(room.currentUserStatus ?? '')
  const canEnterJourney =
    ['CONFIRMED', 'IN_PROGRESS', 'SETTLEMENT_PENDING', 'COMPLETED'].includes(
      room.status,
    ) &&
    ['DEPOSITED', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'].includes(
      room.currentUserStatus ?? '',
    )
  const canSubmitFare =
    room.status === 'IN_PROGRESS' &&
    (isHost || room.fareSubmitterUserId === user.userId)
  const safetyTargets = isHost
    ? roomParticipants.filter(
        (participant) =>
          participant.userId !== user.userId && participant.status !== 'CANCELLED',
      )
    : [
        {
          userId: room.hostUserId,
          name: room.hostName,
        },
      ]

  return (
    <MobileShell withTabBar={false}>
      <TopBar title="동승 방 상세" subtitle={`방장 ${maskName(room.hostName)}`} backHref="/my-rooms" />

      <main className="flex flex-1 flex-col gap-5 px-4 py-5 pb-36 min-[391px]:px-5 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8">
        {query.message ? (
          <p className="rounded-[14px] border border-success/20 bg-success-soft px-4 py-3 text-sm text-success" role="status">
            {query.message}
          </p>
        ) : null}
        {query.error ? (
          <p className="rounded-[14px] border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">
            {query.error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2" aria-label="모집 상태">
          <StatusBadge variant={room.status === 'OPEN' ? 'success' : 'neutral'}>
            {roomStatusLabel(room.status)}
          </StatusBadge>
          <StatusBadge variant={isAtCapacity ? 'neutral' : 'brand'} icon={UsersRound}>
            확정 {room.approvedCount}/{room.maxParticipants}명
          </StatusBadge>
          {room.approvedCount >= 2 ? (
            <StatusBadge variant="brand" icon={ShieldCheck}>
              최소 출발 인원 충족
            </StatusBadge>
          ) : (
            <StatusBadge variant="warning">출발까지 {2 - room.approvedCount}명 필요</StatusBadge>
          )}
        </div>

        <section className="grid gap-4 lg:grid-cols-2 lg:items-start" aria-label="이동 경로와 예상 요금">
        <Card className="flex flex-col gap-3">
          <CardTitle>이동 정보</CardTitle>
          <InfoLine icon={MapPin} label="출발" value={room.origin} />
          <InfoLine icon={MapPin} label="도착" value={room.destination} />
          <InfoLine
            icon={Clock}
            label="출발 시각"
            value={formatDeparture(room.departureAt)}
          />
        </Card>

        {room.originLatitude !== null &&
        room.originLongitude !== null &&
        room.destinationLatitude !== null &&
        room.destinationLongitude !== null ? (
          <RouteMap
            className="lg:min-h-[30rem]"
            origin={{
              latitude: room.originLatitude,
              longitude: room.originLongitude,
            }}
            destination={{
              latitude: room.destinationLatitude,
              longitude: room.destinationLongitude,
            }}
          />
        ) : null}

        {room.hostMemo ? (
          <Card className="flex flex-col gap-3">
            <CardTitle>방장 전달사항</CardTitle>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {room.hostMemo}
            </p>
          </Card>
        ) : null}

        <Card className="flex flex-col gap-3 lg:sticky lg:top-20">
          <CardTitle>예상 분담금</CardTitle>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">예상 총요금</dt>
              <dd className="font-semibold">
                {room.estimatedFare === null
                  ? '산정 전'
                  : `${room.estimatedFare.toLocaleString('ko-KR')}P`}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">예상 1인 분담금</dt>
              <dd className="text-base font-extrabold">
                {estimatedShareLabel(room)}
              </dd>
            </div>
          </dl>
          {room.estimatedFare === null ? (
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              지도 기반 요금 산정이 완료되기 전에는 예상 금액이나 예치를 안내하지
              않습니다.
            </p>
          ) : (
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              현재 확정 인원 기준 예상치이며, 실제 정산 금액과 다를 수 있습니다.
            </p>
          )}
        </Card>
        </section>

        {isHost && room.status === 'OPEN' ? (
          <Card className="gap-3">
            <CardTitle>참여 신청 관리</CardTitle>
            <p className="text-xs text-muted-foreground">
              이번 모집은 방장이 신청을 직접 승인합니다. 자동 승인은 하지 않습니다.
            </p>
            {applicants.length > 0 ? (
              <div className="flex flex-col gap-2">
                {applicants.map((applicant, index) => (
                  <form
                    key={applicant.userId}
                    action={approveFromRoomAction}
                    className="rounded-xl border border-border p-3"
                  >
                    <input type="hidden" name="tripId" value={room.tripId} />
                    <input
                      type="hidden"
                      name="participantId"
                      value={applicant.userId}
                    />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={randomUUID()}
                    />
                    <div className="mb-3 flex items-center gap-3">
                      <Avatar name={applicant.name} index={index} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {applicant.name}
                        </p>
                        <p className="text-xs text-muted-foreground">승인 대기</p>
                      </div>
                    </div>
                    <PendingSubmitButton
                      pendingLabel="승인하는 중..."
                      disabled={!canApprove}
                    >
                      참여 승인
                    </PendingSubmitButton>
                  </form>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                대기 중인 참여 신청이 없습니다.
              </p>
            )}
            {!departureOpen ? (
              <p className="text-xs text-warn">출발 시각이 지나 승인할 수 없습니다.</p>
            ) : isAtCapacity ? (
              <p className="text-xs text-muted-foreground">
                최대 인원에 도달해 추가 승인할 수 없습니다.
              </p>
            ) : null}
          </Card>
        ) : null}

        <Card className="gap-3">
          <CardTitle>{isHost ? '확정 참여자' : '내 참여 상태'}</CardTitle>
          {confirmedParticipants.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {confirmedParticipants.map((participant, index) => (
                <li key={participant.userId} className="flex items-center gap-3">
                  <Avatar name={participant.name} index={index} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {isHost ? participant.name : maskName(participant.name)}
                  </span>
                  <StatusBadge
                    variant={
                      participant.userId === room.fareSubmitterUserId
                        ? 'brand'
                        : participant.role === 'HOST'
                          ? 'brand'
                          : 'neutral'
                    }
                  >
                    {participant.userId === room.fareSubmitterUserId
                      ? '요금 입력자'
                      : participant.role === 'HOST'
                        ? '방장'
                        : participantStatusLabel(participant.status)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              아직 확정된 참여 정보가 없습니다.
            </p>
          )}
        </Card>

        {safetyTargets.length ? (
          <Card className="gap-3">
            <CardTitle>안전 신고·차단</CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              신고 내용은 대상 사용자에게 공개되지 않습니다. 차단해도 이미 확정·예치된
              참여와 정산은 바뀌지 않으며, 이후 신규 동승 신청과 승인이 제한됩니다.
            </p>
            <div className="flex flex-col gap-2">
              {safetyTargets.map((target) => (
                <details
                  key={target.userId}
                  className="rounded-xl border border-border px-3 py-2"
                >
                  <summary className="cursor-pointer text-sm font-semibold">
                    {isHost ? target.name : maskName(target.name)} 신고·차단
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <form action={blockUserFromRoomAction}>
                      <input type="hidden" name="tripId" value={room.tripId} />
                      <input type="hidden" name="blockedUserId" value={target.userId} />
                      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                      <PendingSubmitButton
                        pendingLabel="차단 처리 중..."
                        className="border border-warn bg-background text-warn"
                      >
                        <UserX className="size-4" aria-hidden />
                        차단하기
                      </PendingSubmitButton>
                    </form>
                    <form action={submitUserReportFromRoomAction} className="flex flex-col gap-2">
                      <input type="hidden" name="tripId" value={room.tripId} />
                      <input type="hidden" name="reportedUserId" value={target.userId} />
                      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                      <label htmlFor={`report-reason-${target.userId}`} className="text-sm font-semibold">
                        신고 사유
                      </label>
                      <select id={`report-reason-${target.userId}`} name="reasonCode" className="app-input" required defaultValue="">
                        <option value="" disabled>사유를 선택해주세요</option>
                        <option value="SAFETY">안전 우려</option>
                        <option value="HARASSMENT">괴롭힘·부적절한 언행</option>
                        <option value="NO_SHOW">노쇼 관련</option>
                        <option value="FRAUD">사기·허위 정보 의심</option>
                        <option value="OTHER">기타</option>
                      </select>
                      <label htmlFor={`report-description-${target.userId}`} className="text-sm font-semibold">
                        신고 내용
                      </label>
                      <textarea
                        id={`report-description-${target.userId}`}
                        name="description"
                        className="app-input min-h-24 resize-y"
                        minLength={10}
                        maxLength={2000}
                        required
                      />
                      <label htmlFor={`report-evidence-${target.userId}`} className="text-sm font-semibold">
                        증빙 설명 <span className="font-normal text-muted-foreground">(선택)</span>
                      </label>
                      <input
                        id={`report-evidence-${target.userId}`}
                        name="evidenceRef"
                        className="app-input"
                        maxLength={2000}
                      />
                      <PendingSubmitButton pendingLabel="신고 접수 중...">
                        <Flag className="size-4" aria-hidden />
                        신고 접수
                      </PendingSubmitButton>
                    </form>
                  </div>
                </details>
              ))}
            </div>
          </Card>
        ) : null}

        {isHost && room.status === 'CLOSED' ? (
          <Card className="gap-3">
            <CardTitle>모집 마감 · 예치 진행</CardTitle>
            <p className="text-sm text-muted-foreground">
              확정된 참여자 전원의 예상 요금 포인트를 예치하면 모집이 확정되고 출발할 수 있습니다.
            </p>
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              잔액이 부족한 참여자는 보유 포인트만 예치하고 부족분을 기록합니다. 현재 방은 계속 진행되지만, 예치 부족분이 남아 있으면 이후 일반 이용이 제한됩니다.
            </p>
          </Card>
        ) : null}

        {isHost && room.status === 'EXPIRED' ? (
          <Card className="gap-3">
            <CardTitle>모집이 종료되었습니다</CardTitle>
            <p className="text-sm text-muted-foreground">
              확정 인원이 2명에 미달해 이 방은 출발할 수 없습니다.
            </p>
          </Card>
        ) : null}

        {isHost && room.status === 'CONFIRMED' ? (
          <form action={setDesignatedFareSubmitterAction}>
            <Card className="gap-3">
              <CardTitle>실제 요금 입력자</CardTitle>
              <p className="text-sm text-muted-foreground">
                방장은 항상 입력할 수 있습니다. 필요하면 예치를 마친 참여자 한 명을
                추가로 지정해 주세요.
              </p>
              <label htmlFor="fare-submitter" className="text-sm font-semibold">
                지정 참여자
              </label>
              <select
                id="fare-submitter"
                name="submitterId"
                defaultValue={room.fareSubmitterUserId ?? ''}
                className="app-input"
              >
                <option value="">방장이 직접 입력</option>
                {confirmedParticipants
                  .filter(
                    (participant) =>
                      participant.role === 'MEMBER' &&
                      participant.status === 'DEPOSITED',
                  )
                  .map((participant) => (
                    <option key={participant.userId} value={participant.userId}>
                      {participant.name}
                    </option>
                  ))}
              </select>
              <input type="hidden" name="tripId" value={room.tripId} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <PendingSubmitButton pendingLabel="입력자 지정 중...">
                실제 요금 입력자 저장
              </PendingSubmitButton>
            </Card>
          </form>
        ) : null}
      </main>

      {isHost && room.status === 'OPEN' ? (
        <BottomBar>
          <div className="grid grid-cols-2 gap-2">
            <OpenRoomHostActions
              tripId={room.tripId}
              departureOpen={departureOpen}
              fallbackIdempotencyKey={randomUUID()}
            />
            <form action={closeTripFromRoomAction}>
              <input type="hidden" name="tripId" value={room.tripId} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={randomUUID()}
              />
              <PendingSubmitButton
                pendingLabel="모집을 종료하는 중…"
                disabled={!departureOpen}
                className="min-h-11 rounded-xl px-3 py-2 text-sm"
              >
                모집 종료
              </PendingSubmitButton>
            </form>
          </div>
        </BottomBar>
      ) : isHost && room.status === 'CLOSED' ? (
        <BottomBar>
          <form action={confirmTripAndDepositFromRoomAction}>
            <input type="hidden" name="tripId" value={room.tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <PendingSubmitButton pendingLabel="전원 포인트를 예치하는 중…">
              모집 확정 · 전원 예치
            </PendingSubmitButton>
          </form>
        </BottomBar>
      ) : isHost && room.status === 'CONFIRMED' ? (
        <BottomBar>
          <form action={startTripFromRoomAction}>
            <input type="hidden" name="tripId" value={room.tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <PendingSubmitButton pendingLabel="출발 처리 중...">
              <Play className="size-5" aria-hidden />
              출발
            </PendingSubmitButton>
          </form>
        </BottomBar>
      ) : canSubmitFare ? (
        <BottomBar className="flex flex-col gap-2">
          <ArrivalSettlementControl
            tripId={room.tripId}
            isDesignated={!isHost}
          />
          <Link
            href={`/room/${room.tripId}/gathering`}
            className={buttonVariants({ variant: 'secondary', size: 'lg' })}
          >
            집결·노쇼 관리
          </Link>
        </BottomBar>
      ) : canEnterJourney ? (
        <BottomBar>
          <Link
            href={
              room.status === 'COMPLETED'
                ? `/room/${room.tripId}/settle/complete`
                : `/room/${room.tripId}/gathering`
            }
            className={buttonVariants({ variant: 'primary', size: 'lg' })}
          >
            {room.status === 'COMPLETED' ? '정산 결과 보기' : '집결·이동 화면'}
          </Link>
        </BottomBar>
      ) : !isHost ? (
        <BottomBar>
          {canCancelParticipation ? (
            <form action={cancelParticipationFromRoomAction}>
              <input type="hidden" name="tripId" value={room.tripId} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <PendingSubmitButton
                pendingLabel="참여 취소 처리 중..."
                className="border border-warn bg-background text-warn"
              >
                참여 취소
              </PendingSubmitButton>
            </form>
          ) : canApply ? (
            <form action={applyFromRoomAction}>
              <input type="hidden" name="tripId" value={room.tripId} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <PendingSubmitButton pendingLabel="신청하는 중...">
                참여 신청
              </PendingSubmitButton>
            </form>
          ) : (
            <div className="rounded-xl bg-muted px-4 py-3 text-center text-sm font-semibold">
              {applicationUnavailableReason({
                status: room.status,
                currentUserStatus: room.currentUserStatus,
                departureOpen,
                isAtCapacity,
              })}
            </div>
          )}
        </BottomBar>
      ) : null}
    </MobileShell>
  )
}

function InfoLine({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-semibold leading-5">{value}</span>
    </div>
  )
}

function applicationUnavailableReason({
  status,
  currentUserStatus,
  departureOpen,
  isAtCapacity,
}: {
  status: string
  currentUserStatus: string | null
  departureOpen: boolean
  isAtCapacity: boolean
}) {
  if (currentUserStatus) {
    return `현재 참여 상태: ${participantStatusLabel(currentUserStatus)}`
  }
  if (status !== 'OPEN') return '모집 중인 방에만 참여 신청할 수 있습니다.'
  if (!departureOpen) return '출발 시각이 지나 참여 신청할 수 없습니다.'
  if (isAtCapacity) return '최대 인원에 도달한 방입니다.'
  return '현재 참여 신청을 할 수 없습니다.'
}
