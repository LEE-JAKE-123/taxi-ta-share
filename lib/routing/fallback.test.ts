import { describe, expect, it } from 'vitest'
import { RoutingError } from './errors'
import {
  canFallbackToAnotherProvider,
  preferredFallbackError,
} from './fallback'

describe('auto provider fallback errors', () => {
  it('does not hide an upstream error behind a later missing key', () => {
    const upstream = new RoutingError('UPSTREAM_FAILURE', 'naver failed')
    const missing = new RoutingError('NOT_CONFIGURED', 'kakao missing')
    expect(preferredFallbackError(upstream, missing)).toBe(upstream)
  })

  it('does not hide no-result behind a later missing key', () => {
    const noResult = new RoutingError('NOT_FOUND', 'no route')
    const missing = new RoutingError('NOT_CONFIGURED', 'kakao missing')
    expect(preferredFallbackError(noResult, missing)).toBe(noResult)
  })

  it.each([
    [new RoutingError('NOT_CONFIGURED', 'missing key'), true],
    [new RoutingError('TIMEOUT', 'timed out', true), true],
    [new RoutingError('UPSTREAM_FAILURE', 'unavailable', true), true],
    [new RoutingError('NOT_FOUND', 'not found'), false],
    [new RoutingError('RATE_LIMITED', 'limited', true), false],
    [new RoutingError('MALFORMED_RESPONSE', 'bad response'), false],
  ])('uses another provider only for compatible failures', (error, expected) => {
    expect(canFallbackToAnotherProvider(error)).toBe(expected)
  })
})
