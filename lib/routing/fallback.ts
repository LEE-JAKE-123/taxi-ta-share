import { RoutingError } from './errors'

export function canFallbackToAnotherProvider(error: unknown) {
  if (!(error instanceof RoutingError)) return false
  return (
    error.code === 'NOT_CONFIGURED' ||
    (error.retryable &&
      (error.code === 'TIMEOUT' || error.code === 'UPSTREAM_FAILURE'))
  )
}

export function preferredFallbackError(
  current: unknown,
  candidate: unknown,
) {
  if (!current) return candidate
  if (
    current instanceof RoutingError &&
    current.code === 'NOT_CONFIGURED' &&
    (!(candidate instanceof RoutingError) ||
      candidate.code !== 'NOT_CONFIGURED')
  ) {
    return candidate
  }
  if (
    candidate instanceof RoutingError &&
    candidate.code === 'NOT_CONFIGURED'
  ) {
    return current
  }
  return candidate
}
