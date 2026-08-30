'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  Clock,
  MapPin,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { formatDeparture, maskName } from '@/components/database-room-card'
import { cn } from '@/lib/utils'
import type { PlaceRecommendation } from '@/lib/recommendations/place-search'
import type { SelectablePlaceResult } from '@/lib/routing/types'

export function PlaceRecommendationSearch() {
  const [origin, setOrigin] = useState<SelectablePlaceResult | null>(null)
  const [destination, setDestination] =
    useState<SelectablePlaceResult | null>(null)
  const [recommendations, setRecommendations] = useState<PlaceRecommendation[]>(
    [],
  )
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [searched, setSearched] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!origin || !destination) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setMessage('')
      fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            recommendations?: PlaceRecommendation[]
            error?: string
          }
          if (!response.ok || !body.recommendations) {
            throw new Error(body.error || '추천을 계산하지 못했습니다.')
          }
          setRecommendations(body.recommendations)
          setSearched(true)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setRecommendations([])
          setSearched(true)
          setMessage(
            error instanceof Error
              ? error.message
              : '추천을 계산하지 못했습니다.',
          )
        })
        .finally(() => setLoading(false))
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [destination, origin, retryNonce])

  function retryRecommendations() {
    if (!origin || !destination || loading) return
    setSearched(false)
    setMessage('')
    setRetryNonce((value) => value + 1)
  }

  return (
    <section className="mt-7" aria-labelledby="place-recommendation-heading">
      <div>
        <h2 id="place-recommendation-heading" className="text-[21px] font-semibold">
          어디로 이동하시나요?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          출발지와 목적지만 선택하면 가까운 모집 방을 바로 추천합니다.
        </p>
      </div>

      <Card className="mt-4 flex flex-col gap-4">
        <PlacePicker
          label="출발지"
          value={origin}
          onChange={(place) => {
            setOrigin(place)
            setRecommendations([])
            setSearched(false)
            setMessage('')
          }}
        />
        <PlacePicker
          label="목적지"
          value={destination}
          onChange={(place) => {
            setDestination(place)
            setRecommendations([])
            setSearched(false)
            setMessage('')
          }}
        />
        {!origin || !destination ? (
          <Card variant="subtle" className="p-4 text-sm" role="status">
            검색 후 표시되는 결과에서 출발지와 목적지를 각각 선택해 주세요.
            두 장소가 모두 <strong>선택됨</strong> 상태가 되면 추천이 자동으로
            시작됩니다.
          </Card>
        ) : null}
        {loading ? (
          <Card variant="subtle" className="p-4 text-sm" role="status">
            거리와 경로 유사도를 계산하는 중...
          </Card>
        ) : null}
        {message ? (
          <Card variant="subtle" className="border border-warning/20 bg-warning-soft p-4 text-sm" role="alert">
            <p>{message}</p>
            <Button
              type="button"
              onClick={retryRecommendations}
              disabled={!origin || !destination || loading}
              variant="secondary"
              size="sm"
              className="mt-3"
            >
              다시 시도
            </Button>
          </Card>
        ) : null}
      </Card>

      {!loading && recommendations.length ? (
        <div className="mt-4 flex flex-col gap-4">
          {recommendations.map((item) => (
            <RecommendationResult key={item.tripId} item={item} />
          ))}
        </div>
      ) : null}

      {!loading && searched && !message && recommendations.length === 0 ? (
        <Card className="mt-4 text-center">
          <p className="font-semibold">현재 함께 탑승 가능한 방이 없습니다.</p>
          <Link
            href="/create"
            className={cn(buttonVariants({ variant: 'primary', size: 'default' }), 'mt-4')}
          >
            새로운 방 만들기
          </Link>
        </Card>
      ) : null}
    </section>
  )
}

function PlacePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: SelectablePlaceResult | null
  onChange: (place: SelectablePlaceResult | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SelectablePlaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  async function search() {
    setSearching(true)
    setError('')
    setResults([])
    onChange(null)
    try {
      const response = await fetch(
        `/api/places?q=${encodeURIComponent(query.trim())}`,
        { cache: 'no-store' },
      )
      const body = (await response.json()) as {
        places?: SelectablePlaceResult[]
        error?: string
      }
      if (!response.ok || !body.places) {
        throw new Error(body.error || '장소를 검색하지 못했습니다.')
      }
      setResults(body.places)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '장소를 검색하지 못했습니다.',
      )
    } finally {
      setSearching(false)
    }
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-semibold" htmlFor={`${label}-query`}>
        <MapPin className="mr-1 inline size-4" aria-hidden />
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={`${label}-query`}
          value={query}
          maxLength={100}
          className="app-input app-input-search"
          placeholder={`${label} 검색`}
          onChange={(event) => {
            setQuery(event.target.value)
            if (value) onChange(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void search()
            }
          }}
        />
        <Button
          type="button"
          aria-label={`${label} 검색`}
          disabled={searching || !query.trim()}
          onClick={() => void search()}
          size="icon-sm"
        >
          <Search className="size-4" aria-hidden />
        </Button>
      </div>
      {results.length ? (
        <div className="mt-2 rounded-xl border bg-card p-2">
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">
            검색 결과 · 사용할 장소를 선택하세요
          </p>
          <ul>
          {results.map((place) => (
            <li key={`${place.provider}:${place.providerPlaceId}`}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted"
                onClick={() => {
                  onChange(place)
                  setQuery(place.label)
                  setResults([])
                }}
              >
                <span>{place.label}</span>
                <span className="shrink-0 text-xs font-semibold text-primary">
                  이 장소 선택
                </span>
              </button>
            </li>
          ))}
          </ul>
        </div>
      ) : null}
      {value ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-mint">
          <Check className="size-3.5" aria-hidden />
          선택됨: {value.label}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function RecommendationResult({ item }: { item: PlaceRecommendation }) {
  return (
    <Card className="flex flex-col gap-3 border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant="brand" icon={Sparkles}>
          추천 점수 {item.score}
        </StatusBadge>
        <StatusBadge variant="brand" icon={Users}>
          {item.approvedCount}/{item.maxParticipants}명
        </StatusBadge>
      </div>
      <div>
        <h3 className="flex items-center gap-2 text-lg font-extrabold">
          <span>{item.origin}</span>
          <ArrowRight className="size-4" aria-hidden />
          <span>{item.destination}</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          모집자 {maskName(item.hostName)}
        </p>
      </div>
      <p className="rounded-xl bg-primary/10 p-3 text-sm font-semibold">
        {item.reason}
      </p>
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">출발 예정</dt>
          <dd className="mt-1 flex items-center gap-1 font-semibold">
            <Clock className="size-3.5" aria-hidden />
            {formatDeparture(item.departureAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">예상 절감</dt>
          <dd
            className={`mt-1 font-extrabold ${
              item.fareIsFresh ? 'text-mint' : 'text-muted-foreground'
            }`}
          >
            {item.estimatedSavingsPoints === null
              ? '요금 재산정 필요'
              : `${item.estimatedSavingsPoints.toLocaleString('ko-KR')}P`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">출발지 거리</dt>
          <dd className="mt-1 font-semibold">{item.originDistanceMeters}m</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">경로 유사도</dt>
          <dd className="mt-1 font-semibold">{item.routeSimilarityPercent}%</dd>
        </div>
      </dl>
      <Link
        href={`/room/${item.tripId}`}
        className={buttonVariants({ variant: 'dark', size: 'default' })}
      >
        상세 확인 후 참여 신청
      </Link>
    </Card>
  )
}
