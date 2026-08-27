import { RoutingError } from './errors'
import { createRouteEvidence, normalizeRouteGeometry } from './evidence'
import { fetchJson } from './http'
import type {
  Coordinates,
  PlaceResult,
  RoutingAdapter,
} from './types'

type KakaoPlaceDocument = {
  id?: unknown
  place_name?: unknown
  address_name?: unknown
  x?: unknown
  y?: unknown
}

type KakaoDirectionsResponse = {
  routes?: Array<{
    result_code?: unknown
    summary?: {
      distance?: unknown
      duration?: unknown
      fare?: { taxi?: unknown }
    }
    sections?: Array<{
      roads?: Array<{ vertexes?: unknown }>
    }>
  }>
}

function key() {
  const value = process.env.KAKAO_REST_API_KEY?.trim()
  if (!value) {
    throw new RoutingError(
      'NOT_CONFIGURED',
      '카카오 지도 서버 키가 설정되지 않았습니다.',
    )
  }
  return value
}

function positiveInteger(value: unknown, field: string) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new RoutingError(
      'MALFORMED_RESPONSE',
      `카카오 ${field} 응답이 올바르지 않습니다.`,
      true,
    )
  }
  return value
}

function routePoints(route: NonNullable<KakaoDirectionsResponse['routes']>[number]) {
  const points: Coordinates[] = []
  for (const section of route.sections ?? []) {
    for (const road of section.roads ?? []) {
      if (!Array.isArray(road.vertexes)) continue
      for (let index = 0; index + 1 < road.vertexes.length; index += 2) {
        const longitude = road.vertexes[index]
        const latitude = road.vertexes[index + 1]
        if (typeof latitude !== 'number' || typeof longitude !== 'number') continue
        points.push({ latitude, longitude })
      }
    }
  }
  return normalizeRouteGeometry(points)
}

export const kakaoRoutingAdapter: RoutingAdapter = {
  provider: 'kakao',

  async searchPlaces(query) {
    const url = new URL(
      'https://dapi.kakao.com/v2/local/search/keyword.json',
    )
    url.searchParams.set('query', query)
    url.searchParams.set('size', '10')
    const body = (await fetchJson(url, {
      headers: { Authorization: `KakaoAK ${key()}` },
    })) as { documents?: KakaoPlaceDocument[] }

    if (!Array.isArray(body.documents)) {
      throw new RoutingError(
        'MALFORMED_RESPONSE',
        '카카오 장소 검색 응답이 올바르지 않습니다.',
        true,
      )
    }

    const places = body.documents.flatMap((item): PlaceResult[] => {
      const latitude = Number(item.y)
      const longitude = Number(item.x)
      const label =
        typeof item.place_name === 'string' && item.place_name.trim()
          ? item.place_name.trim()
          : typeof item.address_name === 'string'
            ? item.address_name.trim()
            : ''
      const providerPlaceId =
        typeof item.id === 'string' ? item.id.trim() : ''
      if (
        !label ||
        !providerPlaceId ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        return []
      }
      return [
        {
          label,
          latitude,
          longitude,
          provider: 'kakao',
          providerPlaceId,
        },
      ]
    })

    if (!places.length) {
      throw new RoutingError('NOT_FOUND', '검색 결과가 없습니다.')
    }
    return places
  },

  async estimateRoute(origin, destination) {
    const url = new URL(
      'https://apis-navi.kakaomobility.com/v1/directions',
    )
    url.searchParams.set(
      'origin',
      `${origin.longitude},${origin.latitude}`,
    )
    url.searchParams.set(
      'destination',
      `${destination.longitude},${destination.latitude}`,
    )
    url.searchParams.set('priority', 'RECOMMEND')

    const body = (await fetchJson(url, {
      headers: { Authorization: `KakaoAK ${key()}` },
    })) as KakaoDirectionsResponse
    const route = body.routes?.[0]
    if (!route || route.result_code !== 0 || !route.summary) {
      throw new RoutingError('NOT_FOUND', '자동차 경로를 찾지 못했습니다.')
    }

    const distanceMeters = positiveInteger(
      route.summary.distance,
      '경로 거리',
    )
    const durationSeconds = positiveInteger(
      route.summary.duration,
      '경로 시간',
    )
    const fare = route.summary.fare?.taxi
    const estimatedFareWon =
      typeof fare === 'number' &&
      Number.isSafeInteger(fare) &&
      fare > 0 &&
      fare <= 1_000_000
        ? fare
        : null

    return createRouteEvidence({
      provider: 'kakao',
      origin,
      destination,
      distanceMeters,
      durationSeconds,
      estimatedFareWon,
      geometry: routePoints(route),
    })
  },
}
