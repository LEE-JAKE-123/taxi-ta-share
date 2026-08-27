import { createHash, randomUUID } from 'node:crypto'
import type {
  Coordinates,
  RouteGeometry,
  RouteEstimateEvidence,
  RoutingProvider,
} from './types'

const MAX_ROUTE_GEOMETRY_POINTS = 1_000

/**
 * Makes optional provider route coordinates safe to render. A missing or
 * malformed shape never invalidates the provider's distance/time estimate.
 */
export function normalizeRouteGeometry(
  points: readonly Coordinates[],
): RouteGeometry | undefined {
  const normalized: Coordinates[] = []

  for (const point of points) {
    if (
      !Number.isFinite(point.latitude) ||
      point.latitude < -90 ||
      point.latitude > 90 ||
      !Number.isFinite(point.longitude) ||
      point.longitude < -180 ||
      point.longitude > 180
    ) {
      continue
    }

    const previous = normalized.at(-1)
    if (
      previous &&
      previous.latitude === point.latitude &&
      previous.longitude === point.longitude
    ) {
      continue
    }
    normalized.push({ latitude: point.latitude, longitude: point.longitude })
  }

  if (normalized.length < 2) return undefined
  if (normalized.length <= MAX_ROUTE_GEOMETRY_POINTS) {
    return { kind: 'LINE_STRING', points: normalized }
  }

  const capped = Array.from(
    { length: MAX_ROUTE_GEOMETRY_POINTS },
    (_, index) => normalized[Math.round(
      index * (normalized.length - 1) / (MAX_ROUTE_GEOMETRY_POINTS - 1),
    )]!,
  )
  return { kind: 'LINE_STRING', points: capped }
}

export function createRouteEvidence(input: {
  provider: RoutingProvider
  origin: Coordinates
  destination: Coordinates
  distanceMeters: number
  durationSeconds: number
  estimatedFareWon: number | null
  geometry?: RouteGeometry
}): RouteEstimateEvidence {
  const calculatedAt = new Date()
  const routeCalculationId = randomUUID()
  const requestTraceId = randomUUID()
  const requestFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        provider: input.provider,
        origin: input.origin,
        destination: input.destination,
      }),
    )
    .digest('hex')

  return {
    provider: input.provider,
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    estimatedFareWon: input.estimatedFareWon,
    calculatedAt: calculatedAt.toISOString(),
    ...(input.geometry ? { geometry: input.geometry } : {}),
    expiresAt: new Date(calculatedAt.getTime() + 15 * 60_000).toISOString(),
    routeCalculationId,
    fareCalculationId:
      input.estimatedFareWon === null ? null : `fare-${routeCalculationId}`,
    requestTraceId,
    requestFingerprint,
    fareSource: 'PROVIDER',
    pricingPolicyKey: `${input.provider}-provider-taxi-fare`,
    pricingPolicyVersion: '1',
    calculationBasis: {
      provider: input.provider,
      routeCalculationId,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      fareField:
        input.estimatedFareWon === null ? null : 'provider_taxi_fare',
    },
  }
}
