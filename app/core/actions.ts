'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin, requireCompleteUser } from '@/lib/auth/session'
import { parseCreateTripForm } from '@/lib/core/trip-validation'
import {
  arriveAndSettleTrip,
  adjustFareDisputeByAdmin,
  CoreError,
  applyToTrip,
  approveParticipant,
  cancelParticipation,
  cancelTrip,
  closeTrip,
  confirmFare,
  confirmTripAndDeposit,
  createTrip,
  fulfillPointRequest,
  forceSettleFareDisputeByAdmin,
  grantPoints,
  checkInParticipant,
  markParticipantNoShow,
  requestPoints,
  resolveFareDispute,
  setDesignatedFareSubmitter,
  settleTrip,
  startTrip,
  submitActualFare,
  submitFareDispute,
  withdrawFareDispute,
} from '@/lib/core/service'
import {
  blockUser,
  resolveSupportTicket,
  resolveUserReport,
  submitSupportTicket,
  submitUserReport,
} from '@/lib/safety/service'

export type CreateTripState = {
  message?: string
  fieldErrors?: Record<string, string[] | undefined>
}

function text(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function complete(message: string, error = false): never {
  revalidatePath('/core')
  redirect(`/core?${error ? 'error' : 'message'}=${encodeURIComponent(message)}`)
}

async function execute(run: () => Promise<void>, success: string) {
  try {
    await run()
  } catch (error) {
    complete(
      error instanceof CoreError ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
      true,
    )
  }
  complete(success)
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function completeRoom(tripId: string, message: string, error = false): never {
  revalidatePath('/home')
  revalidatePath('/my-rooms')
  revalidatePath(`/room/${tripId}`)
  redirect(
    `/room/${tripId}?${error ? 'error' : 'message'}=${encodeURIComponent(message)}`,
  )
}

async function executeRoom(
  tripId: string,
  run: () => Promise<void>,
  success: string,
) {
  try {
    await run()
  } catch (error) {
    completeRoom(
      tripId,
      error instanceof CoreError
        ? error.message
        : '요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.',
      true,
    )
  }
  completeRoom(tripId, success)
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export async function createTripAction(formData: FormData) {
  const user = await requireCompleteUser()
  const parsed = parseCreateTripForm(formData)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? '입력값을 다시 확인해주세요.'
    complete(message, true)
  }

  let tripId = ''
  try {
    tripId = await createTrip({
      actorId: user.userId,
      ...parsed.data,
    })
  } catch (error) {
    complete(error instanceof CoreError ? error.message : '방을 만들지 못했습니다.', true)
  }
  revalidatePath('/core')
  redirect(`/core?message=${encodeURIComponent('방을 만들었습니다.')}&trip=${tripId}`)
}

export async function createRoomAction(
  _previousState: CreateTripState,
  formData: FormData,
): Promise<CreateTripState> {
  const user = await requireCompleteUser()
  const parsed = parseCreateTripForm(formData)

  if (!parsed.success) {
    return {
      message: '입력한 방 정보를 다시 확인해주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  let tripId: string
  try {
    tripId = await createTrip({
      actorId: user.userId,
      ...parsed.data,
    })
  } catch (error) {
    if (!(error instanceof CoreError)) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : ''
      console.error('Trip creation failed without exposing submitted locations.', {
        code,
      })
    }
    return {
      message:
        error instanceof CoreError
          ? error.message
          : '방을 만들지 못했습니다. 잠시 후 다시 시도해주세요.',
    }
  }

  revalidatePath('/core')
  revalidatePath('/home')
  revalidatePath('/my-rooms')
  revalidatePath(`/room/${tripId}`)
  redirect(
    `/room/${tripId}?message=${encodeURIComponent('방을 만들었습니다.')}`,
  )
}

export async function applyAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () => applyToTrip(user.userId, text(formData, 'tripId'), text(formData, 'idempotencyKey')),
    '참여를 신청했습니다.',
  )
}

export async function approveAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () =>
      approveParticipant({
        actorId: user.userId,
        tripId: text(formData, 'tripId'),
        participantId: text(formData, 'participantId'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    '참여를 승인했습니다.',
  )
}

export async function applyFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  const idempotencyKey = text(formData, 'idempotencyKey')

  if (!isUuid(tripId)) {
    redirect(`/home?error=${encodeURIComponent('올바르지 않은 방 식별자입니다.')}`)
  }
  if (!isUuid(idempotencyKey)) {
    completeRoom(tripId, '요청 식별자가 올바르지 않습니다.', true)
  }

  await executeRoom(
    tripId,
    () => applyToTrip(user.userId, tripId, idempotencyKey),
    '참여 신청을 보냈습니다. 방장의 승인을 기다려 주세요.',
  )
}

export async function approveFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  const participantId = text(formData, 'participantId')
  const idempotencyKey = text(formData, 'idempotencyKey')

  if (!isUuid(tripId)) {
    redirect(`/home?error=${encodeURIComponent('올바르지 않은 방 식별자입니다.')}`)
  }
  if (!isUuid(participantId) || !isUuid(idempotencyKey)) {
    completeRoom(tripId, '승인 요청 정보가 올바르지 않습니다.', true)
  }

  await executeRoom(
    tripId,
    () =>
      approveParticipant({
        actorId: user.userId,
        tripId,
        participantId,
        idempotencyKey,
      }),
    '참여 신청을 승인했습니다.',
  )
}

export async function closeTripAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () =>
      closeTrip(
        user.userId,
        text(formData, 'tripId'),
        text(formData, 'idempotencyKey'),
      ),
    '모집을 종료했습니다.',
  )
}

export async function closeTripFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  const idempotencyKey = text(formData, 'idempotencyKey')

  if (!isUuid(tripId)) {
    redirect(`/home?error=${encodeURIComponent('올바르지 않은 방 식별자입니다.')}`)
  }
  if (!isUuid(idempotencyKey)) {
    completeRoom(tripId, '요청 식별자가 올바르지 않습니다.', true)
  }

  await executeRoom(
    tripId,
    () => closeTrip(user.userId, tripId, idempotencyKey),
    '모집을 종료했습니다. 확정 인원이 2명 이상이면 포인트 예치를 진행해 주세요.',
  )
}

export async function cancelTripAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () =>
      cancelTrip(
        user.userId,
        text(formData, 'tripId'),
        text(formData, 'idempotencyKey'),
      ),
    '모집을 취소했습니다.',
  )
}

export async function depositAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () => confirmTripAndDeposit(user.userId, text(formData, 'tripId'), text(formData, 'idempotencyKey')),
    '모집 확정과 예치를 완료했습니다.',
  )
}

export async function confirmTripAndDepositFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  const idempotencyKey = text(formData, 'idempotencyKey')

  if (!isUuid(tripId)) {
    redirect(`/home?error=${encodeURIComponent('올바르지 않은 방 식별자입니다.')}`)
  }
  if (!isUuid(idempotencyKey)) {
    completeRoom(tripId, '요청 식별자가 올바르지 않습니다.', true)
  }

  await executeRoom(
    tripId,
    () => confirmTripAndDeposit(user.userId, tripId, idempotencyKey),
    '모집을 확정하고 전원 포인트 예치를 완료했습니다. 이제 출발할 수 있습니다.',
  )
}

export async function cancelTripFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  const idempotencyKey = text(formData, 'idempotencyKey')

  if (!isUuid(tripId)) {
    redirect(`/home?error=${encodeURIComponent('올바르지 않은 방 식별자입니다.')}`)
  }
  if (!isUuid(idempotencyKey)) {
    completeRoom(tripId, '요청 식별자가 올바르지 않습니다.', true)
  }

  try {
    await cancelTrip(user.userId, tripId, idempotencyKey)
  } catch (error) {
    completeRoom(
      tripId,
      error instanceof CoreError
        ? error.message
        : '모집을 취소하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.',
      true,
    )
  }

  revalidatePath('/home')
  revalidatePath('/my-rooms')
  revalidatePath(`/room/${tripId}`)
  redirect(
    `/my-rooms?message=${encodeURIComponent(
      '방을 취소했습니다. 예치 전이므로 포인트 변동은 없습니다.',
    )}`,
  )
}

export async function cancelParticipationFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  const idempotencyKey = text(formData, 'idempotencyKey')

  if (!isUuid(tripId)) {
    redirect(`/home?error=${encodeURIComponent('올바르지 않은 방 식별자입니다.')}`)
  }
  if (!isUuid(idempotencyKey)) {
    completeRoom(tripId, '요청 식별자가 올바르지 않습니다.', true)
  }

  await executeRoom(
    tripId,
    () => cancelParticipation(user.userId, tripId, idempotencyKey),
    '참여를 취소했습니다. 예치 전 취소이므로 포인트 변동은 없습니다.',
  )
}

export async function grantAction(formData: FormData) {
  const admin = await requireAdmin()
  await execute(
    async () => {
      await grantPoints({
        adminId: admin.userId,
        targetUserId: text(formData, 'targetUserId'),
        amount: Number(text(formData, 'amount')),
        reason: text(formData, 'reason'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      })
    },
    '포인트를 지급했습니다.',
  )
}

function finishPointPath(
  path: '/admin' | '/points',
  message: string,
  error = false,
): never {
  revalidatePath('/admin')
  revalidatePath('/points')
  redirect(
    `${path}?${error ? 'error' : 'message'}=${encodeURIComponent(message)}`,
  )
}

export async function grantPointsAction(formData: FormData) {
  const admin = await requireAdmin()
  try {
    await grantPoints({
      adminId: admin.userId,
      targetUserId: text(formData, 'targetUserId'),
      amount: Number(text(formData, 'amount')),
      reason: text(formData, 'reason'),
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishPointPath(
      '/admin',
      error instanceof CoreError
        ? error.message
        : '포인트를 지급하지 못했습니다. 잠시 후 다시 시도해주세요.',
      true,
    )
  }
  finishPointPath('/admin', '포인트를 지급했습니다.')
}

export async function requestPointsAction(formData: FormData) {
  const user = await requireCompleteUser()
  try {
    await requestPoints({
      requesterId: user.userId,
      amount: Number(text(formData, 'amount')),
      reason: text(formData, 'reason'),
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishPointPath(
      '/points',
      error instanceof CoreError
        ? error.message
        : '포인트 지급 요청을 보내지 못했습니다. 잠시 후 다시 시도해주세요.',
      true,
    )
  }
  finishPointPath('/points', '관리자에게 포인트 지급을 요청했습니다.')
}

export async function fulfillPointRequestAction(formData: FormData) {
  const admin = await requireAdmin()
  try {
    await fulfillPointRequest({
      adminId: admin.userId,
      requestId: text(formData, 'requestId'),
    })
  } catch (error) {
    finishPointPath(
      '/admin',
      error instanceof CoreError
        ? error.message
        : '포인트 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
      true,
    )
  }
  finishPointPath('/admin', '포인트 요청을 승인하고 지급했습니다.')
}

export async function submitFareAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () =>
      submitActualFare({
        actorId: user.userId,
        tripId: text(formData, 'tripId'),
        actualFare: Number(text(formData, 'actualFare')),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    '실제 요금을 등록하고 확인했습니다.',
  )
}

export async function confirmFareAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () => confirmFare(user.userId, text(formData, 'tripId'), text(formData, 'idempotencyKey')),
    '실제 요금을 확인했습니다.',
  )
}

export async function settleAction(formData: FormData) {
  const user = await requireCompleteUser()
  await execute(
    () => settleTrip(user.userId, text(formData, 'tripId'), text(formData, 'idempotencyKey')),
    '최종 정산을 완료했습니다.',
  )
}

function finishJourney(
  tripId: string,
  page: 'gathering' | 'settle' | 'settle/complete',
  message: string,
  error = false,
): never {
  revalidatePath('/home')
  revalidatePath('/my-rooms')
  revalidatePath(`/room/${tripId}`)
  revalidatePath(`/room/${tripId}/gathering`)
  revalidatePath(`/room/${tripId}/settle`)
  redirect(
    `/room/${tripId}/${page}?${error ? 'error' : 'message'}=${encodeURIComponent(message)}`,
  )
}

async function executeJourney(
  tripId: string,
  page: 'gathering' | 'settle' | 'settle/complete',
  run: () => Promise<void>,
  success: string,
) {
  try {
    await run()
  } catch (error) {
    finishJourney(
      tripId,
      page,
      error instanceof CoreError
        ? error.message
        : '요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.',
      true,
    )
  }
  finishJourney(tripId, page, success)
}

function requireJourneyUuid(value: string, label: string) {
  if (!isUuid(value)) {
    throw new CoreError(`${label} 식별자가 올바르지 않습니다.`)
  }
  return value
}

export async function startTripAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'gathering',
    () => startTrip(user.userId, tripId, idempotencyKey),
    '이동을 시작했습니다.',
  )
}

export async function startTripFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeRoom(
    tripId,
    () => startTrip(user.userId, tripId, idempotencyKey),
    '출발했습니다.',
  )
}

export async function arriveAndSettleAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  const actualFareText = text(formData, 'actualFare')

  try {
    await arriveAndSettleTrip(
      user.userId,
      tripId,
      actualFareText,
      idempotencyKey,
    )
  } catch (error) {
    completeRoom(
      tripId,
      error instanceof CoreError
        ? error.message
        : '정산을 완료하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.',
      true,
    )
  }
  finishJourney(
    tripId,
    'settle/complete',
    '도착 처리와 최종 정산을 완료했습니다.',
  )
}

export async function checkInAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'gathering',
    () =>
      checkInParticipant(
        user.userId,
        tripId,
        idempotencyKey,
      ),
    '집결 체크인을 완료했습니다.',
  )
}

export async function markNoShowAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const participantId = requireJourneyUuid(
    text(formData, 'participantId'),
    '참여자',
  )
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'gathering',
    () =>
      markParticipantNoShow({
        actorId: user.userId,
        tripId,
        participantId,
        idempotencyKey,
      }),
    '참여자를 노쇼로 기록했습니다.',
  )
}

export async function submitJourneyFareAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'settle',
    () =>
      submitActualFare({
        actorId: user.userId,
        tripId,
        actualFare: Number(text(formData, 'actualFare')),
        idempotencyKey,
      }),
    '실제 요금을 등록했습니다. 참여자 확인을 기다립니다.',
  )
}

export async function confirmJourneyFareAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'settle',
    () =>
      confirmFare(
        user.userId,
        tripId,
        idempotencyKey,
      ),
    '실제 요금에 동의했습니다.',
  )
}

export async function setDesignatedFareSubmitterAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const submitterText = text(formData, 'submitterId')
  const submitterId = submitterText
    ? requireJourneyUuid(submitterText, '실제 요금 입력자')
    : null
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeRoom(
    tripId,
    () =>
      setDesignatedFareSubmitter({
        actorId: user.userId,
        tripId,
        submitterId,
        idempotencyKey,
      }),
    submitterId
      ? '지정 참여자가 실제 요금을 입력할 수 있습니다.'
      : '방장이 실제 요금을 입력하도록 지정했습니다.',
  )
}

export async function submitJourneyFareDisputeAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'settle',
    () =>
      submitFareDispute({
        actorId: user.userId,
        tripId,
        reason: text(formData, 'reason'),
        idempotencyKey,
      }),
    '실제 요금 이의제기를 접수했습니다. 검토가 끝날 때까지 최종 정산이 보류됩니다.',
  )
}

export async function withdrawJourneyFareDisputeAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'settle',
    () =>
      withdrawFareDispute({
        actorId: user.userId,
        tripId,
        idempotencyKey,
      }),
    '이의제기를 철회했습니다. 실제 요금을 다시 확인할 수 있습니다.',
  )
}

export async function resolveFareDisputeAction(formData: FormData) {
  const admin = await requireAdmin()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const disputeId = requireJourneyUuid(text(formData, 'disputeId'), '이의제기')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  const outcome = text(formData, 'outcome')
  if (
    outcome !== 'REJECTED' &&
    outcome !== 'ADJUSTED' &&
    outcome !== 'FORCE_SETTLE'
  ) {
    finishAdminSettlement('처리 결과가 올바르지 않습니다.', true)
  }
  try {
    const resolutionNote = text(formData, 'resolutionNote')
    if (outcome === 'ADJUSTED') {
      await adjustFareDisputeByAdmin({
        adminId: admin.userId,
        tripId,
        disputeId,
        actualFare: Number(text(formData, 'actualFare')),
        resolutionNote,
        idempotencyKey,
      })
    } else if (outcome === 'FORCE_SETTLE') {
      await forceSettleFareDisputeByAdmin({
        adminId: admin.userId,
        tripId,
        disputeId,
        resolutionNote,
        idempotencyKey,
      })
    } else {
      await resolveFareDispute({
        adminId: admin.userId,
        tripId,
        disputeId,
        outcome,
        resolutionNote,
        idempotencyKey,
      })
    }
  } catch (error) {
    finishAdminSettlement(
      error instanceof CoreError
        ? error.message
        : '이의제기를 처리하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.',
      true,
    )
  }
  finishAdminSettlement(
    outcome === 'ADJUSTED'
      ? '관리자가 실제 요금을 수정했습니다. 참여자 확인을 새로 시작합니다.'
      : outcome === 'FORCE_SETTLE'
        ? '관리자 강제 정산을 완료했습니다. 거래 내역을 확인할 수 있습니다.'
        : '이의제기를 기각했습니다. 실제 요금 확인과 정산을 다시 진행할 수 있습니다.',
  )
}

function finishAdminSettlement(message: string, error = false): never {
  revalidatePath('/admin')
  revalidatePath('/admin/settlements')
  redirect(
    `/admin/settlements?${error ? 'error' : 'message'}=${encodeURIComponent(message)}`,
  )
}

export async function settleJourneyAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = requireJourneyUuid(text(formData, 'tripId'), '방')
  const idempotencyKey = requireJourneyUuid(
    text(formData, 'idempotencyKey'),
    '요청',
  )
  await executeJourney(
    tripId,
    'settle/complete',
    () =>
      settleTrip(
        user.userId,
        tripId,
        idempotencyKey,
      ),
    '최종 정산을 완료했습니다.',
  )
}

function finishSafety(
  path: '/home' | '/support' | '/admin/reports' | `/room/${string}`,
  message: string,
  error = false,
): never {
  revalidatePath('/admin/reports')
  revalidatePath('/support')
  revalidatePath('/core')
  revalidatePath('/home')
  redirect(`${path}?${error ? 'error' : 'message'}=${encodeURIComponent(message)}`)
}

export async function submitSupportInquiryAction(formData: FormData) {
  const user = await requireCompleteUser()
  try {
    await submitSupportTicket({
      requesterId: user.userId,
      category: text(formData, 'category'),
      subject: text(formData, 'subject'),
      body: text(formData, 'body'),
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishSafety(
      '/support',
      error instanceof CoreError
        ? error.message
        : '문의 접수에 실패했습니다. 다시 시도해주세요.',
      true,
    )
  }
  finishSafety('/support', '문의가 접수되었습니다. 운영자 검토 후 답변하겠습니다.')
}

export async function resolveUserReportAction(formData: FormData) {
  const admin = await requireAdmin()
  const outcome = text(formData, 'outcome')
  if (!['IN_REVIEW', 'RESOLVED', 'DISMISSED', 'SUSPENDED'].includes(outcome)) {
    finishSafety('/admin/reports', '처리 결과가 올바르지 않습니다.', true)
  }
  try {
    await resolveUserReport({
      adminId: admin.userId,
      reportId: text(formData, 'reportId'),
      outcome: outcome as 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED' | 'SUSPENDED',
      resolutionNote: text(formData, 'resolutionNote'),
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishSafety(
      '/admin/reports',
      error instanceof CoreError
        ? error.message
        : '신고 처리에 실패했습니다. 다시 시도해주세요.',
      true,
    )
  }
  finishSafety('/admin/reports', '신고 처리 결과를 기록했습니다.')
}

export async function resolveSupportInquiryAction(formData: FormData) {
  const admin = await requireAdmin()
  const outcome = text(formData, 'outcome')
  if (!['IN_REVIEW', 'ANSWERED', 'CLOSED'].includes(outcome)) {
    finishSafety('/admin/reports', '처리 결과가 올바르지 않습니다.', true)
  }
  try {
    await resolveSupportTicket({
      adminId: admin.userId,
      ticketId: text(formData, 'ticketId'),
      outcome: outcome as 'IN_REVIEW' | 'ANSWERED' | 'CLOSED',
      resolutionNote: text(formData, 'resolutionNote'),
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishSafety(
      '/admin/reports',
      error instanceof CoreError
        ? error.message
        : '문의 처리에 실패했습니다. 다시 시도해주세요.',
      true,
    )
  }
  finishSafety('/admin/reports', '문의 처리 결과를 기록했습니다.')
}

export async function submitUserReportFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  if (!isUuid(tripId)) {
    redirect('/home?error=' + encodeURIComponent('모집 식별자가 올바르지 않습니다.'))
  }
  try {
    await submitUserReport({
      reporterId: user.userId,
      reportedUserId: text(formData, 'reportedUserId'),
      reasonCode: text(formData, 'reasonCode'),
      description: text(formData, 'description'),
      evidenceRef: text(formData, 'evidenceRef') || null,
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishSafety(
      `/room/${tripId}`,
      error instanceof CoreError
        ? error.message
        : '신고 접수에 실패했습니다. 다시 시도해주세요.',
      true,
    )
  }
  finishSafety(`/room/${tripId}`, '신고가 접수되었습니다. 신고 내용은 대상 사용자에게 공개되지 않습니다.')
}

export async function blockUserFromRoomAction(formData: FormData) {
  const user = await requireCompleteUser()
  const tripId = text(formData, 'tripId')
  if (!isUuid(tripId)) {
    redirect('/home?error=' + encodeURIComponent('모집 식별자가 올바르지 않습니다.'))
  }
  try {
    await blockUser({
      blockerId: user.userId,
      blockedUserId: text(formData, 'blockedUserId'),
      idempotencyKey: text(formData, 'idempotencyKey'),
    })
  } catch (error) {
    finishSafety(
      `/room/${tripId}`,
      error instanceof CoreError
        ? error.message
        : '차단 처리에 실패했습니다. 다시 시도해주세요.',
      true,
    )
  }
  finishSafety('/home', '차단했습니다. 이후 서로의 신규 동승 신청과 승인은 제한됩니다.')
}

