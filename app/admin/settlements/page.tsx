import { randomUUID } from 'node:crypto'
import { resolveFareDisputeAction } from '@/app/core/actions'
import { AdminReadPage } from '@/components/admin/admin-read-page'
import { Card } from '@/components/ui/card'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { requireAdmin } from '@/lib/auth/session'
import {
  getAdminFareDisputes,
  getAdminOperationsDashboard,
} from '@/lib/admin/service'

export default async function AdminSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const admin = await requireAdmin()
  const [{ message, error }, data, disputes] = await Promise.all([
    searchParams,
    getAdminOperationsDashboard(admin.userId),
    getAdminFareDisputes(admin.userId),
  ])
  return (
    <AdminReadPage
      title="정산 예외"
      description="이의제기는 관리자 검토만 가능합니다. 수정 요금 재제출을 요청해도 원장과 잔액은 변경되지 않습니다."
    >
      {message ? (
        <p className="rounded-xl bg-mint-soft px-4 py-3 text-sm" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-muted-foreground">참여자 확인 대기</p>
          <p className="mt-1 text-2xl font-extrabold">
            {Number(data.queues.pendingSettlements)}건
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">열린 이의제기</p>
          <p className="mt-1 text-2xl font-extrabold">
            {Number(data.queues.openDisputes)}건
          </p>
        </Card>
      </div>

      <section className="flex flex-col gap-3" aria-label="열린 실제 요금 이의제기">
        {disputes.length ? (
          disputes.map((dispute) => (
            <Card key={dispute.disputeId} className="flex flex-col gap-3">
              <div>
                <p className="font-bold">
                  {dispute.origin} → {dispute.destination}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dispute.participantName} · {dispute.participantStudentId} ·{' '}
                  {new Date(dispute.submittedAt).toLocaleString('ko-KR')}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">제출 요금</dt>
                  <dd className="font-semibold">
                    {Number(dispute.actualFare).toLocaleString('ko-KR')}P
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">1인 분담</dt>
                  <dd className="font-semibold">
                    {Number(dispute.finalShare).toLocaleString('ko-KR')}P
                  </dd>
                </div>
              </dl>
              <p className="rounded-xl bg-muted px-3 py-2 text-sm leading-relaxed">
                {dispute.reason}
              </p>
              <form action={resolveFareDisputeAction} className="flex flex-col gap-2">
                <input type="hidden" name="tripId" value={dispute.tripId} />
                <input type="hidden" name="disputeId" value={dispute.disputeId} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label
                  htmlFor={`fare-dispute-outcome-${dispute.disputeId}`}
                  className="text-sm font-semibold"
                >
                  검토 결과
                </label>
                <select
                  id={`fare-dispute-outcome-${dispute.disputeId}`}
                  name="outcome"
                  className="app-input"
                  defaultValue="REJECTED"
                >
                  <option value="REJECTED">기각 — 기존 요금으로 확인 재개</option>
                  <option value="RESOLVED">수정 요금 재제출 요청</option>
                </select>
                <label
                  htmlFor={`fare-dispute-note-${dispute.disputeId}`}
                  className="text-sm font-semibold"
                >
                  검토 메모
                </label>
                <textarea
                  id={`fare-dispute-note-${dispute.disputeId}`}
                  name="resolutionNote"
                  required
                  maxLength={1000}
                  className="app-input min-h-20 resize-y"
                />
                <PendingSubmitButton pendingLabel="처리 저장 중...">
                  검토 결과 저장
                </PendingSubmitButton>
              </form>
            </Card>
          ))
        ) : (
          <Card>
            <p className="text-sm text-muted-foreground">처리할 열린 이의제기가 없습니다.</p>
          </Card>
        )}
      </section>
    </AdminReadPage>
  )
}
