import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Coins,
  Route,
  ShieldCheck,
} from 'lucide-react'
import { MobileShell } from '@/components/mobile-shell'
import { TopBar } from '@/components/top-bar'
import { AdminDashboardVisuals } from '@/components/admin/admin-dashboard-visuals'
import { StatusBadge } from '@/components/status-badge'
import { Card } from '@/components/ui/card'
import { requireAdmin } from '@/lib/auth/session'
import {
  getAdminOperationsDashboard,
  getAdminSafetyDashboard,
  getAdminUsageOverview,
} from '@/lib/admin/service'

export default async function AdminDashboardPage() {
  const admin = await requireAdmin()
  const operations = await getAdminOperationsDashboard(admin.userId)
  let analyticsSeriesByMetric: Awaited<ReturnType<typeof getAdminUsageOverview>> | null =
    null
  try {
    analyticsSeriesByMetric = await getAdminUsageOverview(admin.userId)
  } catch {
    // Keep the operational dashboard available when analytics cannot be read.
  }
  let safety: Awaited<ReturnType<typeof getAdminSafetyDashboard>> | null = null
  try {
    safety = await getAdminSafetyDashboard(admin.userId)
  } catch {
    // 안전 큐 조회 실패는 다른 관리자 조치 큐의 접근을 막지 않는다.
  }
  const count = (status: string) =>
    Number(operations.tripCounts.find((item) => item.status === status)?.count ?? 0)
  const operatingTrips = ['OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS'].reduce(
    (total, status) => total + count(status),
    0,
  )
  const tripStatuses = [
    ['OPEN', '모집 중'],
    ['CLOSED', '모집 종료'],
    ['CONFIRMED', '출발 확정'],
    ['IN_PROGRESS', '이동 중'],
    ['SETTLEMENT_PENDING', '정산 대기'],
  ].map(([status, label]) => ({ status, label, count: count(status) }))
  const safetyQueueCount = safety
    ? Number(safety.counts.reportCount) + Number(safety.counts.ticketCount)
    : null

  return (
    <MobileShell withTabBar={false}>
      <TopBar title="관리자 운영 대시보드" backHref="/home" />
      <main className="grid flex-1 gap-6 px-4 py-5 sm:px-5 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,5fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card variant="subtle" className="flex items-center gap-3 p-4 lg:min-h-36">
            <div className="flex size-10 items-center justify-center rounded-[14px] bg-brand-soft text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">현재 관리자</p>
                <StatusBadge variant="brand" label="관리자 세션" />
              </div>
              <p className="mt-1 font-semibold">{admin.name}</p>
            </div>
          </Card>

          <section aria-labelledby="action-required-heading">
            <div className="mb-3">
              <h2 id="action-required-heading" className="text-lg font-bold">
                조치 필요
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                관리자 확인 또는 처리가 필요한 항목입니다.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <QueueLink
                href="/admin/points"
                icon={Coins}
                label="포인트 지급 요청"
                description="처리 대기 중인 지급 요청"
                count={operations.queues.pointRequests}
                tone="warning"
              />
              <QueueLink
                href="/admin/settlements"
                icon={AlertTriangle}
                label="실제 요금 이의"
                description="관리자 검토가 필요한 정산"
                count={operations.queues.openDisputes}
                tone="warning"
              />
              <QueueLink
                href="/admin/reports"
                icon={ShieldCheck}
                label="안전 신고·고객 문의"
                description={
                  safety
                    ? '접수 또는 검토 중인 운영 요청'
                    : '현황을 불러오지 못했습니다. 목록에서 다시 확인하세요.'
                }
                count={safetyQueueCount}
                tone="warning"
              />
            </div>
          </section>

          <section aria-labelledby="monitoring-heading">
            <div className="mb-3">
              <h2 id="monitoring-heading" className="text-lg font-bold">
                모니터링
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                참여자 진행을 기다리거나 운영 현황을 확인하는 항목입니다.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <QueueLink
                href="/admin/settlements"
                icon={ClipboardCheck}
                label="정산 확인 대기"
                description="참여자 확인이 진행 중인 정산"
                count={operations.queues.pendingSettlements}
                tone="brand"
              />
              <QueueLink
                href="/admin/operations"
                icon={Activity}
                label="운영 중인 모집"
                description="모집부터 이동 중까지의 현황"
                count={operatingTrips}
                tone="brand"
              />
            </div>
          </section>

          <section aria-labelledby="trip-status-heading">
            <div className="mb-3 flex items-center gap-2">
              <Route className="size-5 text-primary" aria-hidden />
              <h2 id="trip-status-heading" className="text-lg font-bold">
                모집 상태 요약
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {tripStatuses.map(({ status, label, count: statusCount }) => (
                <Card key={status} variant="surface" className="p-4">
                  <StatusBadge
                    variant={status === 'IN_PROGRESS' ? 'brand' : 'neutral'}
                    label={`${label} · ${status}`}
                  />
                  <p className="numeric mt-3 text-2xl font-semibold">{statusCount}건</p>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <AdminDashboardVisuals
          seriesByMetric={analyticsSeriesByMetric}
        />
      </main>
    </MobileShell>
  )
}

function QueueLink({
  href,
  icon: Icon,
  label,
  description,
  count,
  tone,
}: {
  href: string
  icon: typeof Coins
  label: string
  description: string
  count: number | null
  tone: 'warning' | 'brand'
}) {
  const isActionRequired = tone === 'warning'

  return (
    <Link
      href={href}
      className="block h-full rounded-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card variant="interactive" className="flex h-full items-center gap-3 p-4">
        <Icon
          className={`size-5 shrink-0 ${isActionRequired ? 'text-warning' : 'text-brand'}`}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{label}</p>
            <StatusBadge
              variant={tone}
              label={isActionRequired ? '조치 필요' : '운영 현황'}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          <p className="numeric mt-2 text-sm font-semibold">
            {count === null ? '확인 필요' : `${Number(count)}건`}
          </p>
        </div>
      </Card>
    </Link>
  )
}
