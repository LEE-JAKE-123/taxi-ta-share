import Link from 'next/link'
import { deactivateAdminUserAction } from './actions'
import { AdminUserDeactivationControl } from '@/components/admin/admin-user-deactivation-control'
import { AdminReadPage } from '@/components/admin/admin-read-page'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import { requireAdmin } from '@/lib/auth/session'
import {
  getAdminUsers,
  normalizeAdminUserStatusFilter,
} from '@/lib/admin/service'

const STATUS_FILTERS = [
  { value: 'ALL', label: '전체' },
  { value: 'ACTIVE', label: '활성' },
  { value: 'SUSPENDED', label: '이용 정지' },
  { value: 'DELETED', label: '비활성' },
] as const

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[]
    result?: string
  }>
}) {
  const admin = await requireAdmin()
  const { status, result } = await searchParams
  const filter = normalizeAdminUserStatusFilter(
    Array.isArray(status) ? status[0] : status,
  )
  const users = await getAdminUsers(admin.userId, filter)

  return (
    <AdminReadPage
      title="사용자·역할"
      description="관리자 전용 목록입니다. 마스킹된 사용자 식별 정보와 포인트·최근 서비스 기록을 확인하고, 조건을 만족하는 일반 사용자 계정만 이용 정지할 수 있습니다."
    >
      <nav
        aria-label="계정 상태 필터"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {STATUS_FILTERS.map((item) => {
          const selected = filter === item.value
          return (
            <Link
              key={item.value}
              href={item.value === 'ALL' ? '/admin/users' : `/admin/users?status=${item.value}`}
              aria-current={selected ? 'page' : undefined}
              className={
                selected
                  ? 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-[14px] bg-primary px-4 text-sm font-semibold text-primary-foreground'
                  : 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-[14px] border border-hairline bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              }
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <p className="text-sm text-muted-foreground" role="status">
        {statusFilterLabel(filter)} 사용자 {users.length}명
      </p>

      {result === 'scheduled' ? (
        <p className="rounded-[14px] border border-success/20 bg-success-soft px-4 py-3 text-sm text-success" role="status">
          관리자 지정 이용 정지를 기록했습니다. 진행 중인 이용이 있으면 최종 정산 뒤에 적용됩니다.
        </p>
      ) : null}
      {result === 'failed' ? (
        <p className="rounded-[14px] border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          이용 정지 지정에 실패했습니다. 계정 상태와 중복 요청 여부를 확인한 뒤 다시 시도하세요.
        </p>
      ) : null}

      <section className="flex flex-col gap-3" aria-label="사용자 목록">
        {users.length ? (
          users.map((user) => (
            <Card
              key={user.userId}
              className="flex flex-col gap-4 p-5 lg:flex-row lg:items-stretch lg:gap-5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="text-base font-bold text-ink">
                    {maskName(user.name)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    학번 {maskStudentId(user.studentId)}
                  </p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">사용 가능</dt>
                    <dd className="mt-1 font-semibold tabular-nums">
                      {Number(user.availablePoints).toLocaleString('ko-KR')}P
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">예치 포인트</dt>
                    <dd className="mt-1 font-semibold tabular-nums">
                      {Number(user.heldPoints).toLocaleString('ko-KR')}P
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">최근 서비스 기록</dt>
                    <dd className="mt-1 font-semibold">
                      {formatLastActivity(user.lastActivityAt)}
                    </dd>
                  </div>
                </dl>
              </div>

              <aside className="flex flex-row items-center justify-between gap-3 border-t border-hairline pt-4 lg:w-44 lg:flex-col lg:items-end lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
                <div className="text-right text-sm">
                  <p className="font-bold text-ink">{roleLabel(user.role)}</p>
                  <div className="mt-2">
                    <StatusBadge
                      variant={accountStatusVariant(user.accountStatus)}
                      label={`${accountStatusLabel(user.accountStatus)} · ${user.accountStatus}`}
                    />
                  </div>
                  {user.pendingSuspensionSource ? (
                    <p className="mt-1 text-xs font-semibold text-warn">
                      정지 예정 · {user.pendingSuspensionSource === 'REPORT' ? '신고 기반' : '관리자 지정'}
                    </p>
                  ) : null}
                </div>
                {user.role === 'USER' && user.accountStatus === 'ACTIVE' && !user.pendingSuspensionSource ? (
                  <AdminUserDeactivationControl
                    action={deactivateAdminUserAction}
                    userId={user.userId}
                    statusFilter={filter}
                  />
                ) : null}
              </aside>
            </Card>
          ))
        ) : (
          <Card className="p-4">
            <p className="font-semibold">표시할 사용자가 없습니다.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              다른 계정 상태를 선택해 다시 확인하세요.
            </p>
          </Card>
        )}
      </section>
    </AdminReadPage>
  )
}

function statusFilterLabel(status: (typeof STATUS_FILTERS)[number]['value']) {
  return STATUS_FILTERS.find((item) => item.value === status)?.label ?? '전체'
}

function roleLabel(role: string) {
  return role === 'ADMIN' ? '관리자 · ADMIN' : '사용자 · USER'
}

function accountStatusLabel(status: string) {
  if (status === 'ACTIVE') return '활성'
  if (status === 'SUSPENDED') return '이용 정지'
  if (status === 'DELETED') return '비활성'
  return status
}

function accountStatusVariant(status: string) {
  if (status === 'ACTIVE') return 'success' as const
  if (status === 'SUSPENDED') return 'warning' as const
  if (status === 'DELETED') return 'neutral' as const
  return 'neutral' as const
}

function formatLastActivity(value: string | null) {
  if (!value) return '이용 기록 없음'

  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return '이용 기록 확인 불가'
  if (elapsed < 60_000) return '방금 전'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`
  return `${Math.floor(elapsed / 86_400_000)}일 전`
}

function maskName(value: string) {
  const characters = Array.from(value)
  if (characters.length < 2) return value
  return `${characters[0]}${'*'.repeat(characters.length - 1)}`
}

function maskStudentId(value: string) {
  return value.length > 4 ? `${value.slice(0, 4)}*****` : '*****'
}
