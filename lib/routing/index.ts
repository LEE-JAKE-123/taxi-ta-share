import 'server-only'

import { RoutingError } from './errors'
import { kakaoRoutingAdapter } from './kakao'
import { naverRoutingAdapter } from './naver'
import {
  canFallbackToAnotherProvider,
  preferredFallbackError,
} from './fallback'
import { getProviderSetting, type ProviderSetting } from './provider-setting'
import type {
  Coordinates,
  PlaceResult,
  RouteEstimateEvidence,
  RoutingAdapter,
} from './types'

export { getProviderSetting } from './provider-setting'

function adapters(): readonly RoutingAdapter[] {
  const setting = getProviderSetting()
  if (setting === 'naver') return [naverRoutingAdapter]
  if (setting === 'kakao') return [kakaoRoutingAdapter]
  return [naverRoutingAdapter, kakaoRoutingAdapter]
}

async function withFallback<T>(
  run: (adapter: RoutingAdapter) => Promise<T>,
): Promise<T> {
  let lastError: unknown
  for (const adapter of adapters()) {
    try {
      return await run(adapter)
    } catch (error) {
      lastError = preferredFallbackError(lastError, error)
      if (!canFallbackToAnotherProvider(error)) {
        throw error
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new RoutingError(
        'UPSTREAM_FAILURE',
        '지도 공급자 요청을 처리하지 못했습니다.',
        true,
      )
}

export function searchPlaces(
  query: string,
): Promise<readonly PlaceResult[]> {
  return withFallback((adapter) => adapter.searchPlaces(query))
}

export function estimateRoute(
  origin: Coordinates,
  destination: Coordinates,
): Promise<RouteEstimateEvidence> {
  return withFallback((adapter) =>
    adapter.estimateRoute(origin, destination),
  )
}

export type {
  Coordinates,
  PlaceResult,
  SelectablePlaceResult,
  RouteEstimate,
  RouteEstimateEvidence,
  RoutingProvider,
} from './types'
export { RoutingError } from './errors'
