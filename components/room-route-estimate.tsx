'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Coordinates, RouteEstimate } from '@/lib/routing/types'

export function RoomRouteEstimate({
  origin,
  destination,
  maxParticipants,
}: {
  origin: Coordinates
  destination: Coordinates
  maxParticipants: number
}) {
  const [estimate, setEstimate] = useState<RouteEstimate | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/route-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      })
      const body = (await response.json()) as { estimate?: RouteEstimate; error?: string }
      if (!response.ok || !body.estimate) throw new Error(body.error || '경로를 조회하지 못했습니다.')
      setEstimate(body.estimate)
    } catch (reason) {
      setEstimate(null)
      setError(reason instanceof Error ? reason.message : '경로를 조회하지 못했습니다.')
    } finally { setLoading(false) }
  }, [destination, origin])
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  if (loading) return <Card variant="subtle" className="p-4 text-sm" role="status">지도 API 경로·예상 요금 조회 중...</Card>
  if (error) return <Card className="border-warning bg-warn-soft p-4 text-sm" role="alert"><p>{error}</p><Button type="button" variant="secondary" size="sm" onClick={() => void load()} className="mt-3">다시 시도</Button></Card>
  if (!estimate) return null
  return <Card className="border-info bg-info-soft p-4 text-sm">
    <p className="font-semibold">지도 API 경로·예상 요금 · 현재 참고값</p>
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
      <div><dt className="text-xs text-muted-foreground">거리 · 시간</dt><dd className="numeric mt-1 font-semibold">{(estimate.distanceMeters / 1000).toFixed(1)}km · {Math.ceil(estimate.durationSeconds / 60)}분</dd></div>
      <div><dt className="text-xs text-muted-foreground">예상 요금</dt><dd className="numeric mt-1 font-semibold">{estimate.estimatedFareWon === null ? '요금 정보 없음' : `${estimate.estimatedFareWon.toLocaleString('ko-KR')}원`}</dd></div>
      <div className="col-span-2"><dt className="text-xs text-muted-foreground">최대 인원 기준 1인 예상</dt><dd className="numeric mt-1 font-semibold">{estimate.estimatedFareWon === null ? '계산할 수 없음' : `${Math.ceil(estimate.estimatedFareWon / maxParticipants).toLocaleString('ko-KR')}P`}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted-foreground">
      {estimate.provider === 'kakao' ? '카카오' : '네이버'} · {new Date(estimate.calculatedAt).toLocaleString('ko-KR')} 산정
    </p>
    <p className="mt-1 text-xs text-muted-foreground">확정 시 서버가 다시 산정하며 실제 예치 기준과 달라질 수 있습니다.</p>
  </Card>
}
