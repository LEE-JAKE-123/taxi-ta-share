import { Gift, ShieldCheck } from 'lucide-react'
import {
  approvePointGrantExecutionAction,
  executePointGrantExecutionAction,
  grantPointsAction,
  preparePointRequestFulfillmentAction,
} from '@/app/core/actions'
import { MobileShell } from '@/components/mobile-shell'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { TopBar } from '@/components/top-bar'
import { Card } from '@/components/ui/card'
import { getAdminPointDashboard } from '@/lib/core/service'
import { requireAdmin } from '@/lib/auth/session'

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

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const admin = await requireAdmin()
  const [{ message, error }, data] = await Promise.all([
    searchParams,
    getAdminPointDashboard(admin.userId),
  ])

  return (
    <MobileShell>
      <TopBar title="관리자 · 포인트 지급" backHref="/home" />
      <main className="flex-1 overflow-y-auto px-5 pb-10 pt-4">
        {message ? (
          <p
            role="status"
            className="mb-4 rounded-xl bg-mint-soft px-4 py-3 text-sm font-semibold text-foreground"
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-warn-soft px-4 py-3 text-sm font-semibold text-foreground"
          >
            {error}
          </p>
        ) : null}

        <Card className="mb-5 flex items-center gap-3 border-primary/30 bg-primary/5 p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">누적 지급 포인트</p>
            <p className="text-lg font-bold text-foreground">
              {formatPoints(data.totalGranted)}
            </p>
          </div>
        </Card>

        <form action={grantPointsAction}>
          <Card className="mb-7 flex flex-col gap-4 p-5">
            <h2 className="text-sm font-bold">직접 지급 실행 요청</h2>
            <p className="text-xs text-muted-foreground">
              다른 활성 관리자의 승인 후, 기안한 관리자가 원장 지급을 실행합니다.
            </p>
            <input
              type="hidden"
              name="idempotencyKey"
              value={crypto.randomUUID()}
            />
            <div>
              <label
                htmlFor="targetUserId"
                className="mb-1.5 block text-sm font-medium"
              >
                대상 사용자
              </label>
              <select
                id="targetUserId"
                name="targetUserId"
                className="app-input"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  사용자를 선택하세요
                </option>
                {data.users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.name} · {maskStudentId(user.studentId)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="amount" className="mb-1.5 block text-sm font-medium">
                지급 포인트
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
                placeholder="예: 30000"
                required
              />
            </div>
            <div>
              <label htmlFor="reason" className="mb-1.5 block text-sm font-medium">
                지급 사유
              </label>
              <input
                id="reason"
                name="reason"
                minLength={1}
                maxLength={200}
                className="app-input"
                placeholder="예: 정산 부족분 지원"
                required
              />
            </div>
            <PendingSubmitButton
              pendingLabel="지급 실행 요청을 만드는 중…"
              className="h-12 w-full gap-2 rounded-xl text-base font-semibold"
            >
              <Gift className="size-5" aria-hidden />
              지급 실행 요청 만들기
            </PendingSubmitButton>
          </Card>
        </form>

        <section className="mb-7" aria-labelledby="pending-request-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="pending-request-heading" className="text-sm font-bold">
              사용자 지급 요청 · 실행 기안 대기
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.unpreparedRequests.length}건
            </span>
          </div>
          {data.unpreparedRequests.length ? (
            <div className="flex flex-col gap-3">
              {data.unpreparedRequests.map((request) => (
                <Card key={request.requestId} className="p-4">
                  <p className="text-sm font-semibold">
                    {request.name} · {request.studentId}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.reason}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-extrabold text-primary">
                        {formatPoints(request.requestedAmount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(request.requestedAt)}
                      </p>
                    </div>
                    <form action={preparePointRequestFulfillmentAction}>
                      <input
                        type="hidden"
                        name="requestId"
                        value={request.requestId}
                      />
                      <input
                        type="hidden"
                        name="idempotencyKey"
                        value={crypto.randomUUID()}
                      />
                      <PendingSubmitButton
                        pendingLabel="실행 요청을 만드는 중…"
                        className="min-h-11 w-auto px-4"
                        ariaLabel={`${request.name} ${formatPoints(request.requestedAmount)} 지급 실행 요청 만들기`}
                      >
                        실행 요청 만들기
                      </PendingSubmitButton>
                    </form>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4 text-sm text-muted-foreground">
              실행 기안 대기 중인 사용자 요청이 없습니다.
            </Card>
          )}
        </section>

        <section className="mb-7" aria-labelledby="approval-queue-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="approval-queue-heading" className="text-sm font-bold">
              독립 승인 대기
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.approvalQueue.length}건
            </span>
          </div>
          {data.approvalQueue.length ? (
            <div className="flex flex-col gap-3">
              {data.approvalQueue.map((request) => (
                <Card key={request.executionRequestId} className="p-4">
                  <p className="text-sm font-semibold">
                    {request.targetName} · {maskStudentId(request.targetStudentId)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    기안 관리자 {request.requestedByName} · {request.reason}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-extrabold text-primary">
                        {formatPoints(request.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(request.createdAt)}
                      </p>
                    </div>
                    <form action={approvePointGrantExecutionAction}>
                      <input type="hidden" name="executionRequestId" value={request.executionRequestId} />
                      <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                      <PendingSubmitButton
                        pendingLabel="독립 승인 중…"
                        className="min-h-11 w-auto px-4"
                        ariaLabel={`${request.targetName} ${formatPoints(request.amount)} 지급 기안 독립 승인`}
                      >
                        독립 승인
                      </PendingSubmitButton>
                    </form>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4 text-sm text-muted-foreground">
              독립 승인을 기다리는 지급 실행 요청이 없습니다.
            </Card>
          )}
        </section>

        <section className="mb-7" aria-labelledby="execution-queue-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="execution-queue-heading" className="text-sm font-bold">
              내가 실행할 승인 완료 지급
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.executionQueue.length}건
            </span>
          </div>
          {data.executionQueue.length ? (
            <div className="flex flex-col gap-3">
              {data.executionQueue.map((request) => (
                <Card key={request.executionRequestId} className="p-4">
                  <p className="text-sm font-semibold">
                    {request.targetName} · {maskStudentId(request.targetStudentId)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    승인 관리자 {request.approverName} · {request.reason}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-extrabold text-primary">
                        {formatPoints(request.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        승인 {formatDate(request.approvedAt)}
                      </p>
                    </div>
                    <form action={executePointGrantExecutionAction}>
                      <input type="hidden" name="executionRequestId" value={request.executionRequestId} />
                      <PendingSubmitButton
                        pendingLabel="원장 지급을 실행하는 중…"
                        className="min-h-11 w-auto px-4"
                        ariaLabel={`${request.targetName} ${formatPoints(request.amount)} 승인 완료 지급 원장 실행`}
                      >
                        원장 지급 실행
                      </PendingSubmitButton>
                    </form>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4 text-sm text-muted-foreground">
              내가 실행할 승인 완료 지급이 없습니다.
            </Card>
          )}
        </section>

        <section aria-labelledby="grant-history-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="grant-history-heading" className="text-sm font-bold">
              지급 원장
            </h2>
            <span className="text-xs text-muted-foreground">
              최근 {data.grants.length}건
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {data.grants.map((grant) => (
              <Card
                key={grant.ledgerId}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {grant.targetName} · {grant.targetStudentId}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {grant.reason}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    실행 {grant.executorName}
                    {grant.approverName ? ` · 승인 ${grant.approverName}` : ' · 이전 지급 기록'}
                    {' · '}{formatDate(grant.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold text-mint">
                  +{formatPoints(grant.amount)}
                </span>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </MobileShell>
  )
}

function maskStudentId(value: string) {
  return `${value.slice(0, 4)}*****`
}
