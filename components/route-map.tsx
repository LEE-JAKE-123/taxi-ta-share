'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Coordinates, RouteGeometry } from '@/lib/routing/types'

type KakaoMap = { setBounds(bounds: unknown): void }
type KakaoOverlay = { setMap(map: KakaoMap | null): void }

type KakaoMaps = {
  load(callback: () => void): void
  event: {
    addListener(target: unknown, type: string, handler: () => void): void
    removeListener(target: unknown, type: string, handler: () => void): void
  }
  LatLng: new (latitude: number, longitude: number) => unknown
  Map: new (container: HTMLElement, options: object) => KakaoMap
  Marker: new (options: object) => KakaoOverlay
  Polyline: new (options: object) => KakaoOverlay
  MarkerImage?: new (src: string, size: unknown, options?: object) => unknown
  Size?: new (width: number, height: number) => unknown
  Point?: new (x: number, y: number) => unknown
  LatLngBounds: new () => { extend(point: unknown): void }
}

const KAKAO_MAP_RETRY_EVENT = 'taxi-kakao-map-retry'
const MAP_SDK_LOAD_TIMEOUT_MS = 10_000

function mapInitializationSignature({
  origin,
  destination,
  geometry,
  key,
  retryNonce,
}: {
  origin?: Coordinates | null
  destination?: Coordinates | null
  geometry?: RouteGeometry
  key?: string
  retryNonce: number
}) {
  const coordinateSignature = (point?: Coordinates | null) =>
    point ? `${point.latitude},${point.longitude}` : ''

  return [
    key ?? '',
    coordinateSignature(origin),
    coordinateSignature(destination),
    geometry?.kind ?? '',
    geometry?.points.map(coordinateSignature).join(';') ?? '',
    retryNonce,
  ].join('|')
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps }
  }
}

function createMarkerImage(maps: KakaoMaps, color: string, label: '출' | '도') {
  if (!maps.MarkerImage || !maps.Size || !maps.Point) return undefined
  const destinationCenter = label === '도'
    ? `<circle cx="17" cy="16" r="8" fill="white" stroke="${color}" stroke-width="2"/><text x="17" y="20" text-anchor="middle" fill="${color}" font-family="sans-serif" font-size="10" font-weight="700">${label}</text>`
    : `<text x="17" y="20" text-anchor="middle" fill="white" font-family="sans-serif" font-size="10" font-weight="700">${label}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path fill="${color}" stroke="white" stroke-width="2" d="M17 1C8.7 1 2 7.7 2 16c0 11.3 15 25 15 25s15-13.7 15-25C32 7.7 25.3 1 17 1Z"/>${destinationCenter}</svg>`
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
  const [error, setError] = useState<{ message: string; signature: string }>()
  const [loadedSignature, setLoadedSignature] = useState<string>()
  const [retryNonce, setRetryNonce] = useState(0)
  const resetViewportRef = useRef<(() => void) | null>(null)
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY
  const initializationSignature = mapInitializationSignature({
    origin,
    destination,
    geometry,
    key,
    retryNonce,
  })
  const initializationRef = useRef({
    origin,
    destination,
    geometry,
    key,
    signature: initializationSignature,
  })
  const latestInitializationSignatureRef = useRef(initializationSignature)
  useLayoutEffect(() => {
    initializationRef.current = {
      origin,
      destination,
      geometry,
      key,
      signature: initializationSignature,
    }
    latestInitializationSignatureRef.current = initializationSignature
    // The signature includes all snapshot fields, so equal cloned props do not reset the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializationSignature])
  const loaded = loadedSignature === initializationSignature
  const visibleError = key
    ? error?.signature === initializationSignature
      ? error.message
      : undefined
    : '카카오 지도 JavaScript 키가 설정되지 않았습니다.'

  useEffect(() => {
    const retry = () => {
      setError(undefined)
      setRetryNonce((value) => value + 1)
    }

    window.addEventListener(KAKAO_MAP_RETRY_EVENT, retry)
    return () => window.removeEventListener(KAKAO_MAP_RETRY_EVENT, retry)
  }, [])

  useEffect(() => {
    const {
      origin: effectOrigin,
      destination: effectDestination,
      geometry: effectGeometry,
      key: effectKey,
      signature: effectSignature,
    } = initializationRef.current
    if (!effectKey || (!effectOrigin && !effectDestination)) return

    let cancelled = false
    let mapsLoadTimedOut = false
    let mapsLoadTimeout: number | undefined
    let scriptLoadTimedOut = false
    let scriptLoadTimeout: number | undefined
    const overlays: KakaoOverlay[] = []
    resetViewportRef.current = null

    const isCurrentInitialization = () =>
      !cancelled &&
      latestInitializationSignatureRef.current === effectSignature

    const clearMapsLoadTimeout = () => {
      if (mapsLoadTimeout !== undefined) {
        window.clearTimeout(mapsLoadTimeout)
        mapsLoadTimeout = undefined
      }
    }
    const clearScriptLoadTimeout = () => {
      if (scriptLoadTimeout !== undefined) {
        window.clearTimeout(scriptLoadTimeout)
        scriptLoadTimeout = undefined
      }
    }
    const reportInitializationFailure = (message: string) => {
      if (isCurrentInitialization()) {
        setError({ message, signature: effectSignature })
      }
    }

    const initialize = () => {
      const maps = window.kakao?.maps
      if (!maps || !container.current) {
        reportInitializationFailure('지도를 불러오지 못했습니다.')
        return
      }
      mapsLoadTimeout = window.setTimeout(() => {
        mapsLoadTimedOut = true
        reportInitializationFailure('지도 SDK 초기화 시간이 초과되었습니다.')
      }, MAP_SDK_LOAD_TIMEOUT_MS)
      try {
        maps.load(() => {
        clearMapsLoadTimeout()
        if (mapsLoadTimedOut || !isCurrentInitialization() || !container.current) return
        try {
        const first = effectOrigin ?? effectDestination
        if (!first) return

        container.current.replaceChildren()
        const center = new maps.LatLng(first.latitude, first.longitude)
        const map = new maps.Map(container.current, { center, level: 6 })
        const bounds = new maps.LatLngBounds()
        const brandColor = getComputedStyle(container.current)
          .getPropertyValue('--brand')
          .trim()
        const displayPoints = [
          ...(effectOrigin ? [{ point: effectOrigin, label: '출' as const }] : []),
          ...(effectDestination ? [{ point: effectDestination, label: '도' as const }] : []),
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

        const canResetViewport = displayPoints.length > 1 || Boolean(effectGeometry?.points.length)
        const resetViewport = () => {
          if (!canResetViewport || cancelled) return
          map.setBounds(bounds)
        }
        if (effectGeometry?.kind === 'LINE_STRING' && effectGeometry.points.length >= 2) {
          const path = effectGeometry.points.map(
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
          for (const point of effectGeometry.points) {
            bounds.extend(new maps.LatLng(point.latitude, point.longitude))
          }
        }

        if (canResetViewport) {
          resetViewport()
          resetViewportRef.current = resetViewport
        }
        setLoadedSignature(effectSignature)
        setError(undefined)
        } catch {
          reportInitializationFailure('지도를 초기화하지 못했습니다.')
        }
        })
      } catch {
        clearMapsLoadTimeout()
        reportInitializationFailure('지도 SDK를 초기화하지 못했습니다.')
      }
    }

    if (window.kakao?.maps) {
      initialize()
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-taxi-kakao-map]',
      )
      const canReuseScript =
        existingScript?.dataset.taxiKakaoMapKey === effectKey &&
        existingScript.dataset.taxiKakaoMapStatus === 'loading'
      let script: HTMLScriptElement
      let appendScript = false
      if (canReuseScript && existingScript) {
        script = existingScript
      } else {
        existingScript?.remove()
        script = document.createElement('script')
        script.dataset.taxiKakaoMap = 'true'
        script.dataset.taxiKakaoMapKey = effectKey
        script.dataset.taxiKakaoMapStatus = 'loading'
        script.async = true
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(effectKey)}&autoload=false`
        appendScript = true
      }
      const onLoad = () => {
        clearScriptLoadTimeout()
        if (scriptLoadTimedOut) return
        script.dataset.taxiKakaoMapStatus = 'loaded'
        initialize()
      }
      const onError = () => {
        clearScriptLoadTimeout()
        script.dataset.taxiKakaoMapStatus = 'error'
        reportInitializationFailure('지도 SDK를 불러오지 못했습니다.')
      }
      script.addEventListener('load', onLoad)
      script.addEventListener('error', onError)
      scriptLoadTimeout = window.setTimeout(() => {
        scriptLoadTimedOut = true
        script.dataset.taxiKakaoMapStatus = 'error'
        reportInitializationFailure('지도 SDK를 불러오는 시간이 초과되었습니다.')
      }, MAP_SDK_LOAD_TIMEOUT_MS)
      if (appendScript) document.head.appendChild(script)
      return () => {
        cancelled = true
        clearMapsLoadTimeout()
        clearScriptLoadTimeout()
        resetViewportRef.current = null
        for (const overlay of overlays) overlay.setMap(null)
        script.removeEventListener('load', onLoad)
        script.removeEventListener('error', onError)
      }
    }

    return () => {
      cancelled = true
      clearMapsLoadTimeout()
      clearScriptLoadTimeout()
      resetViewportRef.current = null
      for (const overlay of overlays) overlay.setMap(null)
    }
  }, [initializationSignature])

  function retryMapLoad() {
    window.dispatchEvent(new Event(KAKAO_MAP_RETRY_EVENT))
  }

  const hasRoute = geometry?.kind === 'LINE_STRING' && geometry.points.length >= 2
  const routeStatus = hasRoute
    ? ' · 예상 이동 경로'
    : origin || destination
      ? ' · 경로 정보 없음'
      : ''
  const canResetViewport = Boolean(
    (origin && destination) || geometry?.points.length,
  )
  const markerLegend = [
    ...(origin ? ['출 출발지'] : []),
    ...(destination ? ['도 도착지'] : []),
  ].join(' · ')

  return (
    <figure
      aria-label={`지도: ${markerLegend || '장소 미선택'}${routeStatus}`}
      className={cn(
        'relative min-h-60 overflow-hidden rounded-[22px] border border-hairline bg-surface-subtle sm:min-h-72',
        className,
      )}
    >
      <div ref={container} className="absolute inset-0" />
      <figcaption className="sr-only">
        {markerLegend || '출발지와 도착지를 선택하면 지도에 표시됩니다.'}
        {routeStatus}
      </figcaption>
      {loaded && canResetViewport ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => resetViewportRef.current?.()}
          className="absolute right-3 top-3 z-10 bg-surface/95"
        >
          전체 경로 보기
        </Button>
      ) : null}
      {loaded && (origin || destination) ? (
        <p className="absolute bottom-3 left-3 rounded-[12px] border border-hairline bg-surface/95 px-3 py-2 text-xs font-semibold text-ink">
          {markerLegend}{routeStatus}
        </p>
      ) : null}
      {visibleError ? (
        <div className="absolute inset-0 grid place-items-center bg-surface-subtle p-5 text-center text-sm text-muted-foreground" role="alert">
          <div>
            <p>{visibleError}</p>
            {key ? (
              <Button
                type="button"
                onClick={retryMapLoad}
                variant="secondary"
                size="sm"
                className="mt-3"
              >
                다시 시도
              </Button>
            ) : null}
          </div>
        </div>
      ) : !origin && !destination ? (
        <p className="absolute inset-0 grid place-items-center p-5 text-center text-sm text-muted-foreground">
          장소를 선택하면 지도에 표시합니다.
        </p>
      ) : !loaded ? (
        <p className="absolute inset-0 grid place-items-center bg-surface-subtle p-5 text-center text-sm text-muted-foreground" role="status">
          지도를 불러오는 중…
        </p>
      ) : null}
    </figure>
  )
}
