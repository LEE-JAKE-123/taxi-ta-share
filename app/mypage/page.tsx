import Link from 'next/link'
import {
  ChevronRight,
  GraduationCap,
  LogOut,
  MessageCircleQuestion,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { MobileShell } from '@/components/mobile-shell'
import { TabBar } from '@/components/tab-bar'
import { TopBar } from '@/components/top-bar'
import { Card } from '@/components/ui/card'
import { requireCompleteUser } from '@/lib/auth/session'
import { getMyPageBalanceSummary } from '@/lib/core/service'
import { logoutAction } from './actions'

function formatPoints(value: number) {
  return `${value.toLocaleString('ko-KR')}P`
}

function maskStudentId(studentId: string) {
  return studentId.length > 2
    ? `${studentId.slice(0, 2)}${'•'.repeat(studentId.length - 2)}`
    : studentId
}

export default async function MyPage() {
  const user = await requireCompleteUser()
  const balance = await getMyPageBalanceSummary(user.userId)
  const totalPoints = balance.availablePoints + balance.heldPoints

  return (
    <MobileShell>
      <TopBar
        title="마이페이지"
        backHref="/home"
        right={
          user.role === 'ADMIN' ? (
            <Link
              href="/admin"
              className="flex min-h-11 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              관리자
            </Link>
          ) : null
        }
      />

      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6 pt-4">
        <Card className="flex items-center gap-4 p-5">
          <div
            className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-lg font-bold text-primary"
            aria-hidden
          >
            {user.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-foreground">{user.name}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <GraduationCap className="size-3.5" aria-hidden />
              학번 {maskStudentId(user.studentId)}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {user.schoolEmail}
            </p>
          </div>
        </Card>

        <section aria-labelledby="point-balance-heading">
          <Link
            href="/points"
            aria-label={`포인트 상세 보기: 사용 가능 ${formatPoints(balance.availablePoints)}, 예치 중 ${formatPoints(balance.heldPoints)}`}
            className="block rounded-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Card className="p-5 transition-colors hover:bg-muted">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-mint-soft text-mint">
                    <Wallet className="size-5" aria-hidden />
                  </span>
                  <div>
                    <h2 id="point-balance-heading" className="text-sm font-bold">
                      포인트 잔액
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      상세 내역 보기
                    </p>
                  </div>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted px-3 py-3">
                  <dt className="text-xs text-muted-foreground">사용 가능</dt>
                  <dd className="mt-1 text-lg font-bold text-foreground">
                    {formatPoints(balance.availablePoints)}
                  </dd>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <dt className="text-xs text-muted-foreground">예치 중</dt>
                  <dd className="mt-1 text-lg font-bold text-foreground">
                    {formatPoints(balance.heldPoints)}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-xs text-muted-foreground">
                총 {formatPoints(totalPoints)} · 포인트는 서비스 내 가상 정산 단위입니다.
              </p>
            </Card>
          </Link>
        </section>

        {balance.heldPoints > 0 ? (
          <p className="flex items-start gap-2 rounded-2xl bg-secondary/50 px-4 py-3 text-xs leading-relaxed text-secondary-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            예치 중인 포인트는 이동 완료 후 최종 정산 결과에 따라 반환되거나 사용됩니다.
          </p>
        ) : null}

        <Link
          href="/support"
          className="flex min-h-12 items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex items-center gap-2">
            <MessageCircleQuestion className="size-4 text-info" aria-hidden />
            고객 문의
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>

        <form action={logoutAction} className="mt-2">
          <button
            type="submit"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <LogOut className="size-4" aria-hidden />
            로그아웃
          </button>
        </form>
      </main>

      <TabBar />
    </MobileShell>
  )
}
