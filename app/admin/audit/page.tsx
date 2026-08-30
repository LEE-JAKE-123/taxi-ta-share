import { AdminReadPage } from '@/components/admin/admin-read-page'
import { Card } from '@/components/ui/card'
import { requireAdmin } from '@/lib/auth/session'
import { getAdminOperationsDashboard } from '@/lib/admin/service'

const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

export default async function AdminAuditPage() {
  const admin = await requireAdmin()
  const data = await getAdminOperationsDashboard(admin.userId)
  return (
    <AdminReadPage
      title="감사 로그"
      description="전용 AdminAuditLog는 후속 스키마입니다. 현재는 삭제할 수 없는 포인트 원장의 안전한 요약만 표시합니다."
    >
      {data.recentLedger.map((entry) => (
        <Card key={entry.ledgerId} className="p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">{entry.entryType}</span>
            <span className="font-semibold tabular-nums">{Number(entry.availableDelta).toLocaleString('ko-KR')}P</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {entry.ledgerId.slice(0, 8)} ·{' '}
            {KST_DATE_TIME.format(new Date(entry.createdAt))}
          </p>
        </Card>
      ))}
    </AdminReadPage>
  )
}
