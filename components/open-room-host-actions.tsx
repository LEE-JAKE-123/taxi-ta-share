'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { cancelTripFromRoomAction } from '@/app/core/actions'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { Modal } from '@/components/ui/modal'

export function OpenRoomHostActions({
  tripId,
  departureOpen,
  fallbackIdempotencyKey,
}: {
  tripId: string
  departureOpen: boolean
  fallbackIdempotencyKey: string
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const subscribeToEnhancement = useCallback(() => () => {}, [])
  const isEnhanced = useSyncExternalStore(
    subscribeToEnhancement,
    () => true,
    () => false,
  )
  const closeCancelModal = useCallback(() => {
    setCancelOpen(false)
    setCancelConfirmed(false)
  }, [])

  function openCancelModal() {
    setIdempotencyKey(crypto.randomUUID())
    setCancelOpen(true)
  }

  if (!isEnhanced) {
    return (
      <form
        action={cancelTripFromRoomAction}
        className="rounded-xl border border-destructive/30 bg-destructive/10 p-3"
      >
        <p className="text-sm font-semibold text-destructive">방을 취소할까요?</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          참여 신청과 승인이 함께 취소됩니다. 예치 전 취소이므로 포인트 변동은 없습니다.
        </p>
        <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-foreground">
          <input type="checkbox" required className="mt-0.5 size-4 accent-primary" />
          위 영향을 확인했고 방 취소에 동의합니다.
        </label>
        <input type="hidden" name="tripId" value={tripId} />
        <input
          type="hidden"
          name="idempotencyKey"
          value={fallbackIdempotencyKey}
        />
        <button
          type="submit"
          disabled={!departureOpen}
          className="mt-3 min-h-11 rounded-xl border border-destructive/30 bg-background px-3 py-2 text-sm font-semibold text-destructive disabled:pointer-events-none disabled:opacity-60"
        >
          방 취소
        </button>
      </form>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={openCancelModal}
        disabled={!departureOpen}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-destructive/30 bg-background px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
      >
        방 취소
      </button>

      <Modal
        open={cancelOpen}
        onClose={closeCancelModal}
        labelledBy="cancel-trip-title"
      >
        <form action={cancelTripFromRoomAction} className="flex flex-col gap-4">
          <div>
            <h2 id="cancel-trip-title" className="text-xl font-bold text-destructive">
              방을 취소할까요?
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              참여 신청과 승인이 함께 취소됩니다. 예치 전 취소이므로 포인트 변동은 없습니다.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm font-semibold text-foreground">
            <input
              type="checkbox"
              required
              checked={cancelConfirmed}
              onChange={(event) => setCancelConfirmed(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            위 영향을 확인했고 방 취소에 동의합니다.
          </label>
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <PendingSubmitButton
            pendingLabel="방 취소 처리 중..."
            className="min-h-11 rounded-xl bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:bg-destructive/90"
            disabled={!departureOpen || !idempotencyKey || !cancelConfirmed}
          >
            방 취소
          </PendingSubmitButton>
          <button
            type="button"
            onClick={closeCancelModal}
            className="min-h-11 rounded-xl border border-border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            닫기
          </button>
        </form>
      </Modal>
    </>
  )
}
