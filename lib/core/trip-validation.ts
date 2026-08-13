import { z } from 'zod'

const departureAtSchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim() ? new Date(value) : value,
  z.date({ error: '출발 시각을 입력해 주세요.' }),
)

const coordinate = (minimum: number, maximum: number, message: string) =>
  z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? Number(value) : value,
    z.number({ error: message }).finite(message).min(minimum, message).max(maximum, message),
  )

export const createTripSchema = z.object({
  origin: z.string().trim().min(1, '출발지를 검색해 선택해 주세요.').max(120),
  originLatitude: coordinate(-90, 90, '출발지 위도가 올바르지 않습니다.'),
  originLongitude: coordinate(-180, 180, '출발지 경도가 올바르지 않습니다.'),
  originProvider: z.enum(['naver', 'kakao']),
  originProviderPlaceId: z.string().trim().min(1).max(300),
  originSelectionToken: z.string().trim().min(1).max(2000),
  destination: z.string().trim().min(1, '목적지를 검색해 선택해 주세요.').max(120),
  destinationLatitude: coordinate(-90, 90, '목적지 위도가 올바르지 않습니다.'),
  destinationLongitude: coordinate(-180, 180, '목적지 경도가 올바르지 않습니다.'),
  destinationProvider: z.enum(['naver', 'kakao']),
  destinationProviderPlaceId: z.string().trim().min(1).max(300),
  destinationSelectionToken: z.string().trim().min(1).max(2000),
  hostMemo: z.preprocess(
    (value) => (typeof value === 'string' ? value : ''),
    z.string().trim().max(60, '방장 메모는 60자 이하여야 합니다.'),
  ),
  departureAt: departureAtSchema.refine(
    (value) => value.getTime() > Date.now(),
    '출발 시각은 현재 이후여야 합니다.',
  ),
  maxParticipants: z.coerce.number().int().min(2, '최대 인원은 2~4명이어야 합니다.').max(4, '최대 인원은 2~4명이어야 합니다.'),
  idempotencyKey: z.uuid('요청 식별자가 올바르지 않습니다.'),
})

export type CreateTripInput = z.infer<typeof createTripSchema>

export function parseCreateTripForm(formData: FormData) {
  const fields = [
    'origin', 'originLatitude', 'originLongitude', 'originProvider',
    'originProviderPlaceId', 'originSelectionToken', 'destination', 'destinationLatitude',
    'destinationLongitude', 'destinationProvider', 'destinationProviderPlaceId',
    'destinationSelectionToken',
    'hostMemo', 'departureAt', 'maxParticipants', 'idempotencyKey',
  ] as const
  return createTripSchema.safeParse(
    Object.fromEntries(fields.map((field) => [field, formData.get(field)])),
  )
}

export function resolveTripClosureStatus(confirmedParticipants: number) {
  if (!Number.isInteger(confirmedParticipants) || confirmedParticipants < 1 || confirmedParticipants > 4) {
    throw new RangeError('확정 인원은 방장을 포함해 1~4명이어야 합니다.')
  }
  return confirmedParticipants >= 2 ? 'CLOSED' : 'EXPIRED'
}
