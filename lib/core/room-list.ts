export type RoomListItem = {
  hostUserId: string
  departureAt: string
  status: string
  currentUserStatus: string | null
}

export function partitionMyRooms<TRoom extends RoomListItem>(
  rooms: TRoom[],
  userId: string,
) {
  const hosted = rooms.filter(
    (room) => room.hostUserId === userId && room.status !== 'COMPLETED',
  )
  const joined = rooms.filter(
    (room) =>
      room.hostUserId !== userId &&
      room.currentUserStatus !== null &&
      room.status !== 'COMPLETED',
  )
  const usageHistory = rooms.filter(
    (room) =>
      room.status === 'COMPLETED' && room.currentUserStatus === 'COMPLETED',
  )

  return { hosted, joined, usageHistory }
}
