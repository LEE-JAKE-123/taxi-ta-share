import type { RouteEstimate } from './types'

/**
 * Client-side previews are display-only and must never outlive the server
 * evidence that produced them. Server-side room creation always re-estimates.
 */
export function isFreshRouteEstimate(
  estimate: Pick<RouteEstimate, 'calculatedAt' | 'expiresAt'>,
  checkedAt: number,
) {
  const calculatedAt = Date.parse(estimate.calculatedAt)
  const expiresAt = Date.parse(estimate.expiresAt)

  return Number.isFinite(calculatedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt > calculatedAt &&
    expiresAt > checkedAt
}
