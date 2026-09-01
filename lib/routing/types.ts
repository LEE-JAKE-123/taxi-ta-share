export type RoutingProvider = 'naver' | 'kakao'

export type Coordinates = {
  latitude: number
  longitude: number
}

/**
 * A display-only route shape in WGS84 coordinate order. This is intentionally
 * kept out of persisted route/fare evidence; providers may omit it without
 * affecting a valid route estimate.
 */
export type RouteGeometry = {
  kind: 'LINE_STRING'
  points: Coordinates[]
}

export type PlaceResult = Coordinates & {
  label: string
  provider: RoutingProvider
  providerPlaceId: string
}

export type SelectablePlaceResult = PlaceResult & {
  selectionToken: string
}

export type RouteEstimate = {
  provider: RoutingProvider
  distanceMeters: number
  durationSeconds: number
  estimatedFareWon: number | null
  calculatedAt: string
  /** The public display estimate must be refreshed after this instant. */
  expiresAt: string
  geometry?: RouteGeometry
}

export type RouteEstimateEvidence = RouteEstimate & {
  routeCalculationId: string
  fareCalculationId: string | null
  requestTraceId: string
  requestFingerprint: string
  expiresAt: string
  fareSource: 'PROVIDER'
  pricingPolicyKey: string
  pricingPolicyVersion: string
  calculationBasis: Readonly<Record<string, unknown>>
}

export interface RoutingAdapter {
  readonly provider: RoutingProvider
  searchPlaces(query: string): Promise<readonly PlaceResult[]>
  estimateRoute(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<RouteEstimateEvidence>
}
