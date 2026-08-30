import { Gift, ShieldCheck } from 'lucide-react'
import {
  approvePointGrantExecutionAction,
  executePointGrantExecutionAction,
  grantPointsAction,
  preparePointRequestFulfillmentAction,
} from '@/app/core/actions'
import { MobileShell } from '@/components/mobile-shell'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { StatusBadge } from '@/components/status-badge'
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
      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col overflow-y-auto px-4 pb-10 pt-4 sm:px-5">
        {message ? (
          <p
            role="status"
            className="mb-4 rounded-[14px] border border-success/20 bg-success-soft px-4 py-3 text-sm font-semibold text-foreground"
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-[14px] border border-warning/20 bg-warning-soft px-4 py-3 text-sm font-semibold text-foreground"
          >
            {error}
          </p>
        ) : null}

        <Card variant="subtle" className="mb-5 flex items-center gap-3 p-4">
          <div className="flex size-10 items-center justify-center rounded-[14px] bg-brand-soft text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">누적 지급 포인트</p>
              <StatusBadge variant="brand" label="관리자 지급 전용" />
            </div>
            <p className="numeric mt-1 text-lg font-semibold text-foreground">
              {formatPoints(data.totalGranted)}
            </p>
          </div>
        </Card>

        <form action={grantPointsAction}>
          <Card variant="selected" className="mb-7 flex flex-col gap-4 p-5" aria-labelledby="direct-grant-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="direct-grant-heading" className="text-base font-semibold">직접 지급 실행 요청</h2>
              <StatusBadge variant="warning" label="1단계 · 실행 기안" />
            </div>
            <p className="text-xs text-muted-foreground">
              기안 관리자 {admin.name}이 요청을 만들면, 다른 활성 관리자의 독립 승인 후 기안한 관리자가 원장 지급을 실행합니다.
            </p>
            <p className="rounded-[14px] border border-warning/20 bg-warning-soft px-3 py-2 text-xs leading-5 text-foreground">
              이용 정지된 대상은 정산 채무 상환 전용으로만 표시됩니다. 상환
              지원은 현재 남아 있는 정산 채무와 정확히 같은 금액으로만 가능하며,
              포인트 지급만으로 이용 정지가 해제되지는 않습니다.
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
                    {user.accountStatus === 'SUSPENDED'
                      ? ` · 이용 정지 · 정산 채무 상환 전용 (${formatPoints(user.settlementDebtOutstanding)})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium">
                지급 목적
              </label>
              <select
                id="purpose"
                name="purpose"
                className="app-input"
                required
                defaultValue="GENERAL"
              >
                <option value="GENERAL">일반 포인트 지급</option>
                <option value="SETTLEMENT_DEBT_REPAYMENT">
                  정산 채무 상환 지원
                </option>
              </select>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                이용 정지된 사용자는 ‘정산 채무 상환 지원’으로만 지급할 수
                있습니다. 실제 허용 대상과 금액은 서버가 다시 확인합니다.
              </p>
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
              className="h-12 w-full gap-2 text-base font-semibold"
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
                <Card key={request.requestId} variant="surface" className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      {request.name} · {request.studentId}
                    </p>
                    <StatusBadge variant="neutral" label="1단계 · 기안 대기" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.reason}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    요청자 {request.name} · 요청 {formatDate(request.requestedAt)}
                  </p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="numeric font-semibold text-ink">
                        +{formatPoints(request.requestedAmount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        실행 기안 전 · 원장 미기록
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
            <Card variant="subtle" className="p-4 text-sm text-muted-foreground">
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
                <Card key={request.executionRequestId} variant="surface" className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      {request.targetName} · {maskStudentId(request.targetStudentId)}
                    </p>
                    <StatusBadge variant="warning" label="2단계 · 독립 승인 대기" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    기안 관리자 {request.requestedByName} · {request.reason}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    기안 {formatDate(request.createdAt)} · 원장 미기록
                  </p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="numeric font-semibold text-ink">
                        +{formatPoints(request.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        다른 활성 관리자의 승인 필요
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
            <Card variant="subtle" className="p-4 text-sm text-muted-foreground">
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
                <Card key={request.executionRequestId} variant="surface" className="border-warning p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      {request.targetName} · {maskStudentId(request.targetStudentId)}
                    </p>
                    <StatusBadge variant="warning" label="3단계 · 원장 실행 가능" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    승인 관리자 {request.approverName} · {request.reason}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    승인 {formatDate(request.approvedAt)} · 실행 예정 관리자 {admin.name}
                  </p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="numeric font-semibold text-ink">
                        +{formatPoints(request.amount)}
                      </p>
                      <p className="text-xs text-warning">
                        원장에 실제 지급을 기록하는 단계
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
            <Card variant="subtle" className="p-4 text-sm text-muted-foreground">
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
                variant="surface"
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
                <span className="numeric shrink-0 text-sm font-semibold text-success">
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
