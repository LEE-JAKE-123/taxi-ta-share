'use client'

import { useCallback, useState } from 'react'
import { Calculator, Flag } from 'lucide-react'
import { submitJourneyFareAction } from '@/app/core/actions'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

export function ArrivalSettlementControl({
  tripId,
  isDesignated = false,
}: {
  tripId: string
  isDesignated?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const close = useCallback(() => setOpen(false), [])

  function openFareModal() {
    setIdempotencyKey(crypto.randomUUID())
    setOpen(true)
  }

  return (
    <>
      <Button
        type="button"
        onClick={openFareModal}
        size="lg"
        className="w-full"
      >
        <Flag className="size-5" aria-hidden />
        도착
      </Button>

      <Modal
        open={open}
        onClose={close}
        labelledBy="arrival-settlement-title"
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2 id="arrival-settlement-title" className="text-xl font-extrabold">
              실제 택시비 입력
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isDesignated
                ? '방장이 지정한 입력자로서 실제 택시비를 제출합니다. 참여자의 확인 또는 이의제기를 기다립니다.'
                : '실제 택시비를 제출한 뒤 참여자의 확인 또는 이의제기를 기다립니다.'}
            </p>
          </div>

          <form action={submitJourneyFareAction} className="flex flex-col gap-3">
            <input type="hidden" name="tripId" value={tripId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={idempotencyKey}
            />
            <label htmlFor="arrivalActualFare" className="text-sm font-semibold">
              실제 택시비
            </label>
            <div className="relative">
              <input
                id="arrivalActualFare"
                name="actualFare"
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                minLength={1}
                maxLength={7}
                autoComplete="off"
                required
                className="app-input pr-10"
                placeholder="예: 13000"
                aria-describedby="arrival-fare-help"
              />
              <span
                className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground"
                aria-hidden
              >
                원
              </span>
            </div>
            <p
              id="arrival-fare-help"
              className="text-xs text-muted-foreground"
            >
              1원 이상 숫자만 입력해 주세요. 참여자 확인이 끝난 뒤에만 최종 정산됩니다.
            </p>
            <PendingSubmitButton
              pendingLabel="제출 중..."
              disabled={!idempotencyKey}
            >
              <Calculator className="size-5" aria-hidden />
              실제 요금 제출
            </PendingSubmitButton>
            <Button
              type="button"
              onClick={close}
              variant="secondary"
              size="sm"
            >
              취소
            </Button>
          </form>
        </div>
      </Modal>
    </>
  )
}
