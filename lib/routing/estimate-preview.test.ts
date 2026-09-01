import { describe, expect, it } from 'vitest'
import { isFreshRouteEstimate } from './estimate-preview'

describe('isFreshRouteEstimate', () => {
  const calculatedAt = '2026-09-01T00:00:00.000Z'
  const expiresAt = '2026-09-01T00:15:00.000Z'

  it('accepts only a currently valid server preview', () => {
    expect(isFreshRouteEstimate(
      { calculatedAt, expiresAt },
      Date.parse('2026-09-01T00:10:00.000Z'),
    )).toBe(true)
  })

  it.each([
    ['expired', calculatedAt, expiresAt, Date.parse(expiresAt)],
    ['equal timestamps', calculatedAt, calculatedAt, Date.parse(calculatedAt)],
    ['invalid calculation time', 'not-an-instant', expiresAt, 0],
    ['invalid expiry', calculatedAt, 'not-an-instant', 0],
  ])('rejects %s evidence', (_, resultCalculatedAt, resultExpiresAt, checkedAt) => {
    expect(isFreshRouteEstimate(
      { calculatedAt: resultCalculatedAt, expiresAt: resultExpiresAt },
      checkedAt,
    )).toBe(false)
  })
})
