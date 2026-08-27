'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Coordinates, RouteGeometry } from '@/lib/routing/types'

type KakaoMap = { setBounds(bounds: unknown): void }
type KakaoOverlay = { setMap(map: KakaoMap | null): void }

type KakaoMaps = {
  load(callback: () => void): void
  LatLng: new (latitude: number, longitude: number) => unknown
  Map: new (container: HTMLElement, options: object) => KakaoMap
  Marker: new (options: object) => KakaoOverlay
  Polyline: new (options: object) => KakaoOverlay
  MarkerImage?: new (src: string, size: unknown, options?: object) => unknown
  Size?: new (width: number, height: number) => unknown
  Point?: new (x: number, y: number) => unknown
  LatLngBounds: new () => { extend(point: unknown): void }
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps }
  }
}

function createMarkerImage(maps: KakaoMaps, color: string, label: '출' | '도') {
  if (!maps.MarkerImage || !maps.Size || !maps.Point) return undefined
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path fill="${color}" stroke="white" stroke-width="2" d="M17 1C8.7 1 2 7.7 2 16c0 11.3 15 25 15 25s15-13.7 15-25C32 7.7 25.3 1 17 1Z"/><text x="17" y="20" text-anchor="middle" fill="white" font-family="sans-serif" font-size="10" font-weight="700">${label}</text></svg>`
  return new maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new maps.Size(34, 42),
    { offset: new maps.Point(17, 42) },
  )
}

export function RouteMap({
  origin,
  destination,
  geometry,
  className,
}: {
  origin?: Coordinates | null
  destination?: Coordinates | null
  geometry?: RouteGeometry
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY
  const visibleError = key
    ? error
    : '카카오 지도 JavaScript 키가 설정되지 않았습니다.'

  useEffect(() => {
    if (!key || (!origin && !destination)) return

    let cancelled = false
    const overlays: KakaoOverlay[] = []

    const initialize = () => {
      const maps = window.kakao?.maps
      if (!maps || !container.current) {
        if (!cancelled) setError('지도를 불러오지 못했습니다.')
        return
      }
      maps.load(() => {
        if (cancelled || !container.current) return
        const first = origin ?? destination
        if (!first) return

        container.current.replaceChildren()
        const center = new maps.LatLng(first.latitude, first.longitude)
        const map = new maps.Map(container.current, { center, level: 6 })
        const bounds = new maps.LatLngBounds()
        const brandColor = getComputedStyle(container.current)
          .getPropertyValue('--brand')
          .trim()
        const displayPoints = [
          ...(origin ? [{ point: origin, label: '출' as const }] : []),
          ...(destination ? [{ point: destination, label: '도' as const }] : []),
        ]
        for (const { point, label } of displayPoints) {
          const position = new maps.LatLng(point.latitude, point.longitude)
          overlays.push(new maps.Marker({
            map,
            position,
            image: createMarkerImage(maps, brandColor, label),
          }))
          bounds.extend(position)
        }

        if (geometry?.kind === 'LINE_STRING' && geometry.points.length >= 2) {
          const path = geometry.points.map(
            (point) => new maps.LatLng(point.latitude, point.longitude),
          )
          overlays.push(
            new maps.Polyline({
              map,
              path,
              strokeWeight: 5,
              strokeColor: brandColor,
              strokeOpacity: 0.9,
              strokeStyle: 'solid',
            }),
          )
          for (const point of geometry.points) {
            bounds.extend(new maps.LatLng(point.latitude, point.longitude))
          }
        }

        if (displayPoints.length > 1 || geometry?.points.length) map.setBounds(bounds)
        setLoaded(true)
        setError(undefined)
      })
    }

    if (window.kakao?.maps) {
      initialize()
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-taxi-kakao-map]',
      )
      const script = existing ?? document.createElement('script')
      const onLoad = () => initialize()
      const onError = () => setError('지도 SDK를 불러오지 못했습니다.')
      script.addEventListener('load', onLoad)
      script.addEventListener('error', onError)
      if (!existing) {
        script.dataset.taxiKakaoMap = 'true'
        script.async = true
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`
        document.head.appendChild(script)
      }
      return () => {
        cancelled = true
        for (const overlay of overlays) overlay.setMap(null)
        script.removeEventListener('load', onLoad)
        script.removeEventListener('error', onError)
      }
    }

    return () => {
      cancelled = true
      for (const overlay of overlays) overlay.setMap(null)
    }
  }, [destination, geometry, key, origin, retryNonce])

  function retryMapLoad() {
    document.querySelector('script[data-taxi-kakao-map]')?.remove()
    setLoaded(false)
    setError(undefined)
    setRetryNonce((value) => value + 1)
  }

  const hasRoute = geometry?.kind === 'LINE_STRING' && geometry.points.length >= 2
  const markerLegend = [
    ...(origin ? ['출 출발지'] : []),
    ...(destination ? ['도 도착지'] : []),
  ].join(' · ')

  return (
    <div
      className={cn(
        'relative min-h-48 overflow-hidden rounded-[18px] border border-border bg-muted',
        className,
      )}
    >
      <div ref={container} className="absolute inset-0" aria-label="출발지와 도착지 지도" />
      {loaded && (origin || destination) ? (
        <p className="absolute bottom-2 left-2 rounded-md border border-border bg-background/95 px-2 py-1 text-xs font-semibold text-foreground">
          {markerLegend}{hasRoute ? ' · 예상 이동 경로' : ''}
        </p>
      ) : null}
      {visibleError ? (
        <div className="absolute inset-0 grid place-items-center bg-muted p-5 text-center text-sm text-muted-foreground" role="alert">
          <div>
            <p>{visibleError}</p>
            {key ? (
              <button
                type="button"
                onClick={retryMapLoad}
                className="mt-3 min-h-10 rounded-lg border border-border bg-background px-3 font-semibold text-foreground"
              >
                다시 시도
              </button>
            ) : null}
          </div>
        </div>
      ) : !origin && !destination ? (
        <p className="absolute inset-0 grid place-items-center p-5 text-center text-sm text-muted-foreground">
          장소를 선택하면 지도에 표시합니다.
        </p>
      ) : !loaded ? (
        <p className="absolute inset-0 grid place-items-center bg-muted p-5 text-center text-sm text-muted-foreground" role="status">
          지도를 불러오는 중…
        </p>
      ) : null}
    </div>
  )
}
