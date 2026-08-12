import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'

type DueSettlementFixture = {
  tripId: string
  userIds: string[]
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function seedDueSettlement(input: {
  depositAmount: number
  finalShare: number
  grantAmounts: number[]
}): Promise<DueSettlementFixture> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-deadline-${randomUUID()}`
  const adminId = randomUUID()
  const hostId = randomUUID()
  const memberOneId = randomUUID()
  const memberTwoId = randomUUID()
  const tripId = randomUUID()
  const userIds = [hostId, memberOneId, memberTwoId]

  try {
    await client.query('BEGIN')
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        `INSERT INTO users (
           user_id, signup_attempt_id, student_id, name, gender, school_email,
           role, account_status
         ) VALUES ($1, $2, $3, $4, 'female', $5, 'USER', 'ACTIVE')`,
        [
          userId,
          randomUUID(),
          `7${Date.now().toString().slice(-7)}${index}`,
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
      [adminId, randomUUID(), `60${Date.now().toString().slice(-7)}`, `${runId}-admin`, `${runId}-admin@jbnu.ac.kr`],
    )
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at,
         max_participants, estimated_fare, status, creation_idempotency_key,
         closed_at, closure_type
       ) VALUES ($1, $2, 'E2E Origin', 'E2E Destination', now() + interval '1 hour',
         3, $3, 'OPEN', $4, NULL, NULL)`,
      [tripId, hostId, input.finalShare * userIds.length, randomUUID()],
    )
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        `INSERT INTO trip_participants (
           trip_id, user_id, role, status, approval_idempotency_key
         ) VALUES ($1, $2, $3, 'APPROVED', $4)`,
        [tripId, userId, index === 0 ? 'HOST' : 'MEMBER', randomUUID()],
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
         ) VALUES ($1, 'ADMIN_GRANT', $2, 0, NULL, $3, 'E2E deadline grant', $4)`,
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
         ) VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, 'E2E deadline deposit', $6)`,
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
        input.finalShare * userIds.length,
        `${runId}:trace`,
        `${runId}:fingerprint`,
        randomUUID(),
      ],
    )
    await client.query(
      `UPDATE trip_groups
       SET current_fare_estimate_id = $2, status = 'CONFIRMED'
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
      `UPDATE trip_participants
       SET status = 'NO_SHOW', no_show_at = now(), no_show_marked_by = $3,
           no_show_idempotency_key = $4
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, memberTwoId, hostId, randomUUID()],
    )
    await client.query(
      `INSERT INTO trip_settlements (
         trip_id, actual_fare, participant_count, final_share, submitted_by,
         fare_submission_idempotency_key, submitted_at, confirmation_deadline,
         cohort_basis
       ) VALUES ($1, $2, 3, $3, $4, $5, now() - interval '2 minutes',
         now() - interval '1 minute', 'ESCROW_CONFIRMED')`,
      [tripId, input.finalShare * userIds.length, input.finalShare, hostId, randomUUID()],
    )
    for (const userId of userIds) {
      await client.query(
        `INSERT INTO trip_settlement_participants (
           trip_id, user_id, deposit_amount, final_share
         ) VALUES ($1, $2, $3, $4)`,
        [tripId, userId, input.depositAmount, input.finalShare],
      )
    }
    await client.query(
      `UPDATE trip_groups
       SET status = 'SETTLEMENT_PENDING', departure_at = now() - interval '1 hour'
       WHERE trip_id = $1`,
      [tripId],
    )
    await client.query('COMMIT')
    return { tripId, userIds }
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

test('기한 만료 정산은 환불을 한 번만 원장에 기록하고 완료한다', async ({ request }) => {
  const fixture = await seedDueSettlement({
    depositAmount: 6000,
    finalShare: 5000,
    grantAmounts: [6000, 6000, 6000],
  })

  const [first, second] = await Promise.all([runDueTransitions(request), runDueTransitions(request)])
  expect(first.settled + second.settled).toBeGreaterThanOrEqual(1)

  const [settlement] = await rows<{
    status: string
    settlement_mode: string
    settled_by_user_id: string | null
    system_deadline_command_id: string | null
  }>(
    `SELECT status, settlement_mode, settled_by_user_id, system_deadline_command_id
     FROM trip_settlements WHERE trip_id = $1`,
    [fixture.tripId],
  )
  expect(settlement).toMatchObject({ status: 'COMPLETED', settlement_mode: 'SYSTEM_DEADLINE', settled_by_user_id: null })
  expect(settlement.system_deadline_command_id).toBeTruthy()
  const [command] = await rows<{ command_id: string; execution_key: string }>(
    `SELECT command_id, execution_key FROM system_deadline_commands WHERE trip_id = $1`,
    [fixture.tripId],
  )
  expect(command).toEqual({ command_id: settlement.system_deadline_command_id, execution_key: `deadline:${fixture.tripId}:revision:1` })
  expect(await rows(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'SETTLEMENT_CHARGE'`, [fixture.tripId])).toHaveLength(3)
  expect(await rows(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'REFUND'`, [fixture.tripId])).toHaveLength(3)
  expect(await rows(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'ADDITIONAL_DEBIT'`, [fixture.tripId])).toHaveLength(0)
  expect(await rows(
    `SELECT user_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type = 'SETTLEMENT_CHARGE'
       AND (available_delta <> 0 OR held_delta <> -5000)`,
    [fixture.tripId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT user_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type = 'REFUND'
       AND (available_delta <> 1000 OR held_delta <> -1000)`,
    [fixture.tripId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT user_id FROM trip_participants
     WHERE trip_id = $1 AND status <> 'COMPLETED'`,
    [fixture.tripId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT ledger_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND')
       AND (actor_user_id IS NOT NULL OR system_deadline_command_id <> $2)`,
    [fixture.tripId, command.command_id],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT user_id FROM point_accounts
     WHERE user_id = ANY($1::uuid[]) AND (available_points <> 1000 OR held_points <> 0)`,
    [fixture.userIds],
  )).toHaveLength(0)
  const retry = await runDueTransitions(request)
  expect(retry.settled).toBe(0)
  expect(await rows(`SELECT command_id FROM system_deadline_commands WHERE trip_id = $1`, [fixture.tripId])).toHaveLength(1)
  expect(await rows(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND')`, [fixture.tripId])).toHaveLength(6)
})

test('기한 만료 정산은 부족분을 추가 차감하고 예치를 모두 해제한다', async ({ request }) => {
  const fixture = await seedDueSettlement({
    depositAmount: 5000,
    finalShare: 6000,
    grantAmounts: [7000, 7000, 7000],
  })
  await runDueTransitions(request)

  expect(await rows(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'ADDITIONAL_DEBIT'`, [fixture.tripId])).toHaveLength(3)
  expect(await rows(
    `SELECT user_id FROM point_ledger
     WHERE trip_id = $1 AND entry_type = 'ADDITIONAL_DEBIT'
       AND (available_delta <> -1000 OR held_delta <> 0)`,
    [fixture.tripId],
  )).toHaveLength(0)
  expect(await rows(
    `SELECT user_id FROM point_accounts
     WHERE user_id = ANY($1::uuid[]) AND (available_points <> 1000 OR held_points <> 0)`,
    [fixture.userIds],
  )).toHaveLength(0)
})

test('잔액 부족이면 기한 만료 정산은 부분 원장·명령·상태 변경 없이 보류한다', async ({ request }) => {
  const fixture = await seedDueSettlement({
    depositAmount: 5000,
    finalShare: 6000,
    grantAmounts: [7000, 7000, 5000],
  })
  const result = await runDueTransitions(request)
  expect(result.settled).toBe(0)
  expect(result.skipped).toBeGreaterThanOrEqual(1)

  expect(await rows(`SELECT command_id FROM system_deadline_commands WHERE trip_id = $1`, [fixture.tripId])).toHaveLength(0)
  expect(await rows(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')`, [fixture.tripId])).toHaveLength(0)
  const [settlement] = await rows<{ status: string }>(`SELECT status FROM trip_settlements WHERE trip_id = $1`, [fixture.tripId])
  expect(settlement).toEqual({ status: 'PENDING_CONFIRMATION' })
  expect(await rows(
    `SELECT user_id FROM point_accounts
     WHERE user_id = ANY($1::uuid[])
       AND (
         (user_id = $2 AND available_points <> 2000)
         OR (user_id = $3 AND available_points <> 2000)
         OR (user_id = $4 AND available_points <> 0)
         OR held_points <> 5000
       )`,
    [fixture.userIds, fixture.userIds[0], fixture.userIds[1], fixture.userIds[2]],
  )).toHaveLength(0)
})

test('자동 전환 API는 인증 없는 요청을 거부한다', async ({ request }) => {
  const response = await request.get('/api/internal/due-transitions')
  expect(response.status()).toBe(401)
})
