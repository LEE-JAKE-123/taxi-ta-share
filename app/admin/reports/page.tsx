import { randomUUID } from 'node:crypto'
import {
  resolveSupportInquiryAction,
  resolveUserReportAction,
} from '@/app/core/actions'
import { AdminReadPage } from '@/components/admin/admin-read-page'
import { EmptyState } from '@/components/empty-state'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { StatusBadge } from '@/components/status-badge'
import { Card } from '@/components/ui/card'
import { requireAdmin } from '@/lib/auth/session'
import { getAdminSafetyDashboard } from '@/lib/admin/service'

type ReportStatus = 'SUBMITTED' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED'
type TicketStatus = 'SUBMITTED' | 'IN_REVIEW' | 'ANSWERED' | 'CLOSED'

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const admin = await requireAdmin()
  const [{ message, error }, dashboard] = await Promise.all([
    searchParams,
    getAdminSafetyDashboard(admin.userId),
  ])

  return (
    <AdminReadPage
      title="신고 및 고객 문의"
      description="신고자와 증빙 정보는 운영 검토 목적으로만 사용합니다. 처리 결과와 메모는 서버에서 감사 기록으로 남습니다."
    >
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section aria-labelledby="report-queue-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 id="report-queue-heading" className="text-lg font-extrabold">
              사용자 신고
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              대상 사용자와 일반 사용자에게 신고 내용이나 신고자 정보는 공개되지 않습니다.
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-muted-foreground">
            {dashboard.reports.length}건
          </span>
        </div>

        {dashboard.reports.length ? (
          dashboard.reports.map((report) => (
            <Card key={report.reportId} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">
                    {report.reportedName ?? '모집 관련 신고'}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    접수 {formatDate(report.createdAt)} · 신고자 {report.reporterName}
                  </p>
                </div>
                <ReportStatusBadge status={report.status as ReportStatus} />
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">신고 사유</dt>
                  <dd className="mt-1 font-semibold">{report.reasonCode}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">관련 모집</dt>
                  <dd className="mt-1 break-all font-semibold">
                    {report.tripId ? `#${report.tripId.slice(0, 8)}` : '없음'}
                  </dd>
                </div>
              </dl>

              <p className="rounded-xl bg-muted px-3 py-3 text-sm leading-relaxed">
                {report.description}
              </p>
              {report.evidenceRef ? (
                <p className="text-xs text-muted-foreground">
                  증빙 참조: {report.evidenceRef}
                </p>
              ) : null}

              {!isReportTerminal(report.status) ? (
                <form action={resolveUserReportAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="reportId" value={report.reportId} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <label htmlFor={`report-outcome-${report.reportId}`} className="text-sm font-semibold">
                    처리 결과
                  </label>
                  <select
                    id={`report-outcome-${report.reportId}`}
                    name="outcome"
                    className="app-input"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>처리 결과를 선택하세요</option>
                    <option value="IN_REVIEW">검토 중으로 변경</option>
                    <option value="RESOLVED">조치 완료</option>
                    <option value="DISMISSED">종결 (조치 없음)</option>
                    {report.reportedName ? (
                      <option value="SUSPENDED">이용 정지 및 신고 처리</option>
                    ) : null}
                  </select>
                  {report.reportedName ? (
                    <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                      이용 정지를 선택하면 대상 계정이 즉시 정지되고, 현재 로그인 세션도 해제됩니다. 이 조치는 신고 처리 감사 기록에 남습니다.
                    </p>
                  ) : null}
                  <label htmlFor={`report-note-${report.reportId}`} className="text-sm font-semibold">
                    운영 메모
                  </label>
                  <textarea
                    id={`report-note-${report.reportId}`}
                    name="resolutionNote"
                    className="app-input min-h-24 resize-y"
                    maxLength={1000}
                    required
                  />
                  <PendingSubmitButton pendingLabel="처리 결과를 저장하는 중…">
                    신고 처리 저장
                  </PendingSubmitButton>
                </form>
              ) : null}
            </Card>
          ))
        ) : (
          <EmptyState label="검토할 사용자 신고가 없습니다." />
        )}
      </section>

      <section aria-labelledby="support-queue-heading" className="mt-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 id="support-queue-heading" className="text-lg font-extrabold">
              고객 문의
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              일반 지원 요청은 안전 신고와 별도 티켓으로 처리합니다.
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-muted-foreground">
            {dashboard.tickets.length}건
          </span>
        </div>

        {dashboard.tickets.length ? (
          dashboard.tickets.map((ticket) => (
            <Card key={ticket.ticketId} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{ticket.subject}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ticket.category} · 접수 {formatDate(ticket.createdAt)} · {ticket.requesterName}
                  </p>
                </div>
                <TicketStatusBadge status={ticket.status as TicketStatus} />
              </div>
              <p className="rounded-xl bg-muted px-3 py-3 text-sm leading-relaxed">
                {ticket.body}
              </p>

              {!isTicketTerminal(ticket.status) ? (
                <form action={resolveSupportInquiryAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="ticketId" value={ticket.ticketId} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <label htmlFor={`ticket-outcome-${ticket.ticketId}`} className="text-sm font-semibold">
                    처리 결과
                  </label>
                  <select
                    id={`ticket-outcome-${ticket.ticketId}`}
                    name="outcome"
                    className="app-input"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>처리 결과를 선택하세요</option>
                    <option value="IN_REVIEW">처리 중으로 변경</option>
                    <option value="ANSWERED">답변 및 해결 완료</option>
                    <option value="CLOSED">종결</option>
                  </select>
                  <label htmlFor={`ticket-note-${ticket.ticketId}`} className="text-sm font-semibold">
                    운영 메모
                  </label>
                  <textarea
                    id={`ticket-note-${ticket.ticketId}`}
                    name="resolutionNote"
                    className="app-input min-h-24 resize-y"
                    maxLength={1000}
                    required
                  />
                  <PendingSubmitButton pendingLabel="처리 결과를 저장하는 중…">
                    문의 처리 저장
                  </PendingSubmitButton>
                </form>
              ) : null}
            </Card>
          ))
        ) : (
          <EmptyState label="처리할 고객 문의가 없습니다." />
        )}
      </section>
    </AdminReadPage>
  )
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'success' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'rounded-xl bg-warn-soft px-4 py-3 text-sm' : 'rounded-xl bg-mint-soft px-4 py-3 text-sm'}
    >
      {children}
    </p>
  )
}

function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const labels: Record<ReportStatus, string> = {
    SUBMITTED: '접수됨',
    IN_REVIEW: '검토 중',
    RESOLVED: '조치 완료',
    DISMISSED: '종결',
  }
  const tone = status === 'RESOLVED' ? 'mint' : status === 'DISMISSED' ? 'muted' : status === 'IN_REVIEW' ? 'info' : 'warn'
  return <StatusBadge tone={tone}>{labels[status] ?? status}</StatusBadge>
}

function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const labels: Record<TicketStatus, string> = {
    SUBMITTED: '접수됨',
    IN_REVIEW: '처리 중',
    ANSWERED: '답변 및 해결 완료',
    CLOSED: '종결',
  }
  const tone = status === 'ANSWERED' ? 'mint' : status === 'CLOSED' ? 'muted' : status === 'IN_REVIEW' ? 'info' : 'warn'
  return <StatusBadge tone={tone}>{labels[status] ?? status}</StatusBadge>
}

function isReportTerminal(status: string) {
  return status === 'RESOLVED' || status === 'DISMISSED'
}

function isTicketTerminal(status: string) {
  return status === 'ANSWERED' || status === 'CLOSED'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}
