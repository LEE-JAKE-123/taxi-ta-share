import { describe, expect, it } from 'vitest'
import { createTripSchema, resolveTripClosureStatus } from './trip-validation'

const valid = {
  origin: ' 전북대학교 정문 ',
  originLatitude: '35.846',
  originLongitude: '127.129',
  originProvider: 'kakao',
  originProviderPlaceId: 'origin-id',
  originSelectionToken: 'origin-token',
  destination: '전주역',
  destinationLatitude: '35.8584',
  destinationLongitude: '127.1617',
  destinationProvider: 'kakao',
  destinationProviderPlaceId: 'destination-id',
  destinationSelectionToken: 'destination-token',
  departureAt: '2099-01-01T12:00:00.000Z',
  maxParticipants: '3',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
}

describe('createTripSchema', () => {
  it('normalizes a searched route', () => {
    const result = createTripSchema.parse(valid)
    expect(result.origin).toBe('전북대학교 정문')
    expect(result.originLatitude).toBe(35.846)
    expect(result.maxParticipants).toBe(3)
    expect(result.hostMemo).toBe('')
  })

  it.each([
    { maxParticipants: 1 },
    { maxParticipants: 5 },
    { originLatitude: 91 },
    { destinationLongitude: -181 },
    { originProviderPlaceId: '' },
    { destinationProvider: 'fixture' },
    { departureAt: '2020-01-01T00:00:00.000Z' },
    { hostMemo: '가'.repeat(61) },
  ])('rejects invalid route creation input: %o', (patch) => {
    expect(createTripSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})

describe('resolveTripClosureStatus', () => {
  it.each([[1, 'EXPIRED'], [2, 'CLOSED'], [4, 'CLOSED']] as const)(
    'maps %i confirmed participants to %s',
    (count, expected) => expect(resolveTripClosureStatus(count)).toBe(expected),
  )
  it.each([0, 5, 2.5])('rejects invalid count %s', (count) => {
    expect(() => resolveTripClosureStatus(count)).toThrow(RangeError)
  })
})
