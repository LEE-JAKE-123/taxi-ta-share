import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { MobileShell } from '@/components/mobile-shell'
import { TopBar } from '@/components/top-bar'
import { Card, CardTitle } from '@/components/ui/card'
import { requireCompleteUser } from '@/lib/auth/session'
import { CoreError, getTripJourney } from '@/lib/core/service'

export const dynamic = 'force-dynamic'

const ledgerLabels: Record<string, string> = {
  FARE_ADJUSTMENT_REFUND: '요금 보정 반환',
  FARE_ADJUSTMENT_DEBIT: '요금 보정 추가 차감',
  DEPOSIT: '예상 요금 예치',
  SETTLEMENT_CHARGE: '예치금 최종 정산',
  REFUND: '정산 차액 반환',
  ADDITIONAL_DEBIT: '정산 부족분 추가 차감',
}

export default async function SettleCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string }>
}) {
  const user = await requireCompleteUser()
  const [{ id }, query] = await Promise.all([params, searchParams])
  const journey = await getJourney(user.userId, id)
  const { trip, settlement, ledger, participants } = journey
  if (trip.status !== 'COMPLETED' || settlement?.status !== 'COMPLETED') {
    notFound()
  }
  const noShowCount = participants.filter(
    (participant) => participant.noShowAt !== null,
  ).length

  return (
    <MobileShell withTabBar={false}>
      <TopBar title="정산 결과" backHref="/my-rooms" />
      <main className="flex flex-1 flex-col gap-4 px-5 py-6 pb-28">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-20 items-center justify-center rounded-full bg-mint text-mint-foreground">
            <CheckCircle2 className="size-11" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold">정산을 완료했습니다</h1>
          {query.message ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {query.message}
            </p>
          ) : null}
        </div>

        <Card className="gap-3">
          <div className="flex items-center justify-center gap-2 text-sm font-bold">
            <span>{trip.origin}</span>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
            <span>{trip.destination}</span>
          </div>
          <Row
            label="실제 총요금"
            value={`${Number(settlement.effectiveActualFare).toLocaleString('ko-KR')}P`}
          />
          <Row label="정산 인원" value={`${settlement.participantCount}명`} />
          <Row
            label="노쇼 인원"
            value={`${noShowCount}명`}
          />
          <Row
            label="1인 최종 부담"
            value={`${Number(settlement.currentUserFinalShare).toLocaleString('ko-KR')}P`}
            strong
          />
          <Row label="정산 상태" value="정산 완료" strong />
        </Card>

        {settlement.hasFareAdjustment ? (
          <p className="rounded-xl bg-info-soft px-4 py-3 text-sm" role="status">
            관리자 요금 보정이 반영된 최종 결과입니다. 보정 내역은 아래 포인트 거래에서 확인할 수 있습니다.
          </p>
        ) : null}

        <section>
          <CardTitle className="mb-3">내 포인트 거래 내역</CardTitle>
          <Card className="gap-3">
            {ledger.map((entry, index) => (
              <div
                key={`${entry.entryType}-${index}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>{ledgerLabels[entry.entryType] ?? entry.reason}</span>
                <span className="text-right font-semibold">
                  {Number(entry.availableDelta) !== 0
                    ? `${Number(entry.availableDelta) > 0 ? '+' : ''}${Number(entry.availableDelta).toLocaleString('ko-KR')}P`
                    : `${Number(entry.heldDelta).toLocaleString('ko-KR')}P 예치`}
                </span>
              </div>
            ))}
          </Card>
        </section>

        <Link
          href="/home"
          className="flex min-h-12 items-center justify-center rounded-full bg-primary px-6 py-3 text-[17px] text-primary-foreground"
        >
          홈으로 돌아가기
        </Link>
      </main>
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
