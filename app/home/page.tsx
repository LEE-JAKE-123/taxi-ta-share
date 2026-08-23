import Link from 'next/link'
import { ArrowRight, Compass, Coins, MapPin, Plus, Route } from 'lucide-react'
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
      <header className="flex items-center justify-between px-5 pb-3 pt-6 lg:px-10">
        <BrandLogo size="sm" />
        <Link
          href="/my-rooms"
          className="inline-flex min-h-11 items-center rounded-[14px] border border-hairline bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-subtle"
        >
          내 방
        </Link>
      </header>

      <main className="flex-1 px-5 pb-5 lg:px-10">
        <p className="text-sm font-medium text-ink-secondary">안녕하세요, {user.name}님</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight text-ink">어디로 함께 갈까요?</h1>

        <section className="route-grid mt-6 overflow-hidden rounded-[22px] border border-hairline bg-surface p-6" aria-labelledby="route-hero-heading">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-brand-strong">ROUTE MATCH</p>
              <h2 id="route-hero-heading" className="mt-2 text-[21px] font-semibold text-ink">같은 방향의 동승 방을 찾아보세요</h2>
            </div>
            <Compass className="size-6 shrink-0 text-brand" aria-hidden />
          </div>
          <div className="mt-6 rounded-[18px] border border-brand/20 bg-brand-soft p-4">
            <div className="grid grid-cols-[24px_1fr] items-center gap-x-3 gap-y-2 text-sm">
              <MapPin className="size-4 text-brand" aria-hidden />
              <span className="font-semibold text-ink">출발지와 가까운 방</span>
              <span className="ml-2 h-4 border-l border-dashed border-brand/40" aria-hidden />
              <Route className="size-4 text-brand" aria-hidden />
              <span className="col-start-2 text-ink-secondary">도착 방향과 시간까지 비교</span>
            </div>
          </div>
          <Link
            href="/home#recommendation-heading"
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-brand/30 bg-brand-soft px-5 text-base font-semibold text-brand-strong transition-colors hover:bg-sage-soft active:scale-[0.98]"
          >
            추천 모집 찾기 <ArrowRight className="size-4" aria-hidden />
          </Link>
        </section>

        <section className="mt-8" aria-labelledby="recommendation-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.1em] text-brand">FOR YOUR ROUTE</p>
              <h2 id="recommendation-heading" className="mt-1 text-[21px] font-semibold">조건에 맞는 추천</h2>
            </div>
            {recommendationFeed.status === 'READY' ? <span className="text-xs text-ink-secondary">최대 5개</span> : null}
          </div>
          {recommendationFeed.status === 'READY' ? (
            <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-2">
              {recommendationFeed.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.tripId} recommendation={recommendation} />
              ))}
              {recommendationFeed.omittedForTraceFailure > 0 ? (
                <p className="text-xs leading-relaxed text-ink-secondary lg:col-span-2">근거를 안전하게 확인하지 못한 방은 추천 결과에 표시하지 않았습니다.</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4"><EmptyState label={recommendationFeed.status === 'NO_SEED' ? '좌표가 확인된 이용 방이 없어 추천 기준을 만들 수 없습니다.' : recommendationFeed.status === 'TRACE_FAILED' ? '추천 근거를 안전하게 확인하지 못해 결과를 표시하지 않습니다.' : '현재 조건에 맞는 추천 방이 없습니다. 출발지와 도착지를 설정하면 가까운 방을 추천해 드립니다.'} /></div>
          )}
        </section>

        <section className="mt-8" aria-labelledby="room-list-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.1em] text-ink-secondary">LEAVING SOON</p>
              <h2 id="room-list-heading" className="mt-1 text-[21px] font-semibold">곧 출발하는 모집</h2>
            </div>
            <Link
              href="/rooms"
              aria-label="전체 모집 목록 보기"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-brand transition-colors hover:text-brand-strong"
            >
              더보기 <ArrowRight className="ml-1 size-4" aria-hidden />
            </Link>
          </div>
          {discoverableTrips.length > 0 ? (
            <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-2">
              {discoverableTrips.slice(0, 3).map((room) => <DatabaseRoomCard key={room.tripId} room={room} currentUserId={user.userId} />)}
            </div>
          ) : (
            <div className="mt-4"><EmptyState label="현재 확인할 수 있는 모집 방이 없습니다." /></div>
          )}
          <Link href="/create" className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-brand/30 bg-brand-soft px-5 text-base font-semibold text-brand-strong hover:bg-sage-soft">
            <Plus className="size-4" aria-hidden /> 새 동승 방 만들기
          </Link>
        </section>

        <Link href="/points" className="mt-8 flex items-center justify-between rounded-[18px] border border-hairline bg-surface p-5 transition-colors hover:bg-surface-subtle">
          <span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-[14px] bg-brand-soft text-brand"><Coins className="size-5" aria-hidden /></span><span><span className="block text-xs text-ink-secondary">사용 가능 포인트</span><strong className="numeric mt-0.5 block text-lg font-semibold">{Number(data.balance.availablePoints).toLocaleString('ko-KR')}P</strong></span></span>
          <ArrowRight className="size-4 text-ink-tertiary" aria-hidden />
        </Link>
      </main>
      <TabBar />
    </MobileShell>
  )
}
