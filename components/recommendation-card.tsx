import Link from 'next/link'
import { ArrowRight, Clock, MapPin, Sparkles, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import { formatDeparture, maskName } from '@/components/database-room-card'
import type { RankedRecommendation } from '@/lib/recommendations/rank'

export function RecommendationCard({
  recommendation,
}: {
  recommendation: RankedRecommendation
}) {
  return (
    <Card variant="selected" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge variant="brand" icon={Sparkles}>
          추천
        </StatusBadge>
        <StatusBadge variant="success">모집 중</StatusBadge>
        <StatusBadge variant="brand" icon={Users}>
          {recommendation.approvedCount}/{recommendation.maxParticipants}명
        </StatusBadge>
      </div>

      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span>{recommendation.origin}</span>
          <ArrowRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span>{recommendation.destination}</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          방장 {maskName(recommendation.hostName)}
        </p>
      </div>

      <p className="rounded-[14px] border border-brand/10 bg-brand-soft px-4 py-3 text-sm leading-relaxed text-ink">
        {recommendation.reason}
      </p>

      <dl className="grid grid-cols-2 gap-3 rounded-[14px] bg-surface-subtle p-4 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            출발지 거리
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {recommendation.originDistanceMeters.toLocaleString('ko-KR')}m
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            출발 시각
          </dt>
          <dd className="mt-0.5 font-semibold">
            {formatDeparture(recommendation.departureAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">예상 1인 분담금</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {recommendation.expectedSharePoints.toLocaleString('ko-KR')}P
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">잔여 좌석</dt>
          <dd className="mt-0.5 font-semibold">
            {recommendation.remainingSeats}석
          </dd>
        </div>
      </dl>

      <p className="text-xs leading-relaxed text-muted-foreground">
        동일한 지도 장소 ID의 목적지만 추천합니다. 참여는 상세 화면에서 직접
        신청해야 합니다.
      </p>

      <Link
        href={`/room/${recommendation.tripId}`}
        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[14px] bg-brand px-4 py-3 text-sm font-semibold text-white transition-transform hover:bg-brand-strong active:scale-[0.99]"
      >
        상세 확인 후 참여하기
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Card>
  )
}
