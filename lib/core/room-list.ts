export type RoomListItem = {
  hostUserId: string
  departureAt: string
  status: string
  currentUserStatus: string | null
}

const terminalRoomStatuses = new Set(['CANCELLED', 'EXPIRED', 'COMPLETED'])
const terminalParticipantStatuses = new Set(['CANCELLED', 'COMPLETED'])

function isTerminalRoom(room: RoomListItem) {
  return terminalRoomStatuses.has(room.status)
}

export function partitionMyRooms<TRoom extends RoomListItem>(
  rooms: TRoom[],
  userId: string,
) {
  const hosted = rooms.filter(
    (room) => room.hostUserId === userId && !isTerminalRoom(room),
  )
  const joined = rooms.filter(
    (room) =>
      room.hostUserId !== userId &&
      room.currentUserStatus !== null &&
      room.currentUserStatus !== 'CANCELLED' &&
      room.currentUserStatus !== 'COMPLETED' &&
      !isTerminalRoom(room),
  )
  const usageHistory = rooms.filter(
    (room) =>
      (room.hostUserId === userId && isTerminalRoom(room)) ||
      (room.hostUserId !== userId &&
        room.currentUserStatus !== null &&
        (isTerminalRoom(room) ||
          terminalParticipantStatuses.has(room.currentUserStatus))),
  )

  return { hosted, joined, usageHistory }
}
