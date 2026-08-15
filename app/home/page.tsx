import Link from 'next/link'
import { Coins, Info, Plus } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { DatabaseRoomCard } from '@/components/database-room-card'
import { EmptyState } from '@/components/empty-state'
import { MobileShell } from '@/components/mobile-shell'
import { RecommendationCard } from '@/components/recommendation-card'
import { TabBar } from '@/components/tab-bar'
import { requireCompleteUser } from '@/lib/auth/session'
import { getCoreDashboard, getDiscoverableTrips } from '@/lib/core/service'
import { parseRecommendationSeedParam } from '@/lib/recommendations/seed'
import { getTripRecommendations } from '@/lib/recommendations/service'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ recommendFrom?: string | string[] }>
}) {
  const { recommendFrom } = await searchParams
  const explicitSeedTripId = parseRecommendationSeedParam(recommendFrom)
  const user = await requireCompleteUser()
  const [data, discoverableTrips, recommendationFeed] = await Promise.all([
    getCoreDashboard(user.userId, user.role === 'ADMIN'),
    getDiscoverableTrips(user.userId),
    getTripRecommendations(user.userId, explicitSeedTripId),
  ])

  return (
    <MobileShell>
      <header className="flex items-center justify-between px-5 pb-2 pt-6">
        <BrandLogo size="sm" />
        <Link
          href="/my-rooms"
          className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm font-normal text-primary transition-transform active:scale-95"
        >
          내 방
        </Link>
      </header>

      <main className="flex-1 px-5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">안녕하세요, {user.name}님</h1>

        <Link
          href="/points"
          className="mt-6 block rounded-[18px] bg-foreground p-6 text-background"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Coins className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-xs text-background/70">사용 가능 포인트</p>
                <p className="text-lg font-extrabold">
                  {Number(data.balance.availablePoints).toLocaleString('ko-KR')}P
                </p>
              </div>
            </div>
            <span className="rounded-full bg-background/15 px-3 py-1 text-xs font-semibold">
              내역 보기
            </span>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-background/70">
            <Info className="size-3.5" aria-hidden />
            포인트는 관리자가 지급하는 가상 포인트입니다.
          </p>
        </Link>

        <section className="mt-7" aria-labelledby="recommendation-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2
                id="recommendation-heading"
                className="text-lg font-extrabold"
              >
                조건이 맞는 추천
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                실제 방의 좌표·출발 시각·잔여 좌석을 계산한 결과입니다.
              </p>
              {recommendationFeed.seed ? (
                <p className="mt-1 text-xs font-semibold text-foreground">
                  기준: {recommendationFeed.seed.origin} →{' '}
                  {recommendationFeed.seed.destination}
                </p>
              ) : null}
            </div>
            {recommendationFeed.status === 'READY' ? (
              <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                최대 5개
              </span>
            ) : null}
          </div>

          {recommendationFeed.status === 'READY' ? (
            <div className="mt-4 flex flex-col gap-4">
              {recommendationFeed.recommendations.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.tripId}
                  recommendation={recommendation}
                />
              ))}
              {recommendationFeed.omittedForTraceFailure > 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  근거를 안전하게 저장하지 못한 일부 후보는 표시하지 않았습니다.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                label={
                  recommendationFeed.status === 'NO_SEED'
                    ? '좌표가 확인된 예정 방이 없어 추천 기준을 만들 수 없습니다.'
                    : recommendationFeed.status === 'TRACE_FAILED'
                      ? '추천 근거를 안전하게 저장하지 못해 결과를 표시하지 않습니다.'
                    : '같은 목적지·300m 이내·출발 전후 15분 조건을 모두 충족하는 방이 없습니다.'
                }
              />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                인접 목적지 추천은 허용 반경과 우회 정책 확정 후 제공합니다.
              </p>
            </div>
          )}
        </section>

        <section className="mt-7 pb-4" aria-labelledby="room-list-heading">
          <h2 id="room-list-heading" className="text-[21px] font-semibold tracking-tight">
            모집 방
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            실제 등록된 방의 출발 정보와 참여 현황을 확인하세요.
          </p>

          {discoverableTrips.length > 0 ? (
            <div className="mt-4 flex flex-col gap-4">
              {discoverableTrips.map((room) => (
                <DatabaseRoomCard
                  key={room.tripId}
                  room={room}
                  currentUserId={user.userId}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState label="현재 확인할 수 있는 모집 방이 없습니다." />
            </div>
          )}

          <Link
            href="/create"
            className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-primary bg-background px-6 py-3 text-[17px] font-normal text-primary transition-transform active:scale-95"
          >
            <Plus className="size-5" aria-hidden />
            새 동승 방 만들기
          </Link>
        </section>
      </main>

      <TabBar />
    </MobileShell>
  )
}
