import Link from 'next/link'
import { Plus } from 'lucide-react'
import { DatabaseRoomCard } from '@/components/database-room-card'
import { EmptyState } from '@/components/empty-state'
import { MobileShell } from '@/components/mobile-shell'
import { TabBar } from '@/components/tab-bar'
import { TopBar } from '@/components/top-bar'
import { requireCompleteUser } from '@/lib/auth/session'
import { getDiscoverableTrips } from '@/lib/core/service'

export default async function RoomsPage() {
  const user = await requireCompleteUser()
  const rooms = await getDiscoverableTrips(user.userId)

  return (
    <MobileShell>
      <TopBar
        title="모집 방"
        subtitle="같은 방향의 동승 방을 찾아보세요"
        backHref="/home"
      />
      <main className="flex-1 px-5 py-5 lg:px-10">
        <section aria-labelledby="discoverable-rooms-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.1em] text-brand">DISCOVER ROOMS</p>
              <h2 id="discoverable-rooms-heading" className="mt-1 text-[21px] font-semibold text-ink">
                참여할 수 있는 모집
              </h2>
            </div>
            <span className="text-xs text-ink-secondary">{rooms.length}개</span>
          </div>

          {rooms.length > 0 ? (
            <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-2">
              {rooms.map((room) => (
                <DatabaseRoomCard
                  key={room.tripId}
                  room={room}
                  currentUserId={user.userId}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState label="현재 참여할 수 있는 모집 방이 없습니다." />
            </div>
          )}
        </section>

        <Link
          href="/create"
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-brand/30 bg-brand-soft px-5 text-base font-semibold text-brand-strong transition-colors hover:bg-sage-soft active:scale-[0.98]"
        >
          <Plus className="size-4" aria-hidden /> 새 동승 방 만들기
        </Link>
      </main>
      <TabBar />
    </MobileShell>
  )
}
