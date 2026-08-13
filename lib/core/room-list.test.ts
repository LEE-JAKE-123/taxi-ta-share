import { describe, expect, it } from 'vitest'
import { partitionMyRooms } from './room-list'

describe('partitionMyRooms', () => {
  it('keeps pending settlement rooms active and moves completed participant rooms to usage history', () => {
    const rooms = [
      {
        tripId: 'host-active',
        hostUserId: 'user-1',
        status: 'SETTLEMENT_PENDING',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'DEPOSITED',
      },
      {
        tripId: 'joined-completed',
        hostUserId: 'user-2',
        status: 'COMPLETED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'COMPLETED',
      },
      {
        tripId: 'host-completed',
        hostUserId: 'user-1',
        status: 'COMPLETED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'COMPLETED',
      },
      {
        tripId: 'completed-without-participation',
        hostUserId: 'user-4',
        status: 'COMPLETED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: null,
      },
      {
        tripId: 'completed-before-participant-completion',
        hostUserId: 'user-5',
        status: 'COMPLETED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'DEPOSITED',
      },
      {
        tripId: 'expired',
        hostUserId: 'user-3',
        status: 'EXPIRED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'APPLIED',
      },
    ]

    const result = partitionMyRooms(rooms, 'user-1')

    expect(result.hosted.map((room) => room.tripId)).toEqual(['host-active'])
    expect(result.joined.map((room) => room.tripId)).toEqual(['expired'])
    expect(result.usageHistory.map((room) => room.tripId)).toEqual([
      'joined-completed',
      'host-completed',
    ])
  })
})
