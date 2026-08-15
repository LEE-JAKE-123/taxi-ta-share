import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({}))
vi.mock('@/lib/core/trip-validation', () => ({}))
vi.mock('@/lib/core/journey', () => ({}))
vi.mock(
  '@/lib/core/point-validation',
  () => ({ MAX_POINT_AMOUNT: 1_000_000 }),
)
vi.mock('@/lib/routing', () => ({}))
vi.mock('@/lib/routing/place-token', () => ({}))

import {
  allocateOldestDebtRepayment,
  allocateHostApprovalOrder,
  calculatePolicyV2AdjustmentAmounts,
  calculatePolicyV2ProvisionalAmounts,
  CoreError,
  policyV2UsageEligibilityFromCounts,
} from './service'

describe('policy-v2 debt repayment allocation', () => {
  const debts = [
    { debtId: 'oldest', tripId: 'trip-a', outstandingPoints: 100 },
    { debtId: 'newer', tripId: 'trip-b', outstandingPoints: 250 },
  ]

  it('uses a grant on the oldest debts first', () => {
    expect(allocateOldestDebtRepayment(300, debts)).toEqual({
      repayments: [
        { debtId: 'oldest', tripId: 'trip-a', amount: 100 },
        { debtId: 'newer', tripId: 'trip-b', amount: 200 },
      ],
      remainingPoints: 0,
    })
  })

  it('leaves only the excess grant available after all debts are repaid', () => {
    expect(allocateOldestDebtRepayment(500, debts)).toEqual({
      repayments: [
        { debtId: 'oldest', tripId: 'trip-a', amount: 100 },
        { debtId: 'newer', tripId: 'trip-b', amount: 250 },
      ],
      remainingPoints: 150,
    })
  })

  it('rejects a non-positive or malformed repayment input', () => {
    expect(() => allocateOldestDebtRepayment(0, debts)).toThrow(CoreError)
    expect(() => allocateOldestDebtRepayment(1.5, debts)).toThrow(CoreError)
    expect(() => allocateOldestDebtRepayment(100, [
      { debtId: 'bad', tripId: 'trip', outstandingPoints: 0 },
    ])).toThrow(CoreError)
  })
})

describe('policy-v2 allocation', () => {
  it('gives the host and earliest approval the lower shares', () => {
    expect(
      allocateHostApprovalOrder(10_000, [
        { userId: 'member-b', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:01:00.000Z' },
        { userId: 'host', role: 'HOST', approvedAt: null },
        { userId: 'member-a', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:00:00.000Z' },
      ]),
    ).toEqual([
      { userId: 'host', role: 'HOST', approvedAt: null, allocationRank: 1, allocatedShare: 3333 },
      { userId: 'member-a', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:00:00.000Z', allocationRank: 2, allocatedShare: 3333 },
      { userId: 'member-b', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:01:00.000Z', allocationRank: 3, allocatedShare: 3334 },
    ])
  })

  it('uses user ID for equal approval timestamps and preserves the exact total', () => {
    const allocation = allocateHostApprovalOrder(5, [
      { userId: 'host', role: 'HOST', approvedAt: null },
      { userId: 'z-user', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:00:00.000Z' },
      { userId: 'a-user', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:00:00.000Z' },
      { userId: 'm-user', role: 'PARTICIPANT', approvedAt: '2026-08-14T10:00:00.000Z' },
    ])
    expect(allocation.map((participant) => participant.userId)).toEqual([
      'host', 'a-user', 'm-user', 'z-user',
    ])
    expect(allocation.map((participant) => participant.allocatedShare)).toEqual([1, 1, 1, 2])
    expect(allocation.reduce((sum, participant) => sum + participant.allocatedShare, 0)).toBe(5)
  })

  it('rejects a cohort without exactly one host', () => {
    expect(() => allocateHostApprovalOrder(10, [
      { userId: 'one', role: 'PARTICIPANT', approvedAt: null },
      { userId: 'two', role: 'PARTICIPANT', approvedAt: null },
    ])).toThrow(CoreError)
  })
})

describe('policy-v2 usage eligibility', () => {
  it('blocks an uncontested open debt', () => {
    expect(policyV2UsageEligibilityFromCounts({
      openDisputeCount: 0,
      uncontestedDebtCount: 1,
      contestedDebtCount: 0,
    }).reason).toBe('UNCONTESTED_DEBT')
  })

  it('allows a contested debt while fewer than three disputes are open', () => {
    expect(policyV2UsageEligibilityFromCounts({
      openDisputeCount: 2,
      uncontestedDebtCount: 0,
      contestedDebtCount: 1,
    })).toMatchObject({ eligible: true, reason: 'ELIGIBLE' })
  })

  it('blocks at three open disputes even when every debt is contested', () => {
    expect(policyV2UsageEligibilityFromCounts({
      openDisputeCount: 3,
      uncontestedDebtCount: 0,
      contestedDebtCount: 3,
    })).toMatchObject({ eligible: false, reason: 'OPEN_DISPUTE_LIMIT' })
  })
})

describe('policy-v2 provisional amounts', () => {
  it('returns an excess deposit immediately and does not create debt', () => {
    expect(calculatePolicyV2ProvisionalAmounts({
      depositAmount: 5_000,
      allocatedShare: 3_333,
      availablePoints: 100,
    })).toEqual({
      chargedFromDeposit: 3_333,
      refund: 1_667,
      additionalDebit: 0,
      debtIncurred: 0,
    })
  })

  it('uses all available points before incurring only the residual debt', () => {
    expect(calculatePolicyV2ProvisionalAmounts({
      depositAmount: 2_000,
      allocatedShare: 5_000,
      availablePoints: 1_200,
    })).toEqual({
      chargedFromDeposit: 2_000,
      refund: 0,
      additionalDebit: 1_200,
      debtIncurred: 1_800,
    })
  })

  it('rejects negative or non-integral point inputs', () => {
    expect(() => calculatePolicyV2ProvisionalAmounts({
      depositAmount: 1,
      allocatedShare: 1.5,
      availablePoints: 0,
    })).toThrow(CoreError)
  })
})

describe('policy-v2 dispute adjustment amounts', () => {
  it('uses available points then records only an increased-share residual as debt', () => {
    expect(calculatePolicyV2AdjustmentAmounts({
      previousShare: 3_333,
      revisedShare: 4_000,
      availablePoints: 200,
      outstandingDebt: 0,
    })).toEqual({
      availableDebit: 200,
      debtIncrease: 467,
      debtReduction: 0,
      availableRefund: 0,
    })
  })

  it('reduces this trip debt before returning a lower-share difference', () => {
    expect(calculatePolicyV2AdjustmentAmounts({
      previousShare: 4_000,
      revisedShare: 3_333,
      availablePoints: 0,
      outstandingDebt: 500,
    })).toEqual({
      availableDebit: 0,
      debtIncrease: 0,
      debtReduction: 500,
      availableRefund: 167,
    })
  })
})
