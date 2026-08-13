import { Car, UsersRound } from 'lucide-react'
import { DatabaseRoomCard } from '@/components/database-room-card'
import { EmptyState } from '@/components/empty-state'
import { MobileShell } from '@/components/mobile-shell'
import { TabBar } from '@/components/tab-bar'
import { TopBar } from '@/components/top-bar'
import { requireCompleteUser } from '@/lib/auth/session'
import { partitionMyRooms } from '@/lib/core/room-list'
import { getCoreDashboard } from '@/lib/core/service'

export default async function MyRoomsPage() {
  const user = await requireCompleteUser()
  const data = await getCoreDashboard(user.userId, user.role === 'ADMIN')
  const { hosted, joined, usageHistory } = partitionMyRooms(data.trips, user.userId)

  return (
    <MobileShell>
      <TopBar title="내 방" backHref="/home" />
      <main className="flex-1 px-5 pb-4 pt-4">
        <section className="mb-7" aria-labelledby="hosted-rooms-heading">
          <div className="mb-3 flex items-center gap-2">
            <Car className="size-4 text-primary" aria-hidden />
            <h2 id="hosted-rooms-heading" className="text-sm font-semibold">
              내가 만든 방
            </h2>
          </div>
          {hosted.length > 0 ? (
            <div className="flex flex-col gap-3">
              {hosted.map((room) => (
                <DatabaseRoomCard
                  key={room.tripId}
                  room={room}
                  currentUserId={user.userId}
                />
              ))}
            </div>
          ) : (
            <EmptyState label="아직 만든 방이 없습니다." />
          )}
        </section>

        <section aria-labelledby="joined-rooms-heading">
          <div className="mb-3 flex items-center gap-2">
            <UsersRound className="size-4 text-mint" aria-hidden />
            <h2 id="joined-rooms-heading" className="text-sm font-semibold">
              신청하거나 참여 중인 방
            </h2>
          </div>
          {joined.length > 0 ? (
            <div className="flex flex-col gap-3">
              {joined.map((room) => (
                <DatabaseRoomCard
                  key={room.tripId}
                  room={room}
                  currentUserId={user.userId}
                />
              ))}
            </div>
          ) : (
            <EmptyState label="신청하거나 참여 중인 방이 없습니다." />
          )}
        </section>

        <section className="mt-7" aria-labelledby="usage-history-heading">
          <div className="mb-3 flex items-center gap-2">
            <Car className="size-4 text-muted-foreground" aria-hidden />
            <h2 id="usage-history-heading" className="text-sm font-semibold">
              이용 기록
            </h2>
          </div>
          {usageHistory.length > 0 ? (
            <div className="flex flex-col gap-3">
              {usageHistory.map((room) => (
                <DatabaseRoomCard
                  key={room.tripId}
                  room={room}
                  currentUserId={user.userId}
                />
              ))}
            </div>
          ) : (
            <EmptyState label="아직 완료된 이용 기록이 없습니다." />
          )}
        </section>
      </main>
      <TabBar />
    </MobileShell>
  )
}
