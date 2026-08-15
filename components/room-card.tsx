import Link from 'next/link'
import { ArrowRight, Clock, Navigation, Sparkles, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import { AvatarStack } from '@/components/avatar'
import { formatPoints, type Room } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function RoomCard({ room }: { room: Room }) {
  const seatsLeft = room.maxSeats - room.members.length
  const closed = room.status === 'closed'

  return (
    <Card
      className={cn(
        'flex flex-col gap-3',
        closed && 'border-border bg-muted/45',
      )}
      aria-label={`${closed ? '모집 마감' : '모집 중'} 방`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {closed ? (
          <StatusBadge tone="muted">모집 마감</StatusBadge>
        ) : (
          <StatusBadge tone="mint">모집 중</StatusBadge>
        )}
        {!closed && seatsLeft > 0 ? (
          <StatusBadge tone="brand" icon={Users}>
            {seatsLeft}자리 남음
          </StatusBadge>
        ) : null}
        <StatusBadge tone="warn" icon={Clock}>
          출발 {room.minutesUntilDepart}분 전
        </StatusBadge>
      </div>

      <div className="flex items-center gap-2 text-lg font-bold">
        <span>{room.origin}</span>
        <ArrowRight className="size-4 text-muted-foreground" />
        <span>{room.destination}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-4" />
          {room.departLabel} 출발
        </span>
        <AvatarStack
          names={room.members.map((m) => m.displayName)}
          max={room.maxSeats}
        />
      </div>

      {/* AI 추천 이유 */}
      <div className="rounded-xl bg-info-soft p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-info">
          <Sparkles className="size-3.5" />
          AI 추천 이유
        </div>
        <ul className="flex flex-col gap-1 text-xs text-foreground/80">
          <li className="flex items-center gap-1.5">
            <Navigation className="size-3.5 text-info" />내 출발지에서{' '}
            {room.reason.fromOriginMeters}m
          </li>
          <li className="flex items-center gap-1.5">
            <Navigation className="size-3.5 text-info" />
            희망 목적지에서 {room.reason.toDestMeters}m
          </li>
          <li className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-info" />
            예상 우회 시간 약 {room.reason.detourMinutes}분
          </li>
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <div>
          <p className="text-xs text-muted-foreground">예상 1인 분담금</p>
          <p className="text-lg font-extrabold text-foreground">
            {formatPoints(room.perPersonPoints)}
          </p>
        </div>
        <Link
          href={`/room/${room.id}`}
          className="inline-flex items-center gap-1 rounded-full bg-foreground px-4 py-2.5 text-sm font-bold text-background transition-transform active:scale-95"
        >
          방 자세히 보기
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </Card>
  )
}
