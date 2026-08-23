import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, Clock, MapPin, UserX } from 'lucide-react'
import {
  checkInAction,
  markNoShowAction,
  startTripAction,
} from '@/app/core/actions'
import { Avatar } from '@/components/avatar'
import { BottomBar } from '@/components/bottom-bar'
import { MobileShell } from '@/components/mobile-shell'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { StatusBadge } from '@/components/status-badge'
import { TopBar } from '@/components/top-bar'
import { Card, CardTitle } from '@/components/ui/card'
import { requireCompleteUser } from '@/lib/auth/session'
import { CoreError, getTripJourney } from '@/lib/core/service'

export const dynamic = 'force-dynamic'

export default async function GatheringPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const user = await requireCompleteUser()
  const [{ id }, query] = await Promise.all([params, searchParams])
  const journey = await getJourney(user.userId, id)
  const { trip, participants } = journey
  const isHost = trip.hostUserId === user.userId
  const current = participants.find((item) => item.userId === user.userId)
  const canCheckIn =
    trip.status === 'IN_PROGRESS' && current?.status === 'DEPOSITED'

  return (
    <MobileShell withTabBar={false}>
      <TopBar
        title="집결 및 이동"
        subtitle={`${trip.origin} → ${trip.destination}`}
        backHref={`/room/${trip.tripId}`}
      />

      <main className="flex flex-1 flex-col gap-4 px-5 py-4 pb-32">
        {query.message ? (
          <p className="rounded-xl bg-mint-soft px-4 py-3 text-sm" role="status">
            {query.message}
          </p>
        ) : null}
        {query.error ? (
          <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm" role="alert">
            {query.error}
          </p>
        ) : null}

        <Card className="gap-3 bg-foreground text-background">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-background/70">현재 이동 상태</p>
              <h1 className="mt-1 text-xl font-extrabold">
                {trip.status === 'CONFIRMED'
                  ? '출발 준비'
                  : trip.status === 'IN_PROGRESS'
                    ? '이동 중'
                    : trip.status === 'SETTLEMENT_PENDING'
                      ? '정산 확인 중'
                      : '이용 완료'}
              </h1>
            </div>
            <StatusBadge tone="brand">
              확정 {trip.escrowParticipantCount}명
            </StatusBadge>
          </div>
          <p className="flex items-start gap-2 text-sm text-background/80">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
            저장된 출발지 {trip.origin}에서 집결합니다.
          </p>
        </Card>

        <Card className="gap-3">
          <CardTitle>확정 참여자</CardTitle>
          <p className="text-xs text-muted-foreground">
            노쇼도 예치 당시 확정 인원에 포함되어 동일한 최종 분담액을 부담합니다.
          </p>
          <ul className="flex flex-col gap-3">
            {participants.map((participant, index) => (
              <li
                key={participant.userId}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 p-3"
              >
                <Avatar name={participant.name} index={index} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {participant.name}
                    {participant.userId === user.userId ? ' (나)' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    예치 {Number(participant.depositAmount).toLocaleString('ko-KR')}P
                  </p>
                </div>
                <ParticipantBadge status={participant.status} />
                {isHost &&
                trip.status === 'IN_PROGRESS' &&
                participant.role !== 'HOST' &&
                participant.status === 'DEPOSITED' ? (
                  <form action={markNoShowAction} className="basis-full">
                    <input type="hidden" name="tripId" value={trip.tripId} />
                    <input
                      type="hidden"
                      name="participantId"
                      value={participant.userId}
                    />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={randomUUID()}
                    />
                    <PendingSubmitButton
                      pendingLabel="노쇼 기록 중..."
                      className="min-h-10 bg-destructive py-2 text-sm text-destructive-foreground"
                    >
                      <UserX className="size-4" aria-hidden />
                      노쇼 기록
                    </PendingSubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </main>

      <BottomBar className="flex flex-col gap-2">
        {isHost && trip.status === 'CONFIRMED' ? (
          <form action={startTripAction}>
            <input type="hidden" name="tripId" value={trip.tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <PendingSubmitButton pendingLabel="이동 시작 중...">
              이동 시작
            </PendingSubmitButton>
          </form>
        ) : null}
        {canCheckIn ? (
          <form action={checkInAction}>
            <input type="hidden" name="tripId" value={trip.tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <PendingSubmitButton pendingLabel="체크인 중...">
              <Check className="size-5" aria-hidden />
              도착 체크인
            </PendingSubmitButton>
          </form>
        ) : null}
        {trip.status === 'IN_PROGRESS' ||
        trip.status === 'SETTLEMENT_PENDING' ||
        trip.status === 'COMPLETED' ? (
          <Link
            href={
              trip.status === 'COMPLETED'
                ? `/room/${trip.tripId}/settle/complete`
                : trip.status === 'IN_PROGRESS'
                  ? `/room/${trip.tripId}`
                  : `/room/${trip.tripId}/settle`
            }
            className="flex min-h-12 items-center justify-center rounded-full border border-border bg-background px-6 py-3 text-[17px]"
          >
            {trip.status === 'IN_PROGRESS' ? '방 상세에서 도착 처리' : '정산 현황 보기'}
          </Link>
        ) : null}
      </BottomBar>
    </MobileShell>
  )
}

async function getJourney(userId: string, tripId: string) {
  try {
    return await getTripJourney(userId, tripId)
  } catch (error) {
    if (error instanceof CoreError) notFound()
    throw error
  }
}

function ParticipantBadge({ status }: { status: string }) {
  if (status === 'CHECKED_IN') {
    return (
      <StatusBadge tone="mint" icon={Check}>
        체크인
      </StatusBadge>
    )
  }
  if (status === 'NO_SHOW') {
    return (
      <StatusBadge tone="warn" icon={UserX}>
        노쇼
      </StatusBadge>
    )
  }
  if (status === 'COMPLETED') {
    return <StatusBadge tone="mint">정산 완료</StatusBadge>
  }
  return (
    <StatusBadge tone="muted" icon={Clock}>
      대기 중
    </StatusBadge>
  )
}
