import { AdminReadPage } from '@/components/admin/admin-read-page'
import { formatDeparture } from '@/components/database-room-card'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import { requireAdmin } from '@/lib/auth/session'
import { getAdminOperationsDashboard } from '@/lib/admin/service'

export default async function AdminOperationsPage() {
  const admin = await requireAdmin()
  const data = await getAdminOperationsDashboard(admin.userId)
  return (
    <AdminReadPage
      title="방 운영"
      description="실제 진행 중인 방의 최소 상태만 표시합니다. CONFIRMED 이후 강제 변경은 제공하지 않습니다."
    >
      {data.recentTrips.map((trip) => (
        <Card key={trip.tripId} className="p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">방 {trip.tripId.slice(0, 8)}</span>
            <StatusBadge
              variant={tripStatusVariant(trip.status)}
              label={`${tripStatusLabel(trip.status)} · ${trip.status}`}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            인원 {trip.participantCount}/{trip.maxParticipants}명 ·{' '}
            {formatDeparture(trip.departureAt)}
          </p>
        </Card>
      ))}
      {!data.recentTrips.length ? (
        <Card className="text-sm text-muted-foreground">운영 대상 방이 없습니다.</Card>
      ) : null}
    </AdminReadPage>
  )
}

function tripStatusLabel(status: string) {
  const labels: Record<string, string> = {
    OPEN: '모집 중',
    CLOSED: '모집 마감',
    CONFIRMED: '참여 확정',
    IN_PROGRESS: '이동 중',
    SETTLEMENT_PENDING: '정산 대기',
    COMPLETED: '완료',
    CANCELLED: '취소',
    EXPIRED: '만료',
  }
  return labels[status] ?? '상태 확인'
}

function tripStatusVariant(status: string) {
  if (status === 'COMPLETED') return 'success' as const
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'danger' as const
  if (status === 'OPEN' || status === 'CONFIRMED' || status === 'IN_PROGRESS') return 'brand' as const
  return 'warning' as const
}
