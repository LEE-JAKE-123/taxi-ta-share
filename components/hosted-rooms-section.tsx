'use client'

import { useId, useState } from 'react'
import { Car } from 'lucide-react'
import {
  DatabaseRoomCard,
  type DatabaseRoomSummary,
} from '@/components/database-room-card'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

const INITIAL_HOSTED_ROOM_COUNT = 3

export function HostedRoomsSection({
  rooms,
  currentUserId,
}: {
  rooms: DatabaseRoomSummary[]
  currentUserId: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const remainingRooms = rooms.slice(INITIAL_HOSTED_ROOM_COUNT)
  const remainingRoomsId = useId()

  return (
    <section className="mt-7" aria-labelledby="hosted-rooms-heading">
      <div className="mb-3 flex items-center gap-2">
        <Car className="size-4 text-primary" aria-hidden />
        <h2 id="hosted-rooms-heading" className="text-sm font-semibold">
          내가 만든 방
        </h2>
      </div>
      {rooms.length > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            {rooms.slice(0, INITIAL_HOSTED_ROOM_COUNT).map((room) => (
              <DatabaseRoomCard
                key={room.tripId}
                room={room}
                currentUserId={currentUserId}
              />
            ))}
          </div>

          {remainingRooms.length > 0 ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                aria-expanded={isExpanded}
                aria-controls={remainingRoomsId}
                onClick={() => setIsExpanded((expanded) => !expanded)}
              >
                {isExpanded
                  ? '접기'
                  : `자세히 (${remainingRooms.length}개 더 보기)`}
              </Button>
              <div
                id={remainingRoomsId}
                hidden={!isExpanded}
                className="mt-3 flex flex-col gap-3"
              >
                {isExpanded
                  ? remainingRooms.map((room) => (
                      <DatabaseRoomCard
                        key={room.tripId}
                        room={room}
                        currentUserId={currentUserId}
                      />
                    ))
                  : null}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <EmptyState label="아직 만든 방이 없습니다." />
      )}
    </section>
  )
}
