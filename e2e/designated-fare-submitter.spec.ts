import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'
import { seedApprovedDirectGrant } from './support/operational-fixtures'

type Fixture = {
  tripId: string
  hostId: string
  memberId: string
  outsiderId: string
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function seedDesignatedSubmitterTrip(): Promise<Fixture> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-designated-fare-${randomUUID()}`
  const adminId = randomUUID()
  const approverAdminId = randomUUID()
  const hostId = randomUUID()
  const memberId = randomUUID()
  const outsiderId = randomUUID()
  const tripId = randomUUID()

  try {
    await client.query('BEGIN')
    for (const [index, [userId, role]] of [
      [adminId, 'ADMIN'],
      [approverAdminId, 'ADMIN'],
      [hostId, 'USER'],
      [memberId, 'USER'],
      [outsiderId, 'USER'],
    ].entries()) {
      await client.query(
        `INSERT INTO users (
           user_id, signup_attempt_id, student_id, name, gender, school_email,
           role, account_status
         ) VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [
          userId,
          randomUUID(),
          `4${Date.now().toString().slice(-7)}${index}`,
          `${runId}-user-${index}`,
          `${runId}-${index}@jbnu.ac.kr`,
          role,
        ],
      )
    }
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at,
         max_participants, estimated_fare, status, creation_idempotency_key,
         closed_at, closure_type
       ) VALUES ($1, $2, 'E2E Origin', 'E2E Destination', now() + interval '1 hour',
         2, 12000, 'OPEN', $3, NULL, NULL)`,
      [tripId, hostId, randomUUID()],
    )
    for (const [userId, role] of [[hostId, 'HOST'], [memberId, 'MEMBER']] as const) {
      await client.query(
        `INSERT INTO trip_participants (
           trip_id, user_id, role, status, approval_idempotency_key
         ) VALUES ($1, $2, $3, 'APPROVED', $4)`,
        [tripId, userId, role, randomUUID()],
      )
    }
    await client.query(
      `UPDATE trip_groups
       SET status = 'CLOSED', closed_at = now(), closure_type = 'HOST'
       WHERE trip_id = $1`,
      [tripId],
    )
    for (const userId of [hostId, memberId]) {
      await seedApprovedDirectGrant({
        client,
        targetUserId: userId,
        amount: 6000,
        requestedByAdminId: adminId,
        approvedByAdminId: approverAdminId,
        reason: 'E2E grant',
      })
      await client.query(
        `INSERT INTO trip_deposits (trip_id, user_id, amount) VALUES ($1, $2, 6000)`,
        [tripId, userId],
      )
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'DEPOSIT', -6000, 6000, $2, $3, 'E2E deposit', $4)`,
        [userId, tripId, hostId, `${runId}:deposit:${userId}`],
      )
      await client.query(
        `UPDATE trip_participants SET status = 'DEPOSITED'
         WHERE trip_id = $1 AND user_id = $2`,
        [tripId, userId],
      )
    }
    const location = await client.query(
      'SELECT location_revision FROM trip_groups WHERE trip_id = $1',
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
       ) VALUES ($1, $2, $3, $4, $5, 'E2E', 10000, 1200, 12000, 12000,
         'E2E fixture', 'E2E', '1', now(), now() + interval '1 day', $6, $7,
         '{"fixture":true}'::jsonb, $8)`,
      [
        fareEstimateId,
        tripId,
        location.rows[0].location_revision,
        `${runId}:route`,
        `${runId}:fare`,
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
       SET fare_submitter_user_id = $2,
           fare_submitter_set_by = $3,
           fare_submitter_idempotency_key = $4,
           fare_submitter_set_at = now()
       WHERE trip_id = $1`,
      [tripId, memberId, hostId, randomUUID()],
    )
    await client.query(
      `UPDATE trip_groups
       SET status = 'IN_PROGRESS', in_progress_at = now(), start_idempotency_key = $2
       WHERE trip_id = $1`,
      [tripId, randomUUID()],
    )
    await client.query(
      `UPDATE trip_participants
       SET status = 'CHECKED_IN', checked_in_at = now(), check_in_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, memberId, randomUUID()],
    )
    await client.query('COMMIT')
    return { tripId, hostId, memberId, outsiderId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

async function submitSettlement(input: { tripId: string; submittedBy: string }) {
  const pool = database()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const settlement = await client.query(
      `INSERT INTO trip_settlements (
         trip_id, actual_fare, participant_count, final_share, submitted_by,
         fare_submission_idempotency_key, confirmation_deadline, cohort_basis
       ) VALUES ($1, 12000, 2, 6000, $2, $3, now() + interval '24 hours',
         'ESCROW_CONFIRMED')
       RETURNING submitted_by`,
      [input.tripId, input.submittedBy, randomUUID()],
    )
    // An escrow-confirmed settlement always snapshots its fixed cohort. Keep
    // this direct fixture consistent with the production submission boundary.
    await client.query(
      `INSERT INTO trip_settlement_participants (
         trip_id, user_id, deposit_amount, final_share
       )
       SELECT $1, d.user_id, d.amount, s.final_share
       FROM trip_deposits d
       JOIN trip_settlements s ON s.trip_id = d.trip_id
       WHERE d.trip_id = $1`,
      [input.tripId],
    )
    await client.query('COMMIT')
    return settlement
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

test('지정 참여자가 실제 요금 제출자로 허용되고 비지정 사용자는 거부된다', async () => {
  const hostFixture = await seedDesignatedSubmitterTrip()
  const host = await submitSettlement({
    tripId: hostFixture.tripId,
    submittedBy: hostFixture.hostId,
  })
  expect(host.rows).toEqual([{ submitted_by: hostFixture.hostId }])

  const designatedFixture = await seedDesignatedSubmitterTrip()
  const designated = await submitSettlement({
    tripId: designatedFixture.tripId,
    submittedBy: designatedFixture.memberId,
  })
  expect(designated.rows).toEqual([{ submitted_by: designatedFixture.memberId }])

  const rejectedFixture = await seedDesignatedSubmitterTrip()
  await expect(submitSettlement({
    tripId: rejectedFixture.tripId,
    submittedBy: rejectedFixture.outsiderId,
  })).rejects.toMatchObject({ code: '23514' })
})
