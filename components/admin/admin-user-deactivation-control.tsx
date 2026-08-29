'use client'

import { useCallback, useState } from 'react'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { Modal } from '@/components/ui/modal'

type DeactivateAction = (formData: FormData) => Promise<void>

export function AdminUserDeactivationControl({
  action,
  userId,
  statusFilter,
}: {
  action: DeactivateAction
  userId: string
  statusFilter: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const close = useCallback(() => {
    setOpen(false)
    setReason('')
  }, [])

  function openDialog() {
    setIdempotencyKey(crypto.randomUUID())
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="min-h-11 rounded-[14px] border border-destructive/30 bg-surface px-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
      >
        이용 정지 지정
      </button>

      <Modal open={open} onClose={close} labelledBy={`deactivate-user-${userId}`}>
        <form action={action} className="flex flex-col gap-4">
          <div>
            <h2
              id={`deactivate-user-${userId}`}
              className="text-xl font-bold text-destructive"
            >
              이용 정지를 지정할까요?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              관리자 지정 정지는 신고 기반 정지와 별도로 기록됩니다. 진행 중인
              모집·이동·정산이 있으면 해당 정산이 끝난 뒤에 로그아웃·이용 정지가 적용됩니다.
            </p>
          </div>

          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
            이용 정지 사유
            <textarea
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              maxLength={1000}
              rows={4}
              aria-describedby={`deactivate-reason-help-${userId}`}
              className="rounded-[14px] border border-hairline bg-surface px-3 py-2 text-sm font-normal outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
              placeholder="감사 기록에 남길 사유를 입력하세요."
            />
            <span
              id={`deactivate-reason-help-${userId}`}
              className="text-xs font-normal text-muted-foreground"
            >
              1~1,000자로 입력하세요.
            </span>
          </label>

          <input type="hidden" name="targetUserId" value={userId} />
          <input type="hidden" name="status" value={statusFilter} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

          <PendingSubmitButton
            pendingLabel="이용 정지를 지정하는 중…"
            disabled={!reason.trim() || !idempotencyKey}
            className="min-h-11 rounded-[14px] bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:bg-destructive/90"
          >
            이용 정지 지정
          </PendingSubmitButton>
          <button
            type="button"
            onClick={close}
            className="min-h-11 rounded-[14px] border border-hairline bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            취소
          </button>
        </form>
      </Modal>
    </>
  )
}
