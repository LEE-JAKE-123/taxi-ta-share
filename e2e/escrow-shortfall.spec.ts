import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'
import { seedApprovedDirectGrant } from './support/operational-fixtures'

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

test('a participant with an escrow shortfall can still confirm the current trip', async () => {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-escrow-shortfall-${randomUUID()}`
  const adminId = randomUUID()
  const approverId = randomUUID()
  const hostId = randomUUID()
  const memberId = randomUUID()
  const tripId = randomUUID()

  try {
    await client.query('BEGIN')
    for (const [userId, role, suffix] of [
      [adminId, 'ADMIN', 'admin'],
      [approverId, 'ADMIN', 'approver'],
      [hostId, 'USER', 'host'],
      [memberId, 'USER', 'member'],
    ] as const) {
      await client.query(
        `INSERT INTO users (
           user_id, signup_attempt_id, student_id, name, gender, school_email, role, account_status
         ) VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [
          userId,
          randomUUID(),
          `9${Date.now().toString().slice(-7)}${suffix.length}`,
          `${runId}-${suffix}`,
          `${runId}-${suffix}@jbnu.ac.kr`,
          role,
        ],
      )
    }

    await seedApprovedDirectGrant({
      client,
      targetUserId: hostId,
      amount: 5000,
      requestedByAdminId: adminId,
      approvedByAdminId: approverId,
      reason: 'E2E escrow shortfall host grant',
    })
    await seedApprovedDirectGrant({
      client,
      targetUserId: memberId,
      amount: 2000,
      requestedByAdminId: adminId,
      approvedByAdminId: approverId,
      reason: 'E2E escrow shortfall member grant',
    })

    await client.query(
       `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at, max_participants,
         estimated_fare, status, creation_idempotency_key, closed_at, closure_type
       ) VALUES ($1, $2, 'Escrow Origin', 'Escrow Destination', now() + interval '1 hour', 2,
         10000, 'OPEN', $3, NULL, NULL)`,
      [tripId, hostId, randomUUID()],
    )
    for (const [userId, role] of [[hostId, 'HOST'], [memberId, 'MEMBER']] as const) {
      await client.query(
        `INSERT INTO trip_participants (trip_id, user_id, role, status, approval_idempotency_key)
         VALUES ($1, $2, $3, 'APPROVED', $4)`,
        [tripId, userId, role, randomUUID()],
      )
    }
    await client.query(
      `UPDATE trip_groups
       SET status = 'CLOSED', closed_at = now(), closure_type = 'HOST'
       WHERE trip_id = $1`,
      [tripId],
    )

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
       ) VALUES ($1, $2, $3, $4, $5, 'E2E', 10000, 1200, 10000, 10000,
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
      'UPDATE trip_groups SET current_fare_estimate_id = $2 WHERE trip_id = $1',
      [tripId, fareEstimateId],
    )

    for (const [userId, heldPoints] of [[hostId, 5000], [memberId, 2000]] as const) {
      await client.query(
        'INSERT INTO trip_deposits (trip_id, user_id, amount) VALUES ($1, $2, $3)',
        [tripId, userId, heldPoints],
      )
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, 'E2E escrow deposit', $6)`,
        [userId, -heldPoints, heldPoints, tripId, hostId, `${runId}:deposit:${userId}`],
      )
    }
    await client.query('SAVEPOINT untracked_partial_escrow')
    await expect(
      client.query(
        `UPDATE trip_participants SET status = 'DEPOSITED'
         WHERE trip_id = $1 AND user_id = $2`,
        [tripId, memberId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await client.query('ROLLBACK TO SAVEPOINT untracked_partial_escrow')

    const shortfall = await client.query(
      `INSERT INTO trip_escrow_shortfalls (trip_id, user_id, expected_deposit_points)
       VALUES ($1, $2, 5000) RETURNING shortfall_id`,
      [tripId, memberId],
    )
    await client.query(
      `INSERT INTO trip_escrow_shortfall_events (
         shortfall_id, user_id, event_type, points_delta, actor_user_id,
         reason, idempotency_key
       ) VALUES ($1, $2, 'INCUR', 3000, $3, 'E2E low balance', $4)`,
      [shortfall.rows[0].shortfall_id, memberId, hostId, `${runId}:shortfall`],
    )

    for (const userId of [hostId, memberId]) {
      await client.query(
        `UPDATE trip_participants SET status = 'DEPOSITED'
         WHERE trip_id = $1 AND user_id = $2`,
        [tripId, userId],
      )
    }
    await client.query(
      `UPDATE trip_groups SET status = 'CONFIRMED', confirmation_idempotency_key = $2
       WHERE trip_id = $1`,
      [tripId, randomUUID()],
    )
    await client.query('COMMIT')

    const [trip] = (await client.query(
      'SELECT status FROM trip_groups WHERE trip_id = $1',
      [tripId],
    )).rows
    const [openShortfall] = (await client.query(
      `SELECT expected_deposit_points, outstanding_points, status
       FROM trip_escrow_shortfalls WHERE trip_id = $1 AND user_id = $2`,
      [tripId, memberId],
    )).rows
    expect(trip.status).toBe('CONFIRMED')
    expect(openShortfall).toEqual({
      expected_deposit_points: 5000,
      outstanding_points: 3000,
      status: 'OPEN',
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
})
