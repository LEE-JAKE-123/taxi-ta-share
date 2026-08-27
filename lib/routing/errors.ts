export type RoutingErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_FAILURE'
  | 'MALFORMED_RESPONSE'

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'RoutingError'
  }
}
