import { AdminReadPage } from '@/components/admin/admin-read-page'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'

const checks = [
  ['운영 환경 식별', process.env.APP_ENVIRONMENT === 'production'],
  ['런타임 DB', Boolean(process.env.DATABASE_URL)],
  ['마이그레이션 DB', isDatabaseUrl(process.env.DATABASE_MIGRATION_URL)],
  ['세션 비밀값', Boolean(process.env.SESSION_SECRET)],
  ['지도 공급자', Boolean(process.env.MAP_PROVIDER)],
] as const

export default function AdminReleasePage() {
  return (
    <AdminReadPage
      title="출시 점검"
      description="비밀값 자체는 표시하지 않고 현재 배포에 설정됐는지만 확인합니다."
    >
      {checks.map(([label, ready]) => (
        <Card key={label} className="flex items-center justify-between gap-4 p-5">
          <span className="font-semibold text-ink">{label}</span>
          <StatusBadge
            variant={ready ? 'success' : 'warning'}
            label={ready ? '설정됨' : '확인 필요'}
            helper={ready ? '구성 값 감지' : '구성 값 미감지'}
          />
        </Card>
      ))}
    </AdminReadPage>
  )
}

function isDatabaseUrl(value: string | undefined) {
  if (!value) return false
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
