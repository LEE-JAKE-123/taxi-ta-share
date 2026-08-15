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
    <Card className="flex flex-col gap-3 border-primary/40">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone="brand" icon={Sparkles}>
          추천
        </StatusBadge>
        <StatusBadge tone="mint">모집 중</StatusBadge>
        <StatusBadge tone="info" icon={Users}>
          {recommendation.approvedCount}/{recommendation.maxParticipants}명
        </StatusBadge>
      </div>

      <div>
        <h3 className="flex items-center gap-2 text-lg font-extrabold">
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

      <p className="rounded-xl bg-primary/10 px-3 py-3 text-sm font-semibold leading-relaxed">
        {recommendation.reason}
      </p>

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/70 p-3 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            출발지 거리
          </dt>
          <dd className="mt-0.5 font-extrabold">
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
          <dd className="mt-0.5 font-extrabold">
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
        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-foreground px-4 py-3 text-sm font-bold text-background transition-transform active:scale-[0.99]"
      >
        상세 확인 후 참여하기
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Card>
  )
}
