import { describe, expect, it } from 'vitest'
import { partitionMyRooms } from './room-list'

describe('partitionMyRooms', () => {
  it('keeps pending settlement rooms active, including no-show and disputed participants', () => {
    const rooms = [
      {
        tripId: 'host-active',
        hostUserId: 'user-1',
        status: 'SETTLEMENT_PENDING',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'DEPOSITED',
      },
      {
        tripId: 'joined-pending-no-show',
        hostUserId: 'user-2',
        status: 'SETTLEMENT_PENDING',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'NO_SHOW',
      },
      {
        tripId: 'joined-pending-disputed',
        hostUserId: 'user-3',
        status: 'SETTLEMENT_PENDING',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'DISPUTED',
      },
      {
        tripId: 'joined-cancelled-participation',
        hostUserId: 'user-4',
        status: 'OPEN',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'CANCELLED',
      },
      {
        tripId: 'joined-completed-participation',
        hostUserId: 'user-5',
        status: 'SETTLEMENT_PENDING',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'COMPLETED',
      },
    ]

    const result = partitionMyRooms(rooms, 'user-1')

    expect(result.hosted.map((room) => room.tripId)).toEqual(['host-active'])
    expect(result.joined.map((room) => room.tripId)).toEqual([
      'joined-pending-no-show',
      'joined-pending-disputed',
    ])
    expect(result.usageHistory.map((room) => room.tripId)).toEqual([
      'joined-cancelled-participation',
      'joined-completed-participation',
    ])
  })

  it('moves terminal rooms into history only for their host or participant', () => {
    const rooms = [
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
      {
        tripId: 'host-cancelled',
        hostUserId: 'user-1',
        status: 'CANCELLED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'CANCELLED',
      },
      {
        tripId: 'joined-cancelled',
        hostUserId: 'user-6',
        status: 'CANCELLED',
        departureAt: '2026-08-12T12:00:00.000Z',
        currentUserStatus: 'CANCELLED',
      },
    ]

    const result = partitionMyRooms(rooms, 'user-1')

    expect(result.hosted).toEqual([])
    expect(result.joined).toEqual([])
    expect(result.usageHistory.map((room) => room.tripId)).toEqual([
      'joined-completed',
      'host-completed',
      'completed-before-participant-completion',
      'expired',
      'host-cancelled',
      'joined-cancelled',
    ])
  })
})
