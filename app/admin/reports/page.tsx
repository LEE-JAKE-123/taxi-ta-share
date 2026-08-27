import { randomUUID } from 'node:crypto'
import {
  decideTripIncidentAction,
  executeConfirmedHostNoStartRefundAction,
  executeConfirmedMemberNoShowAction,
  publishTripIncidentRebuttalWindowAction,
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
type TripIncidentStatus =
  | 'SUBMITTED'
  | 'START_REVIEW'
  | 'RESPONSIBILITY_CONFIRMED'
  | 'NOT_ESTABLISHED'

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

      <section aria-labelledby="trip-incident-queue-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 id="trip-incident-queue-heading" className="text-lg font-extrabold">
              운행 사고 신고
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              판정은 사실관계 기록입니다. 후속 실행은 사건 유형별로 분리되며, 참여자 노쇼는 상태만 확정하고 모집자 미개시는 비귀책 참여자 예치금만 반환합니다.
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-muted-foreground">
            {dashboard.tripIncidents.length}건
          </span>
        </div>

        {dashboard.tripIncidents.length ? (
          dashboard.tripIncidents.map((incident) => (
            <Card key={incident.incidentId} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{incidentTypeLabel(incident.incidentType)}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    접수 {formatDate(incident.submittedAt)} · 모집 #{incident.tripId.slice(0, 8)}
                  </p>
                </div>
                <TripIncidentStatusBadge status={incident.status as TripIncidentStatus} />
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">신고자</dt>
                  <dd className="mt-1 font-semibold">{incident.reporterName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">신고 대상</dt>
                  <dd className="mt-1 font-semibold">{incident.reportedName}</dd>
                </div>
              </dl>

              <p className="rounded-xl bg-muted px-3 py-3 text-sm leading-relaxed">
                {incident.description}
              </p>
              {incident.evidenceRef ? (
                <p className="break-all text-xs text-muted-foreground">
                  신고 증거 참조: {incident.evidenceRef}
                </p>
              ) : null}

              {incident.rebuttalStatement ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border px-3 py-3">
                  <p className="text-sm font-semibold">대상자 소명</p>
                  <p className="text-sm leading-relaxed">{incident.rebuttalStatement}</p>
                  {incident.rebuttalEvidenceRef ? (
                    <p className="break-all text-xs text-muted-foreground">
                      소명 증거 참조: {incident.rebuttalEvidenceRef}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!isTripIncidentTerminal(incident.status ?? 'SUBMITTED') ? (
                <form action={decideTripIncidentAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="incidentId" value={incident.incidentId} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <label htmlFor={`incident-outcome-${incident.incidentId}`} className="text-sm font-semibold">
                    운영 기록
                  </label>
                  <select
                    id={`incident-outcome-${incident.incidentId}`}
                    name="outcome"
                    className="app-input"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>운영 기록을 선택하세요</option>
                    {incident.status === null ? (
                      <option value="START_REVIEW">검토 시작</option>
                    ) : null}
                    {incident.status === 'START_REVIEW' ? (
                      <>
                        {incident.rebuttalStatement || incident.rebuttalDeadlineExpired ? (
                          <option value="RESPONSIBILITY_CONFIRMED">귀책 사실 확인</option>
                        ) : null}
                        <option value="NOT_ESTABLISHED">귀책 사실 불인정</option>
                      </>
                    ) : null}
                  </select>
                  <label htmlFor={`incident-note-${incident.incidentId}`} className="text-sm font-semibold">
                    판정 사유
                  </label>
                  <textarea
                    id={`incident-note-${incident.incidentId}`}
                    name="decisionNote"
                    className="app-input min-h-24 resize-y"
                    minLength={10}
                    maxLength={1000}
                    required
                  />
                  <label htmlFor={`incident-evidence-${incident.incidentId}`} className="text-sm font-semibold">
                    판단 근거 참조
                  </label>
                  <textarea
                    id={`incident-evidence-${incident.incidentId}`}
                    name="evidenceBasis"
                    className="app-input min-h-20 resize-y"
                    minLength={10}
                    maxLength={2000}
                    required
                  />
                  <p className="rounded-xl bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {incident.status === 'START_REVIEW' && incident.rebuttalDeadlineAt && !incident.rebuttalDeadlineExpired && !incident.rebuttalStatement
                      ? '반박 기한이 끝나거나 대상자가 반박을 제출하기 전에는 귀책 사실을 확정할 수 없습니다.'
                      : '기록 저장 후에도 포인트 지급·환불·추가 차감이나 계정 제한은 자동으로 발생하지 않습니다.'}
                  </p>
                  <PendingSubmitButton pendingLabel="운영 기록을 저장하는 중…">
                    운영 기록 저장
                  </PendingSubmitButton>
                </form>
              ) : null}
              {incident.status === 'START_REVIEW' &&
              !incident.rebuttalNotificationId ? (
                <form action={publishTripIncidentRebuttalWindowAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="incidentId" value={incident.incidentId} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    이전 검토 기록에는 반박 기회 게시 증거가 없습니다. 활성 비당사자 관리자가 지금 게시하면 피신고자에게 인앱으로 10분 반박 기회가 열립니다.
                  </p>
                  <PendingSubmitButton pendingLabel="반박 기회를 게시하는 중">
                    10분 반박 기회 게시
                  </PendingSubmitButton>
                </form>
              ) : null}
              {incident.status === 'RESPONSIBILITY_CONFIRMED' &&
              incident.incidentType === 'MEMBER_NO_SHOW' &&
              !incident.noShowExecutionId &&
              incident.reviewAdminId === admin.userId ? (
                <form action={executeConfirmedMemberNoShowAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="incidentId" value={incident.incidentId} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    귀책 사실 확인에 따라 대상 참여자의 상태만 노쇼로 확정합니다. 예치금, 포인트 원장, 정산 금액은 이 단계에서 변경되지 않습니다.
                  </p>
                  <PendingSubmitButton pendingLabel="노쇼 사실을 확정하는 중…" className="bg-destructive text-destructive-foreground">
                    노쇼 상태 확정
                  </PendingSubmitButton>
                </form>
              ) : null}
              {incident.status === 'RESPONSIBILITY_CONFIRMED' &&
              incident.incidentType === 'MEMBER_NO_SHOW' &&
              !incident.noShowExecutionId &&
              incident.reviewAdminId !== admin.userId ? (
                <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                  판정을 기록한 관리자만 노쇼 상태를 확정할 수 있습니다.
                </p>
              ) : null}
              {incident.status === 'RESPONSIBILITY_CONFIRMED' &&
              incident.incidentType === 'HOST_NO_START' &&
              !incident.noStartRefundExecutionId &&
              incident.reviewAdminId === admin.userId ? (
                <form action={executeConfirmedHostNoStartRefundAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="incidentId" value={incident.incidentId} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    책임 확정에 따라 모집을 취소하고 비귀책 확정 참여자의 예치금만 전액 반환합니다. 모집자 예치금과 제재는 이 실행에서 변경하지 않습니다.
                  </p>
                  <PendingSubmitButton pendingLabel="미개시 환불을 실행하는 중" className="bg-destructive text-destructive-foreground">
                    모집 취소 및 참여자 환불 실행
                  </PendingSubmitButton>
                </form>
              ) : null}
              {incident.status === 'RESPONSIBILITY_CONFIRMED' &&
              incident.incidentType === 'HOST_NO_START' &&
              !incident.noStartRefundExecutionId &&
              incident.reviewAdminId !== admin.userId ? (
                <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                  책임을 기록한 관리자만 모집 취소와 참여자 환불을 실행할 수 있습니다.
                </p>
              ) : null}
            </Card>
          ))
        ) : (
          <EmptyState label="처리할 운행 사고 신고가 없습니다." />
        )}
      </section>

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

function TripIncidentStatusBadge({ status }: { status: TripIncidentStatus }) {
  const labels: Record<TripIncidentStatus, string> = {
    SUBMITTED: '접수됨',
    START_REVIEW: '검토 중',
    RESPONSIBILITY_CONFIRMED: '귀책 사실 확인',
    NOT_ESTABLISHED: '귀책 사실 불인정',
  }
  const tone =
    status === 'RESPONSIBILITY_CONFIRMED'
      ? 'warn'
      : status === 'NOT_ESTABLISHED'
        ? 'mint'
        : status === 'START_REVIEW'
          ? 'info'
          : 'muted'

  return <StatusBadge tone={tone}>{labels[status] ?? status}</StatusBadge>
}

function incidentTypeLabel(type: string) {
  return type === 'HOST_NO_START' ? '방장 미출발 신고' : '참여자 노쇼 신고'
}

function isReportTerminal(status: string) {
  return status === 'RESOLVED' || status === 'DISMISSED'
}

function isTicketTerminal(status: string) {
  return status === 'ANSWERED' || status === 'CLOSED'
}

function isTripIncidentTerminal(status: string) {
  return status === 'RESPONSIBILITY_CONFIRMED' || status === 'NOT_ESTABLISHED'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}
