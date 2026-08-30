import { ArrowDownLeft, ArrowUpRight, Coins, Info } from 'lucide-react'
import { requestPointsAction } from '@/app/core/actions'
import { MobileShell } from '@/components/mobile-shell'
import { StatusBadge } from '@/components/status-badge'
import { TabBar } from '@/components/tab-bar'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { requireCompleteUser } from '@/lib/auth/session'
import { getPointDashboard } from '@/lib/core/service'
import { cn } from '@/lib/utils'

function formatPoints(value: number) {
  return `${Number(value).toLocaleString('ko-KR')}P`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

const ENTRY_LABELS = {
  ADMIN_GRANT: '관리자 지급',
  DEPOSIT: '예상 요금 예치',
  SETTLEMENT_CHARGE: '최종 정산',
  REFUND: '예치금 반환',
  ADDITIONAL_DEBIT: '정산 추가 차감',
} as const

export default async function PointsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const user = await requireCompleteUser()
  const [{ message, error }, data] = await Promise.all([
    searchParams,
    getPointDashboard(user.userId),
  ])
  const totalPoints =
    data.balance.availablePoints + data.balance.heldPoints

  return (
    <MobileShell>
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface px-5 py-4">
        <h1 className="text-xl font-bold">포인트</h1>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-5 py-5">
        {message ? (
          <p
            role="status"
            className="rounded-[14px] bg-success-soft px-4 py-3 text-sm font-semibold text-success"
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-[14px] bg-warning-soft px-4 py-3 text-sm font-semibold text-warning"
          >
            {error}
          </p>
        ) : null}

        <Card variant="dark" className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-[14px] bg-white/10 text-white">
              <Coins className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium text-white/70">총 보유 포인트 (사용 가능 + 예치 중)</p>
              <p className="numeric text-[28px] font-bold leading-tight">
                {formatPoints(totalPoints)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3">
              <p className="text-xs font-medium text-white/70">사용 가능</p>
              <p className="numeric mt-1 text-lg font-semibold">{formatPoints(data.balance.availablePoints)}</p>
              <p className="mt-1 text-xs text-white/70">새 모집과 정산에 사용할 수 있어요.</p>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3">
              <p className="text-xs font-medium text-white/70">예치 중</p>
              <p className="numeric mt-1 text-lg font-semibold">{formatPoints(data.balance.heldPoints)}</p>
              <p className="mt-1 text-xs text-white/70">이동 완료 뒤 정산 결과에 따라 반영돼요.</p>
            </div>
          </div>
        </Card>

        <Card variant="subtle" className="flex items-start gap-2 p-4 text-xs leading-relaxed">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          포인트는 관리자가 지급하는 서비스 내 가상 단위이며 구매·환전할 수
          없습니다.
        </Card>

        <form action={requestPointsAction}>
          <Card variant="surface" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>포인트 지급 요청</CardTitle>
              <StatusBadge variant="neutral" label="관리자 지급만 가능" />
            </div>
            <p className="text-xs text-muted-foreground">
              예치 또는 정산에 포인트가 부족하면 관리자에게 요청하세요.
            </p>
            <input
              type="hidden"
              name="idempotencyKey"
              value={crypto.randomUUID()}
            />
            <div>
              <label htmlFor="amount" className="mb-1.5 block text-sm font-semibold">
                요청 포인트
              </label>
              <input
                id="amount"
                name="amount"
                type="number"
                inputMode="numeric"
                min={1}
                max={1_000_000}
                step={1}
                className="app-input"
                required
              />
            </div>
            <div>
              <label htmlFor="reason" className="mb-1.5 block text-sm font-semibold">
                요청 사유
              </label>
              <input
                id="reason"
                name="reason"
                minLength={1}
                maxLength={200}
                className="app-input"
                placeholder="예: 참여 확정 예치금 부족"
                required
              />
            </div>
            <Button type="submit" className="min-h-11 w-full">
              관리자에게 요청
            </Button>
          </Card>
        </form>

        {data.requests.length ? (
          <section aria-labelledby="request-history-heading">
            <h2 id="request-history-heading" className="mb-3 text-lg font-semibold">
              최근 지급 요청
            </h2>
            <Card variant="surface" className="gap-0 p-0">
              {data.requests.map((request, index) => (
                <div
                  key={request.requestId}
                  className={cn(
                    'flex items-center justify-between gap-3 px-4 py-3.5',
                    index !== data.requests.length - 1 &&
                      'border-b border-border',
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {request.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(request.requestedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">
                      {formatPoints(request.requestedAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {request.status === 'PENDING' ? '처리 대기' : '지급 완료'}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        ) : null}

        {data.escrowShortfalls.length ? (
          <section aria-labelledby="escrow-shortfall-heading">
            <h2 id="escrow-shortfall-heading" className="mb-3 text-lg font-semibold">
              예치 부족분
            </h2>
            <Card variant="surface" className="gap-0 p-0">
              {data.escrowShortfalls.map((shortfall, index) => (
                <div
                  key={shortfall.shortfallId}
                  className={cn(
                    'flex items-center justify-between gap-3 px-4 py-3.5',
                    index !== data.escrowShortfalls.length - 1 &&
                      'border-b border-border',
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {shortfall.status === 'OPEN' ? '정산 상계 대기' : '정산 상계 완료'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      예상 예치 {formatPoints(shortfall.expectedDepositPoints)} · {formatDate(shortfall.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">
                      {formatPoints(shortfall.outstandingPoints)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shortfall.status === 'OPEN' ? '정산 대기' : '상계됨'}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="ledger-heading">
          <h2 id="ledger-heading" className="mb-3 text-lg font-semibold">
            포인트 원장
          </h2>
          {data.ledger.length ? (
            <Card variant="surface" className="gap-0 p-0">
              {data.ledger.map((entry, index) => {
                const availableDelta = Number(entry.availableDelta)
                const heldDelta = Number(entry.heldDelta)
                return (
                  <div
                    key={entry.ledgerId}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3.5',
                      index !== data.ledger.length - 1 &&
                        'border-b border-border',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-9 items-center justify-center rounded-full',
                        availableDelta >= 0
                          ? 'bg-success-soft text-success'
                          : 'bg-warning-soft text-warning',
                      )}
                    >
                      {availableDelta >= 0 ? (
                        <ArrowDownLeft className="size-4" aria-hidden />
                      ) : (
                        <ArrowUpRight className="size-4" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {ENTRY_LABELS[entry.entryType]}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.reason} · {formatDate(entry.createdAt)}
                      </p>
                    </div>
                    <div className="numeric shrink-0 text-right text-xs font-semibold tabular-nums">
                      {availableDelta ? (
                        <p
                          className={
                            availableDelta > 0 ? 'text-success' : 'text-warning'
                          }
                        >
                          사용 가능 {availableDelta > 0 ? '+' : ''}
                          {formatPoints(availableDelta)}
                        </p>
                      ) : null}
                      {heldDelta ? (
                        <p className="text-muted-foreground">
                          예치 {heldDelta > 0 ? '+' : ''}
                          {formatPoints(heldDelta)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </Card>
          ) : (
            <Card variant="subtle" className="p-4 text-sm text-ink-secondary">
              아직 포인트 거래 내역이 없습니다.
            </Card>
          )}
        </section>
      </main>

      <TabBar />
    </MobileShell>
  )
}
