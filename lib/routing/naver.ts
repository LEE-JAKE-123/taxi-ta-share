import { createHash } from 'node:crypto'
import { RoutingError } from './errors'
import { createRouteEvidence, normalizeRouteGeometry } from './evidence'
import { fetchJson } from './http'
import type {
  Coordinates,
  PlaceResult,
  RoutingAdapter,
} from './types'

type NaverGeocodeAddress = {
  roadAddress?: unknown
  jibunAddress?: unknown
  englishAddress?: unknown
  x?: unknown
  y?: unknown
}

type NaverDirectionsResponse = {
  code?: unknown
  route?: {
    traoptimal?: Array<{
      summary?: {
        distance?: unknown
        duration?: unknown
        taxiFare?: unknown
      }
      path?: unknown
    }>
  }
}

function credentials() {
  const clientId = process.env.NAVER_MAPS_CLIENT_ID?.trim()
  const clientSecret = process.env.NAVER_MAPS_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new RoutingError(
      'NOT_CONFIGURED',
      '네이버 지도 서버 키가 설정되지 않았습니다.',
    )
  }
  return { clientId, clientSecret }
}

function headers() {
  const { clientId, clientSecret } = credentials()
  return {
    'x-ncp-apigw-api-key-id': clientId,
    'x-ncp-apigw-api-key': clientSecret,
  }
}

function positiveInteger(value: unknown, field: string) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new RoutingError(
      'MALFORMED_RESPONSE',
      `네이버 ${field} 응답이 올바르지 않습니다.`,
      true,
    )
  }
  return value
}

function routePoints(path: unknown) {
  if (!Array.isArray(path)) return undefined
  const points: Coordinates[] = []
  for (const point of path) {
    if (!Array.isArray(point) || point.length < 2) continue
    const [longitude, latitude] = point
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue
    points.push({ latitude, longitude })
  }
  return normalizeRouteGeometry(points)
}

export const naverRoutingAdapter: RoutingAdapter = {
  provider: 'naver',

  async searchPlaces(query) {
    const url = new URL(
      'https://maps.apigw.ntruss.com/map-geocode/v2/geocode',
    )
    url.searchParams.set('query', query)
    url.searchParams.set('count', '10')
    const body = (await fetchJson(url, { headers: headers() })) as {
      status?: unknown
      addresses?: NaverGeocodeAddress[]
    }
    if (!Array.isArray(body.addresses)) {
      throw new RoutingError(
        'MALFORMED_RESPONSE',
        '네이버 장소 검색 응답이 올바르지 않습니다.',
        true,
      )
    }

    const places = body.addresses.flatMap((item): PlaceResult[] => {
      const latitude = Number(item.y)
      const longitude = Number(item.x)
      const label = [item.roadAddress, item.jibunAddress, item.englishAddress]
        .find((value) => typeof value === 'string' && value.trim())
      if (
        typeof label !== 'string' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        return []
      }
      const normalizedLabel = label.trim()
      return [
        {
          label: normalizedLabel,
          latitude,
          longitude,
          provider: 'naver',
          providerPlaceId: createHash('sha256')
            .update(`${normalizedLabel}|${latitude}|${longitude}`)
            .digest('hex'),
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
      'https://maps.apigw.ntruss.com/map-direction/v1/driving',
    )
    url.searchParams.set(
      'start',
      `${origin.longitude},${origin.latitude}`,
    )
    url.searchParams.set(
      'goal',
      `${destination.longitude},${destination.latitude}`,
    )
    url.searchParams.set('option', 'traoptimal')
    const body = (await fetchJson(url, {
      headers: headers(),
    })) as NaverDirectionsResponse
    const route = body.route?.traoptimal?.[0]
    const summary = route?.summary
    if (body.code !== 0 || !summary) {
      throw new RoutingError('NOT_FOUND', '자동차 경로를 찾지 못했습니다.')
    }

    const distanceMeters = positiveInteger(summary.distance, '경로 거리')
    const durationMilliseconds = positiveInteger(
      summary.duration,
      '경로 시간',
    )
    const durationSeconds = Math.ceil(durationMilliseconds / 1_000)
    const fare = summary.taxiFare
    const estimatedFareWon =
      typeof fare === 'number' &&
      Number.isSafeInteger(fare) &&
      fare > 0 &&
      fare <= 1_000_000
        ? fare
        : null

    return createRouteEvidence({
      provider: 'naver',
      origin,
      destination,
      distanceMeters,
      durationSeconds,
      estimatedFareWon,
      geometry: routePoints(route?.path),
    })
  },
}
