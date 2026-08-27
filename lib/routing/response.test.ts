import { describe, expect, it } from 'vitest'
import { RoutingError } from './errors'
import {
  routingErrorMessage,
  routingErrorStatus,
  routingRetryAfter,
} from './response'

describe('routing error response normalization', () => {
  it.each([
    ['INVALID_INPUT', 400],
    ['NOT_FOUND', 404],
    ['NOT_CONFIGURED', 503],
    ['RATE_LIMITED', 429],
    ['TIMEOUT', 502],
    ['UPSTREAM_FAILURE', 502],
    ['MALFORMED_RESPONSE', 502],
  ] as const)('maps %s to %i', (code, status) => {
    const error = new RoutingError(code, 'upstream detail')
    expect(routingErrorStatus(error)).toBe(status)
  })

  it('does not expose an upstream error message', () => {
    const error = new RoutingError(
      'UPSTREAM_FAILURE',
      'secret upstream payload',
    )
    expect(routingErrorMessage(error)).not.toContain('secret')
  })

  it('exposes retry-after only for a rate-limited provider', () => {
    expect(
      routingRetryAfter(new RoutingError('RATE_LIMITED', 'limited', true, 12)),
    ).toBe(12)
    expect(
      routingRetryAfter(new RoutingError('UPSTREAM_FAILURE', 'failed', true)),
    ).toBeUndefined()
  })
})
