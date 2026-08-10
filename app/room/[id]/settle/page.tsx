import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Check, Info, UserX } from 'lucide-react'
import {
  confirmJourneyFareAction,
  settleJourneyAction,
  submitJourneyFareDisputeAction,
  withdrawJourneyFareDisputeAction,
} from '@/app/core/actions'
import { BottomBar } from '@/components/bottom-bar'
import { MobileShell } from '@/components/mobile-shell'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { StatusBadge } from '@/components/status-badge'
import { TopBar } from '@/components/top-bar'
import { Card, CardTitle } from '@/components/ui/card'
import { requireCompleteUser } from '@/lib/auth/session'
import { CoreError, getTripJourney } from '@/lib/core/service'

export const dynamic = 'force-dynamic'

export default async function SettlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const user = await requireCompleteUser()
  const [{ id }, query] = await Promise.all([params, searchParams])
  const journey = await getJourney(user.userId, id)
  const { trip, participants, settlement } = journey
  if (trip.status === 'COMPLETED') {
    redirect(`/room/${trip.tripId}/settle/complete`)
  }
  if (trip.status === 'IN_PROGRESS') {
    redirect(`/room/${trip.tripId}`)
  }
  const isHost = trip.hostUserId === user.userId
  const canConfirm =
    trip.status === 'SETTLEMENT_PENDING' &&
    settlement?.status === 'PENDING_CONFIRMATION' &&
    !settlement.currentUserConfirmed &&
    !settlement.currentUserHasOpenDispute
  const canDispute =
    trip.status === 'SETTLEMENT_PENDING' &&
    settlement?.status === 'PENDING_CONFIRMATION' &&
    !settlement.currentUserConfirmed &&
    !settlement.currentUserHasOpenDispute &&
    !isHost
  const allConfirmed =
    settlement &&
    settlement.confirmationCount === settlement.participantCount
  const confirmationExpired = settlement?.confirmationExpired
  const canSettle =
    isHost &&
    settlement?.status === 'PENDING_CONFIRMATION' &&
    settlement.openDisputeCount === 0 &&
    (allConfirmed || confirmationExpired)

  return (
    <MobileShell withTabBar={false}>
      <TopBar
        title="실제 요금 정산"
        subtitle={`${trip.origin} → ${trip.destination}`}
        backHref={`/room/${trip.tripId}/gathering`}
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

        <Card className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>정산 대상</CardTitle>
            <StatusBadge tone="brand">
              예치 확정 {trip.escrowParticipantCount}명
            </StatusBadge>
          </div>
          <ul className="flex flex-col gap-2">
            {participants.map((participant) => (
              <li
                key={participant.userId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="font-semibold">{participant.name}</span>
                {participant.status === 'NO_SHOW' ? (
                  <StatusBadge tone="warn" icon={UserX}>
                    노쇼·정산 포함
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="mint" icon={Check}>
                    정산 포함
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
          <p className="flex gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            <Info className="size-4 shrink-0" aria-hidden />
            노쇼가 발생해도 예치 당시 인원으로 나누며 탑승자에게 부담을 재배분하지
            않습니다.
          </p>
        </Card>

        {settlement ? (
          <Card className="gap-3">
            <CardTitle>정산 미리보기</CardTitle>
            <Row
              label="실제 총요금"
              value={`${Number(settlement.actualFare).toLocaleString('ko-KR')}P`}
            />
            <Row
              label="정산 인원"
              value={`${settlement.participantCount}명`}
            />
            <Row
              label="1인 최종 부담"
              value={`${Number(settlement.finalShare).toLocaleString('ko-KR')}P`}
              strong
            />
            <Row
              label="요금 확인"
              value={`${settlement.confirmationCount}/${settlement.participantCount}명`}
            />
          </Card>
        ) : null}
      </main>

      <BottomBar className="flex flex-col gap-2">
        {canConfirm ? (
          <form action={confirmJourneyFareAction}>
            <input type="hidden" name="tripId" value={trip.tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <PendingSubmitButton pendingLabel="동의 처리 중...">
              실제 요금에 동의
            </PendingSubmitButton>
          </form>
        ) : null}
        {canDispute ? (
          <form action={submitJourneyFareDisputeAction} className="flex flex-col gap-2">
            <input type="hidden" name="tripId" value={trip.tripId} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label htmlFor="fare-dispute-reason" className="text-sm font-semibold">
              실제 요금 이의제기 사유
            </label>
            <textarea
              id="fare-dispute-reason"
              name="reason"
              required
              maxLength={1000}
              className="app-input min-h-24 resize-y"
            />
            <PendingSubmitButton pendingLabel="이의제기 제출 중...">
              이의제기 제출
            </PendingSubmitButton>
          </form>
        ) : null}
        {settlement?.openDisputeCount ? (
          <div className="flex flex-col gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm" role="alert">
            <p>실제 요금 이의제기가 접수되어 최종 정산이 보류되었습니다.</p>
            {settlement.currentUserHasOpenDispute ? (
              <form action={withdrawJourneyFareDisputeAction}>
                <input type="hidden" name="tripId" value={trip.tripId} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={randomUUID()}
                />
                <PendingSubmitButton
                  pendingLabel="철회 처리 중..."
                  className="min-h-10 bg-background px-4 py-2 text-sm text-foreground"
                >
                  내 이의제기 철회
                </PendingSubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
        {canSettle ? (
          <form action={settleJourneyAction}>
            <input type="hidden" name="tripId" value={trip.tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <PendingSubmitButton
              pendingLabel="정산 중..."
            >
              {allConfirmed
                ? '최종 정산 실행'
                : '확인 기한 만료 정산 실행'}
            </PendingSubmitButton>
          </form>
        ) : null}
        <Link
          href={`/room/${trip.tripId}/gathering`}
          className="flex min-h-12 items-center justify-center rounded-full border border-border bg-background px-6 py-3 text-[17px]"
        >
          집결 현황으로 돌아가기
        </Link>
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

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-base font-extrabold' : 'font-semibold'}>
        {value}
      </span>
    </div>
  )
}
