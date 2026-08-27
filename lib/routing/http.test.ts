import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoutingError } from './errors'
import { fetchJson } from './http'

afterEach(() => vi.unstubAllGlobals())

describe('map provider HTTP boundary', () => {
  it.each([
    [401, 'NOT_CONFIGURED', false],
    [403, 'NOT_CONFIGURED', false],
    [404, 'NOT_FOUND', false],
    [408, 'TIMEOUT', true],
    [500, 'UPSTREAM_FAILURE', true],
    [400, 'UPSTREAM_FAILURE', false],
  ] as const)('normalizes HTTP %i to %s', async (status, code, retryable) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status })),
    )

    await expect(fetchJson('https://maps.example.test')).rejects.toMatchObject({
      code,
      retryable,
    } satisfies Partial<RoutingError>)
  })

  it('preserves a bounded retry-after value for rate limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{}', { status: 429, headers: { 'retry-after': '7200' } }),
      ),
    )

    await expect(fetchJson('https://maps.example.test')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterSeconds: 3600,
    } satisfies Partial<RoutingError>)
  })
})
