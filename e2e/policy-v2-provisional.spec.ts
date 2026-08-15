import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'

type PolicyV2Fixture = {
  tripId: string
  adminId: string
  adminToken: string
  hostId: string
  memberOneId: string
  memberTwoId: string
  memberOneToken: string
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function seedPolicyV2Settlement(input: {
  actualFare: number
  depositAmount: number
  grantAmounts: [number, number, number]
  allConfirmed?: boolean
  submittedHoursAgo?: number
  existingUsers?: Omit<PolicyV2Fixture, 'tripId'>
}): Promise<PolicyV2Fixture> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-policy-v2-${randomUUID()}`
  const adminId = input.existingUsers?.adminId ?? randomUUID()
  const hostId = input.existingUsers?.hostId ?? randomUUID()
  const memberOneId = input.existingUsers?.memberOneId ?? randomUUID()
  const memberTwoId = input.existingUsers?.memberTwoId ?? randomUUID()
  const adminToken = input.existingUsers?.adminToken ?? randomBytes(32).toString('base64url')
  const memberOneToken = input.existingUsers?.memberOneToken ?? randomBytes(32).toString('base64url')
  const tripId = randomUUID()
  const userIds = [hostId, memberOneId, memberTwoId]
  const finalShare = Math.ceil(input.actualFare / userIds.length)
  const studentIdSeed = Number(String(Date.now()).slice(-8))

  try {
    await client.query('BEGIN')
    if (!input.existingUsers) {
      for (const [index, userId] of userIds.entries()) {
        await client.query(
          `INSERT INTO users (
             user_id, signup_attempt_id, student_id, name, gender, school_email,
             role, account_status
           ) VALUES ($1, $2, $3, $4, 'female', $5, 'USER', 'ACTIVE')`,
          [
            userId,
            randomUUID(),
            `8${String(studentIdSeed + index).padStart(8, '0')}`,
            `${runId}-user-${index}`,
            `${runId}-${index}@jbnu.ac.kr`,
          ],
        )
      }
      await client.query(
        `INSERT INTO users (
           user_id, signup_attempt_id, student_id, name, gender, school_email,
           role, account_status
         ) VALUES ($1, $2, $3, $4, 'female', $5, 'ADMIN', 'ACTIVE')`,
        [
          adminId,
          randomUUID(),
          `7${String(studentIdSeed).padStart(8, '0')}`,
          `${runId}-admin`,
          `${runId}-admin@jbnu.ac.kr`,
        ],
      )
      await client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour'), ($3, $4, now() + interval '1 hour')`,
        [
          memberOneId,
          createHash('sha256').update(memberOneToken).digest('hex'),
          adminId,
          createHash('sha256').update(adminToken).digest('hex'),
        ],
      )
    }
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at,
         max_participants, estimated_fare, status, creation_idempotency_key,
         closed_at, closure_type
       ) VALUES ($1, $2, 'E2E Origin', 'E2E Destination', now() + interval '1 hour',
         3, $3, 'OPEN', $4, NULL, NULL)`,
      [tripId, hostId, input.depositAmount * 3, randomUUID()],
    )
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        `INSERT INTO trip_participants (
           trip_id, user_id, role, status, approval_idempotency_key, approved_at
         ) VALUES ($1, $2, $3, 'APPROVED', $4, now() + ($5::int * interval '1 minute'))`,
        [tripId, userId, index === 0 ? 'HOST' : 'MEMBER', randomUUID(), index],
      )
    }
    await client.query(
      `UPDATE trip_groups
       SET status = 'CLOSED', closed_at = now(), closure_type = 'HOST'
       WHERE trip_id = $1`,
      [tripId],
    )
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'ADMIN_GRANT', $2, 0, NULL, $3, 'E2E policy-v2 grant', $4)`,
        [userId, input.grantAmounts[index], adminId, `${runId}:grant:${userId}`],
      )
      await client.query(
        `INSERT INTO trip_deposits (trip_id, user_id, amount) VALUES ($1, $2, $3)`,
        [tripId, userId, input.depositAmount],
      )
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, 'E2E policy-v2 deposit', $6)`,
        [userId, -input.depositAmount, input.depositAmount, tripId, hostId, `${runId}:deposit:${userId}`],
      )
      await client.query(
        `UPDATE trip_participants SET status = 'DEPOSITED'
         WHERE trip_id = $1 AND user_id = $2`,
        [tripId, userId],
      )
    }
    const location = await client.query(
      `SELECT location_revision FROM trip_groups WHERE trip_id = $1`,
      [tripId],
    )
    const fareEstimateId = randomUUID()
    await client.query(
      `INSERT INTO fare_estimates (
         fare_estimate_id, trip_id, trip_location_revision, route_calculation_id,
         fare_calculation_id, provider_key, route_distance_m, duration_seconds,
         estimated_fare_won, deposit_points_total, fare_source, pricing_policy_key,
         pricing_policy_version, calculated_at, expires_at, request_trace_id,
         request_fingerprint, calculation_basis, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, 'E2E', 10000, 1200, $6, $6,
         'E2E fixture', 'E2E', '1', now(), now() + interval '1 day', $7, $8,
         '{"fixture":true}'::jsonb, $9)`,
      [
        fareEstimateId,
        tripId,
        location.rows[0].location_revision,
        `${runId}:route`,
        `${runId}:fare`,
        input.depositAmount * 3,
        `${runId}:trace`,
        `${runId}:fingerprint`,
        randomUUID(),
      ],
    )
    await client.query(
      `UPDATE trip_groups SET current_fare_estimate_id = $2, status = 'CONFIRMED'
       WHERE trip_id = $1`,
      [tripId, fareEstimateId],
    )
    await client.query(
      `UPDATE trip_groups
       SET status = 'IN_PROGRESS', in_progress_at = now(), start_idempotency_key = $2
       WHERE trip_id = $1`,
      [tripId, randomUUID()],
    )
    await client.query(
      `INSERT INTO trip_settlements (
         trip_id, actual_fare, participant_count, final_share, submitted_by,
         fare_submission_idempotency_key, submitted_at, confirmation_deadline,
         agreement_deadline, dispute_deadline, cohort_basis, allocation_policy
       ) VALUES (
         $1, $2, 3, $3, $4, $5, now() + ($6::int * interval '1 hour'),
         now() + ($6::int * interval '1 hour') + interval '10 minutes',
         now() + ($6::int * interval '1 hour') + interval '10 minutes',
         now() + ($6::int * interval '1 hour') + interval '24 hours',
         'ESCROW_CONFIRMED', 'HOST_APPROVAL_ORDER'
       )`,
      [tripId, input.actualFare, finalShare, hostId, randomUUID(), input.submittedHoursAgo ?? 0],
    )
    const allocatedShares = [
      Math.floor(input.actualFare / 3),
      Math.floor(input.actualFare / 3),
      Math.ceil(input.actualFare / 3),
    ]
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        `INSERT INTO trip_settlement_participants (
           trip_id, user_id, deposit_amount, final_share, allocation_rank, allocated_share
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [tripId, userId, input.depositAmount, finalShare, index + 1, allocatedShares[index]],
      )
    }
    await client.query(
      `UPDATE trip_groups SET status = 'SETTLEMENT_PENDING' WHERE trip_id = $1`,
      [tripId],
    )
    if (input.allConfirmed !== false) {
      for (const userId of userIds) {
        await client.query(
          `INSERT INTO fare_confirmations (trip_id, user_id, idempotency_key)
           VALUES ($1, $2, $3)`,
          [tripId, userId, randomUUID()],
        )
      }
    }
    await client.query('COMMIT')
    return {
      tripId,
      adminId,
      adminToken,
      hostId,
      memberOneId,
      memberTwoId,
      memberOneToken,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

async function rows<T>(query: string, values: unknown[]) {
  const pool = database()
  const client = await pool.connect()
  try {
    return (await client.query(query, values)).rows as T[]
  } finally {
    client.release()
    await pool.end()
  }
}

async function runDueTransitions(request: APIRequestContext) {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is required for E2E scheduler tests.')
  const response = await request.get('/api/internal/due-transitions', {
    headers: { authorization: `Bearer ${secret}` },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<{ settled: number; skipped: number }>
}

async function resolveWithLowerFareAdjustment(input: {
  fixture: PolicyV2Fixture
  revisedFare: number
}) {
  const pool = database()
  const client = await pool.connect()
  const disputeId = randomUUID()
  const commandId = randomUUID()
  const idempotencyKey = randomUUID()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO fare_disputes (
         dispute_id, trip_id, user_id, reason, idempotency_key, fare_revision
       ) VALUES ($1, $2, $3, 'E2E policy-v2 adjustment dispute', $4, 1)`,
      [disputeId, input.fixture.tripId, input.fixture.memberOneId, randomUUID()],
    )
    await client.query(
      `UPDATE fare_disputes
       SET status = 'RESOLVED', resolved_at = now(),
           resolution_note = 'E2E adjustment accepted',
           resolved_by_user_id = $2, resolution_idempotency_key = $3
       WHERE dispute_id = $1`,
      [disputeId, input.fixture.adminId, idempotencyKey],
    )
    await client.query(
      `INSERT INTO policy_v2_adjustment_commands (
         command_id, trip_id, dispute_id, fare_revision, previous_actual_fare,
         revised_actual_fare, admin_user_id, reason, idempotency_key
       ) VALUES ($1, $2, $3, 1, 10000, $4, $5, 'E2E adjustment accepted', $6)`,
      [
        commandId,
        input.fixture.tripId,
        disputeId,
        input.revisedFare,
        input.fixture.adminId,
        idempotencyKey,
      ],
    )
    const allocations = await client.query(
      `SELECT user_id, allocated_share, allocation_rank
       FROM trip_settlement_participants
       WHERE trip_id = $1
       ORDER BY allocation_rank`,
      [input.fixture.tripId],
    )
    const participantCount = allocations.rowCount ?? 0
    if (participantCount < 2) throw new Error('Policy-v2 allocation fixture is incomplete.')
    const baseShare = Math.floor(input.revisedFare / participantCount)
    const higherShareStartsAt = participantCount - (input.revisedFare % participantCount)
    for (const row of allocations.rows) {
      const revisedShare = baseShare +
        (Number(row.allocation_rank) > higherShareStartsAt ? 1 : 0)
      await client.query(
        `INSERT INTO policy_v2_adjustment_allocations (
           command_id, user_id, previous_share, revised_share
         ) VALUES ($1, $2, $3, $4)`,
        [commandId, row.user_id, row.allocated_share, revisedShare],
      )
      const refund = Number(row.allocated_share) - revisedShare
      if (refund > 0) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, policy_v2_adjustment_command_id, reason, idempotency_key
           ) VALUES ($1, 'FARE_ADJUSTMENT_REFUND', $2, 0, $3, $4, $5,
             'E2E policy-v2 adjustment refund', $6)`,
          [
            row.user_id,
            refund,
            input.fixture.tripId,
            input.fixture.adminId,
            commandId,
            `e2e-adjustment:${commandId}:refund:${row.user_id}`,
          ],
        )
      }
    }
    await client.query('COMMIT')
    return { disputeId, commandId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

test('policy-v2 all consent immediately creates host-first 10,000/3 provisional allocation', async ({ request }) => {
  const fixture = await seedPolicyV2Settlement({
    actualFare: 10_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
  })

  const result = await runDueTransitions(request)
  expect(result.settled).toBeGreaterThanOrEqual(1)
  const [settlement] = await rows<{
    status: string
    settlement_mode: string
    provisional_deadline_command_id: string
  }>(
    `SELECT status, settlement_mode, provisional_deadline_command_id
     FROM trip_settlements WHERE trip_id = $1`,
    [fixture.tripId],
  )
  expect(settlement).toMatchObject({
    status: 'PROVISIONALLY_SETTLED',
    settlement_mode: 'SYSTEM_PROVISIONAL',
  })
  expect(settlement.provisional_deadline_command_id).toBeTruthy()
  expect(await rows(
    `SELECT status FROM trip_groups WHERE trip_id = $1 AND status <> 'SETTLEMENT_PENDING'`,
    [fixture.tripId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT user_id, allocation_rank, allocated_share
     FROM trip_settlement_participants
     WHERE trip_id = $1 ORDER BY allocation_rank`,
    [fixture.tripId],
  )).toEqual([
    { user_id: fixture.hostId, allocation_rank: 1, allocated_share: 3333 },
    { user_id: fixture.memberOneId, allocation_rank: 2, allocated_share: 3333 },
    { user_id: fixture.memberTwoId, allocation_rank: 3, allocated_share: 3334 },
  ])
  expect(await rows(
    `SELECT user_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type = 'SETTLEMENT_CHARGE'
       AND (available_delta <> 0 OR held_delta NOT IN (-3333, -3334))`,
    [fixture.tripId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT user_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type = 'REFUND'
       AND (
         (user_id = $2 AND available_delta <> 1667)
         OR (user_id = $3 AND available_delta <> 1667)
         OR (user_id = $4 AND available_delta <> 1666)
       )`,
    [fixture.tripId, fixture.hostId, fixture.memberOneId, fixture.memberTwoId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT command_id FROM system_deadline_commands
     WHERE command_id = $1 AND command_type = 'PROVISIONAL_SETTLE'
       AND execution_key = $2`,
    [settlement.provisional_deadline_command_id, `provisional:${fixture.tripId}:revision:1`],
  )).toHaveLength(1)
})

test('policy-v2 only records the residual shortfall as debt after available-point debit', async ({ request }) => {
  const fixture = await seedPolicyV2Settlement({
    actualFare: 18_000,
    depositAmount: 5_000,
    grantAmounts: [6_000, 5_500, 7_000],
  })
  await runDueTransitions(request)

  expect(await rows(
    `SELECT user_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type = 'ADDITIONAL_DEBIT'
       AND ((user_id = $2 AND available_delta <> -1000)
         OR (user_id = $3 AND available_delta <> -500)
         OR (user_id = $4 AND available_delta <> -1000))`,
    [fixture.tripId, fixture.hostId, fixture.memberOneId, fixture.memberTwoId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT e.user_id, e.debt_delta FROM point_debt_events e
     JOIN point_debt_obligations o ON o.debt_id = e.debt_id
     WHERE o.trip_id = $1`,
    [fixture.tripId],
  )).toEqual([{ user_id: fixture.memberOneId, debt_delta: 500 }])
  expect(await rows(
    `SELECT user_id FROM point_accounts
     WHERE (user_id = $1 AND (available_points <> 0 OR held_points <> 0 OR debt_points <> 0))
        OR (user_id = $2 AND (available_points <> 0 OR held_points <> 0 OR debt_points <> 500))
        OR (user_id = $3 AND (available_points <> 1000 OR held_points <> 0 OR debt_points <> 0))`,
    [fixture.hostId, fixture.memberOneId, fixture.memberTwoId],
  )).toHaveLength(0)
})

test('policy-v2 admin grant repays the oldest open debt before a newer debt', async ({ request, browser }) => {
  test.setTimeout(120_000)
  const oldest = await seedPolicyV2Settlement({
    actualFare: 18_000,
    depositAmount: 5_000,
    grantAmounts: [6_000, 5_500, 7_000],
  })
  await runDueTransitions(request)
  const newer = await seedPolicyV2Settlement({
    actualFare: 18_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
    existingUsers: oldest,
  })
  await runDueTransitions(request)

  const [oldestDebt] = await rows<{
    debt_id: string
    created_at: string
  }>(
    `SELECT debt_id, created_at
     FROM point_debt_obligations
     WHERE trip_id = $1 AND user_id = $2`,
    [oldest.tripId, oldest.memberOneId],
  )
  const [newerDebt] = await rows<{
    debt_id: string
    created_at: string
  }>(
    `SELECT debt_id, created_at
     FROM point_debt_obligations
     WHERE trip_id = $1 AND user_id = $2`,
    [newer.tripId, newer.memberOneId],
  )
  expect(oldestDebt).toBeTruthy()
  expect(newerDebt).toBeTruthy()
  expect(new Date(oldestDebt.created_at).getTime()).toBeLessThanOrEqual(
    new Date(newerDebt.created_at).getTime(),
  )

  const context = await browser.newContext()
  const page = await context.newPage()
  const grantIdempotencyKey = randomUUID()
  try {
    await context.addCookies([{
      name: 'taxitashare_session',
      value: oldest.adminToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }])
    await page.goto('/admin/points')
    const grantForm = page.locator('form').filter({
      has: page.locator('#targetUserId'),
    })
    await expect(grantForm).toBeVisible()
    await grantForm.locator('#targetUserId').selectOption(oldest.memberOneId)
    await grantForm.locator('#amount').fill('750')
    await grantForm.locator('#reason').fill('E2E oldest policy-v2 debt repayment')
    await grantForm.locator('input[name="idempotencyKey"]').evaluate((element, value) => {
      ;(element as HTMLInputElement).value = value
    }, grantIdempotencyKey)
    await Promise.all([
      page.waitForURL(/\/admin(?:\?|$)/),
      grantForm.locator('button[type="submit"]').click(),
    ])

    await page.goto('/admin/points')
    const replayForm = page.locator('form').filter({
      has: page.locator('#targetUserId'),
    })
    await replayForm.locator('#targetUserId').selectOption(oldest.memberOneId)
    await replayForm.locator('#amount').fill('750')
    await replayForm.locator('#reason').fill('E2E oldest policy-v2 debt repayment')
    await replayForm.locator('input[name="idempotencyKey"]').evaluate((element, value) => {
      ;(element as HTMLInputElement).value = value
    }, grantIdempotencyKey)
    await Promise.all([
      page.waitForURL(/\/admin(?:\?|$)/),
      replayForm.locator('button[type="submit"]').click(),
    ])

    expect(await rows(
      `SELECT debt_id
       FROM point_debt_obligations
       WHERE debt_id = $1 AND status = 'SETTLED' AND outstanding_points = 0`,
      [oldestDebt.debt_id],
    )).toHaveLength(1)
    expect(await rows(
      `SELECT debt_id
       FROM point_debt_obligations
       WHERE debt_id = $1 AND status = 'OPEN' AND outstanding_points = 250`,
      [newerDebt.debt_id],
    )).toHaveLength(1)
    expect(await rows(
      `SELECT debt_id, debt_delta
       FROM point_debt_events
       WHERE debt_id = ANY($1::uuid[]) AND event_type = 'REPAYMENT'
       ORDER BY created_at, debt_event_id`,
      [[oldestDebt.debt_id, newerDebt.debt_id]],
    )).toEqual([
      { debt_id: oldestDebt.debt_id, debt_delta: -500 },
      { debt_id: newerDebt.debt_id, debt_delta: -250 },
    ])
    expect(await rows(
      `SELECT l.entry_type, l.available_delta, e.debt_id
       FROM point_debt_events e
       JOIN point_ledger l ON l.ledger_id = e.repayment_ledger_id
       WHERE e.debt_id = ANY($1::uuid[])
         AND e.event_type = 'REPAYMENT'
       ORDER BY e.created_at, e.debt_event_id`,
      [[oldestDebt.debt_id, newerDebt.debt_id]],
    )).toEqual([
      { entry_type: 'DEBT_REPAYMENT', available_delta: -500, debt_id: oldestDebt.debt_id },
      { entry_type: 'DEBT_REPAYMENT', available_delta: -250, debt_id: newerDebt.debt_id },
    ])
    expect(await rows(
      `SELECT ledger_id
       FROM point_ledger
       WHERE user_id = $1
         AND entry_type = 'ADMIN_GRANT'
         AND available_delta = 750
         AND reason = 'E2E oldest policy-v2 debt repayment'`,
      [oldest.memberOneId],
    )).toHaveLength(1)
    expect(await rows(
      `SELECT available_points, debt_points
       FROM point_accounts
       WHERE user_id = $1`,
      [oldest.memberOneId],
    )).toEqual([{ available_points: 0, debt_points: 250 }])
  } finally {
    await context.close()
  }
})

test('policy-v2 fulfills a user point request and repays debts in oldest-first order', async ({ request, browser }) => {
  test.setTimeout(60_000)
  const oldest = await seedPolicyV2Settlement({
    actualFare: 18_000,
    depositAmount: 5_000,
    grantAmounts: [6_000, 5_500, 7_000],
  })
  await runDueTransitions(request)
  const newer = await seedPolicyV2Settlement({
    actualFare: 18_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
    existingUsers: oldest,
  })
  await runDueTransitions(request)

  const [oldestDebt] = await rows<{ debt_id: string }>(
    `SELECT debt_id
     FROM point_debt_obligations
     WHERE trip_id = $1 AND user_id = $2`,
    [oldest.tripId, oldest.memberOneId],
  )
  const [newerDebt] = await rows<{ debt_id: string }>(
    `SELECT debt_id
     FROM point_debt_obligations
     WHERE trip_id = $1 AND user_id = $2`,
    [newer.tripId, newer.memberOneId],
  )
  expect(oldestDebt).toBeTruthy()
  expect(newerDebt).toBeTruthy()

  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  const requestIdempotencyKey = randomUUID()
  const requestAmount = 750
  const requestReason = 'E2E point request oldest debt repayment'
  let pointRequestId: string | undefined
  try {
    await memberContext.addCookies([{
      name: 'taxitashare_session',
      value: oldest.memberOneToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }])
    await memberPage.goto('/points')
    const requestForm = memberPage.locator('form').filter({
      has: memberPage.locator('input[name="idempotencyKey"]'),
    })
    await expect(requestForm).toBeVisible()
    await requestForm.locator('input[name="amount"]').fill(String(requestAmount))
    await requestForm.locator('input[name="reason"]').fill(requestReason)
    await requestForm.locator('input[name="idempotencyKey"]').evaluate((element, value) => {
      ;(element as HTMLInputElement).value = value
    }, requestIdempotencyKey)
    await Promise.all([
      memberPage.waitForURL(/\/points(?:\?|$)/),
      requestForm.locator('button[type="submit"]').click(),
    ])

    const [pointRequest] = await rows<{
      request_id: string
      status: string
      requested_amount: number
      reason: string
    }>(
      `SELECT request_id, status, requested_amount, reason
       FROM point_grant_requests
       WHERE requester_user_id = $1 AND idempotency_key = $2`,
      [oldest.memberOneId, requestIdempotencyKey],
    )
    expect(pointRequest).toEqual({
      request_id: expect.any(String),
      status: 'PENDING',
      requested_amount: requestAmount,
      reason: requestReason,
    })
    pointRequestId = pointRequest.request_id
  } finally {
    await memberContext.close()
  }

  expect(pointRequestId).toBeTruthy()
  const replayMemberContext = await browser.newContext()
  const replayMemberPage = await replayMemberContext.newPage()
  try {
    await replayMemberContext.addCookies([{
      name: 'taxitashare_session',
      value: oldest.memberOneToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }])
    await replayMemberPage.goto('/points')
    const replayRequestForm = replayMemberPage.locator('form').filter({
      has: replayMemberPage.locator('input[name="idempotencyKey"]'),
    })
    await replayRequestForm.locator('input[name="amount"]').fill(String(requestAmount))
    await replayRequestForm.locator('input[name="reason"]').fill(requestReason)
    await replayRequestForm.locator('input[name="idempotencyKey"]').evaluate((element, value) => {
      ;(element as HTMLInputElement).value = value
    }, requestIdempotencyKey)
    await Promise.all([
      replayMemberPage.waitForURL(/\/points(?:\?|$)/),
      replayRequestForm.locator('button[type="submit"]').click(),
    ])
  } finally {
    await replayMemberContext.close()
  }
  expect(await rows(
    `SELECT request_id
     FROM point_grant_requests
     WHERE requester_user_id = $1 AND idempotency_key = $2`,
    [oldest.memberOneId, requestIdempotencyKey],
  )).toEqual([{ request_id: pointRequestId }])

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  try {
    await adminContext.addCookies([{
      name: 'taxitashare_session',
      value: oldest.adminToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }])
    await adminPage.goto('/admin/points')
    const fulfillForm = adminPage.locator('form').filter({
      has: adminPage.locator(`input[name="requestId"][value="${pointRequestId}"]`),
    })
    await expect(fulfillForm).toBeVisible()
    await Promise.all([
      adminPage.waitForURL(/\/admin(?:\?|$)/),
      fulfillForm.locator('button[type="submit"]').click(),
    ])
  } finally {
    await adminContext.close()
  }

  expect(await rows(
    `SELECT request_id
     FROM point_grant_requests
     WHERE request_id = $1
       AND status = 'FULFILLED'
       AND fulfilled_by = $2
       AND fulfilled_ledger_id IS NOT NULL`,
    [pointRequestId, oldest.adminId],
  )).toHaveLength(1)
  const parentGrants = await rows<{
    ledger_id: string
    user_id: string
    available_delta: number
    point_request_id: string
  }>(
    `SELECT ledger_id, user_id, available_delta, point_request_id
     FROM point_ledger
     WHERE point_request_id = $1 AND entry_type = 'ADMIN_GRANT'`,
    [pointRequestId],
  )
  expect(parentGrants).toHaveLength(1)
  const [parentGrant] = parentGrants
  expect(parentGrant).toEqual({
    ledger_id: expect.any(String),
    user_id: oldest.memberOneId,
    available_delta: requestAmount,
    point_request_id: pointRequestId,
  })
  expect(await rows(
    `SELECT fulfilled_ledger_id
     FROM point_grant_requests
     WHERE request_id = $1 AND fulfilled_ledger_id = $2`,
    [pointRequestId, parentGrant.ledger_id],
  )).toHaveLength(1)
  expect(await rows(
    `SELECT e.debt_id, e.debt_delta, e.repayment_ledger_id,
            l.entry_type, l.available_delta, l.idempotency_key
     FROM point_debt_events e
     JOIN point_ledger l ON l.ledger_id = e.repayment_ledger_id
     WHERE e.debt_id = ANY($1::uuid[]) AND e.event_type = 'REPAYMENT'
     ORDER BY e.created_at, e.debt_event_id`,
    [[oldestDebt.debt_id, newerDebt.debt_id]],
  )).toEqual([
    {
      debt_id: oldestDebt.debt_id,
      debt_delta: -500,
      repayment_ledger_id: expect.any(String),
      entry_type: 'DEBT_REPAYMENT',
      available_delta: -500,
      idempotency_key: `point-request:${pointRequestId}:debt-ledger:${oldestDebt.debt_id}`,
    },
    {
      debt_id: newerDebt.debt_id,
      debt_delta: -250,
      repayment_ledger_id: expect.any(String),
      entry_type: 'DEBT_REPAYMENT',
      available_delta: -250,
      idempotency_key: `point-request:${pointRequestId}:debt-ledger:${newerDebt.debt_id}`,
    },
  ])
  expect(await rows(
    `SELECT debt_id
     FROM point_debt_obligations
     WHERE debt_id = $1 AND status = 'SETTLED' AND outstanding_points = 0
        OR debt_id = $2 AND status = 'OPEN' AND outstanding_points = 250
     ORDER BY debt_id`,
    [oldestDebt.debt_id, newerDebt.debt_id],
  )).toEqual([{ debt_id: [oldestDebt.debt_id, newerDebt.debt_id].sort()[0] }, {
    debt_id: [oldestDebt.debt_id, newerDebt.debt_id].sort()[1],
  }])
  expect(await rows(
    `SELECT available_points, held_points, debt_points
     FROM point_accounts
    WHERE user_id = $1`,
    [oldest.memberOneId],
  )).toEqual([{ available_points: 0, held_points: 0, debt_points: 250 }])
})

test('policy-v2 accepts a 24-hour dispute after the 10-minute consent path provisionally settles', async ({ request }) => {
  const fixture = await seedPolicyV2Settlement({
    actualFare: 10_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
  })
  await runDueTransitions(request)

  await rows(
    `INSERT INTO fare_disputes (
       dispute_id, trip_id, user_id, reason, idempotency_key, fare_revision
     ) VALUES ($1, $2, $3, 'E2E policy-v2 post-provisional dispute', $4, 1)`,
    [randomUUID(), fixture.tripId, fixture.memberOneId, randomUUID()],
  )
  expect(await rows(
    `SELECT status FROM fare_disputes
     WHERE trip_id = $1 AND user_id = $2 AND status = 'OPEN'`,
    [fixture.tripId, fixture.memberOneId],
  )).toHaveLength(1)
  expect(await rows(
    `SELECT status FROM trip_settlements WHERE trip_id = $1`,
    [fixture.tripId],
  )).toEqual([{ status: 'PROVISIONALLY_SETTLED' }])
})

test('policy-v2 keeps the participant dispute form available after provisional settlement', async ({ request, browser }) => {
  test.setTimeout(120_000)
  const fixture = await seedPolicyV2Settlement({
    actualFare: 10_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
  })
  await runDueTransitions(request)

  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await context.addCookies([{
      name: 'taxitashare_session',
      value: fixture.memberOneToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }])
    await page.goto(`/room/${fixture.tripId}/settle`)

    const disputeForm = page.locator('form').filter({
      has: page.locator('textarea[name="reason"]'),
    })
    await expect(disputeForm).toBeVisible()
    await expect(page.locator('[aria-live="polite"]')).toContainText(/이의제기/)

    await disputeForm.locator('textarea[name="reason"]').fill(
      'E2E provisional settlement dispute',
    )
    await disputeForm.getByRole('button').click()
    await expect(disputeForm).toHaveCount(0, { timeout: 30_000 })
    expect(await rows(
      `SELECT dispute_id FROM fare_disputes
       WHERE trip_id = $1 AND user_id = $2 AND status = 'OPEN'`,
      [fixture.tripId, fixture.memberOneId],
    )).toHaveLength(1)
  } finally {
    await context.close()
  }
})

test('policy-v2 applies an append-only lower-fare adjustment within the 24-hour dispute window', async ({ request }) => {
  const fixture = await seedPolicyV2Settlement({
    actualFare: 10_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
    submittedHoursAgo: -23,
    allConfirmed: false,
  })
  await runDueTransitions(request)
  const adjustment = await resolveWithLowerFareAdjustment({ fixture, revisedFare: 9_000 })

  expect(await rows(
    `SELECT user_id, available_delta
     FROM point_ledger
     WHERE policy_v2_adjustment_command_id = $1
       AND entry_type = 'FARE_ADJUSTMENT_REFUND'
     ORDER BY available_delta, user_id`,
    [adjustment.commandId],
  )).toHaveLength(3)
  expect(await rows(
    `SELECT status FROM trip_settlements WHERE trip_id = $1`,
    [fixture.tripId],
  )).toEqual([{ status: 'PROVISIONALLY_SETTLED' }])
})

test('policy-v2 finalizes once after the 24-hour dispute window has no open dispute', async ({ request }) => {
  const fixture = await seedPolicyV2Settlement({
    actualFare: 10_000,
    depositAmount: 5_000,
    grantAmounts: [5_000, 5_000, 5_000],
    submittedHoursAgo: -25,
    allConfirmed: false,
  })
  await runDueTransitions(request)
  await runDueTransitions(request)
  expect(await rows(
    `SELECT g.status AS trip_status, s.status AS settlement_status
     FROM trip_groups g JOIN trip_settlements s ON s.trip_id = g.trip_id
     WHERE g.trip_id = $1`,
    [fixture.tripId],
  )).toEqual([{ trip_status: 'COMPLETED', settlement_status: 'COMPLETED' }])
})
