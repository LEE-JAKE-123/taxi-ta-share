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
  const currentParticipant = participants.find(
    (participant) => participant.userId === user.userId,
  )
  if (trip.status === 'COMPLETED') {
    redirect(`/room/${trip.tripId}/settle/complete`)
  }
  if (trip.status === 'IN_PROGRESS') {
    redirect(`/room/${trip.tripId}`)
  }
  const isHost = trip.hostUserId === user.userId
  const isPolicyV2 = settlement?.allocationPolicy === 'HOST_APPROVAL_ORDER'
  const isProvisionallySettled =
    isPolicyV2 && settlement?.status === 'PROVISIONALLY_SETTLED'
  const canConfirm =
    trip.status === 'SETTLEMENT_PENDING' &&
    settlement?.status === 'PENDING_CONFIRMATION' &&
    !settlement.currentUserConfirmed &&
    !settlement.currentUserHasOpenDispute
  const canDispute = Boolean(
    trip.status === 'SETTLEMENT_PENDING' &&
    settlement &&
    !settlement.currentUserSubmittedFare &&
    !settlement.currentUserHasOpenDispute &&
    ((
      isPolicyV2 &&
      (settlement?.status === 'PROVISIONALLY_SETTLED' ||
        (settlement?.status === 'PENDING_CONFIRMATION' &&
          !settlement.currentUserConfirmed)) &&
      !settlement.disputeExpired
    ) ||
      (!isPolicyV2 &&
        settlement?.status === 'PENDING_CONFIRMATION' &&
        !settlement.currentUserConfirmed &&
        !settlement.confirmationExpired)),
  )
  const allConfirmed =
    settlement &&
    settlement.confirmationCount === settlement.participantCount
  const confirmationExpired = settlement?.confirmationExpired
  const canSettle =
    isHost &&
    !isPolicyV2 &&
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
          <p className="rounded-[14px] bg-success-soft px-4 py-3 text-sm text-success" role="status">
            {query.message}
          </p>
        ) : null}
        {query.error ? (
          <p className="rounded-[14px] bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">
            {query.error}
          </p>
        ) : null}

        <Card variant="surface" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>정산 대상</CardTitle>
            <StatusBadge variant="brand">
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
                  <StatusBadge variant="warning" icon={UserX}>
                    노쇼·정산 포함
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="success" icon={Check}>
                    정산 포함
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
          <p className="flex gap-2 rounded-[14px] bg-surface-subtle p-3 text-xs text-ink-secondary">
            <Info className="size-4 shrink-0" aria-hidden />
            노쇼가 발생해도 예치 당시 인원으로 나누며 탑승자에게 부담을 재배분하지
            않습니다.
          </p>
        </Card>

        {settlement ? (
          <Card variant="surface" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>정산 미리보기</CardTitle>
              <StatusBadge variant="warning" label="잠정 결과" />
            </div>
            <Row
              label="실제 총요금"
              value={`${Number(settlement.effectiveActualFare).toLocaleString('ko-KR')}P`}
            />
            <Row
              label="정산 인원"
              value={`${settlement.participantCount}명`}
            />
            {currentParticipant ? (
              <Row
                label="내 예치금"
                value={`${Number(currentParticipant.depositAmount).toLocaleString('ko-KR')}P`}
              />
            ) : null}
            <Row
              label="내 최종 부담 (배분 결과)"
              value={`${Number(settlement.currentUserFinalShare).toLocaleString('ko-KR')}P`}
              strong
            />
            <Row
              label="요금 확인"
              value={`${settlement.confirmationCount}/${settlement.participantCount}명`}
            />
            <p className="border-t border-hairline pt-3 text-xs leading-relaxed text-ink-secondary">
              최종 부담액은 실제 요금과 확정 인원을 기준으로 개인별 배분된 결과이며, 단순 평균으로 표시하지 않습니다.
            </p>
          </Card>
        ) : null}

        {settlement && isPolicyV2 ? (
          <Card variant="subtle" className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{isProvisionallySettled ? '잠정 정산 상태' : '동의·이의제기 기한'}</CardTitle>
              <StatusBadge
                variant={isProvisionallySettled ? 'brand' : 'warning'}
                label={isProvisionallySettled ? '잠정 정산' : '확인 필요'}
              />
            </div>
            {isProvisionallySettled ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                잠정 정산이 기록되었습니다. 이의제기는{' '}
                <strong className="numeric text-ink">
                  {formatDeadline(settlement.disputeDeadline)}
                </strong>
                까지 접수할 수 있으며, 열린 이의가 없고 기한이 지나면 시스템이 최종 완료합니다.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                동의는 <strong className="numeric text-ink">{formatDeadline(settlement.confirmationDeadline)}</strong>
                까지 가능하며, 이의제기는{' '}
                <strong className="numeric text-ink">{formatDeadline(settlement.disputeDeadline)}</strong>
                까지 접수할 수 있습니다. 전원 동의 또는 동의 기한 만료 시 잠정 정산됩니다.
              </p>
            )}
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
          <div className="flex flex-col gap-2 rounded-[14px] bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">
            <StatusBadge variant="warning" label="최종 정산 보류" className="w-fit" />
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
                  className="min-h-11 bg-surface px-4 py-2 text-sm text-ink hover:bg-surface-subtle"
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
          className="flex min-h-12 items-center justify-center rounded-[14px] border border-hairline bg-surface px-6 py-3 text-base font-semibold text-ink"
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
      <span className={`numeric tabular-nums ${strong ? 'text-base font-bold' : 'font-semibold'}`}>
        {value}
      </span>
    </div>
  )
}

function formatDeadline(value: string | null) {
  if (!value) return '기한 확인 중'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}
