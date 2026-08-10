'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Coordinates } from '@/lib/routing/types'

type KakaoMaps = {
  load(callback: () => void): void
  LatLng: new (latitude: number, longitude: number) => unknown
  Map: new (container: HTMLElement, options: object) => {
    setBounds(bounds: unknown): void
  }
  Marker: new (options: object) => unknown
  LatLngBounds: new () => { extend(point: unknown): void }
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps }
  }
}

export function RouteMap({
  origin,
  destination,
  className,
}: {
  origin?: Coordinates | null
  destination?: Coordinates | null
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
    if (!key) return
    if (!origin && !destination) return

    const initialize = () => {
      const maps = window.kakao?.maps
      if (!maps || !container.current) {
        setError('지도를 불러오지 못했습니다.')
        return
      }
      maps.load(() => {
        if (!container.current) return
        const first = origin ?? destination
        if (!first) return
        const center = new maps.LatLng(first.latitude, first.longitude)
        const map = new maps.Map(container.current, { center, level: 6 })
        const bounds = new maps.LatLngBounds()
        for (const point of [origin, destination]) {
          if (!point) continue
          const position = new maps.LatLng(point.latitude, point.longitude)
          new maps.Marker({ map, position })
          bounds.extend(position)
        }
        if (origin && destination) map.setBounds(bounds)
        setLoaded(true)
        setError(undefined)
      })
    }

    if (window.kakao?.maps) {
      initialize()
      return
    }
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
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }
  }, [destination, key, origin, retryNonce])

  function retryMapLoad() {
    document.querySelector('script[data-taxi-kakao-map]')?.remove()
    setLoaded(false)
    setError(undefined)
    setRetryNonce((value) => value + 1)
  }

  return (
    <div
      className={cn(
        'relative min-h-48 overflow-hidden rounded-[18px] border border-border bg-muted',
        className,
      )}
    >
      <div ref={container} className="absolute inset-0" aria-label="출발지와 목적지 지도" />
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
          장소를 선택하면 지도에 표시됩니다.
        </p>
      ) : !loaded ? (
        <p className="absolute inset-0 grid place-items-center bg-muted p-5 text-center text-sm text-muted-foreground" role="status">
          지도를 불러오는 중...
        </p>
      ) : null}
    </div>
  )
}
