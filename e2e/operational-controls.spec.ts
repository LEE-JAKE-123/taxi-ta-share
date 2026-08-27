import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'
import {
  approvePointGrantExecution,
  decideTripIncident,
  executeConfirmedMemberNoShow,
  executePointGrantExecution,
  preparePointRequestFulfillment,
  reportTripIncident,
  requestPoints,
  submitTripIncidentRebuttal,
} from '@/lib/core/service'
import { seedApprovedDirectGrant } from './support/operational-fixtures'

type Actors = {
  requesterId: string
  executorAdminId: string
  approverAdminId: string
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function queryRows<T>(sql: string, values: unknown[] = []) {
  const pool = database()
  const client = await pool.connect()
  try {
    return (await client.query(sql, values)).rows as T[]
  } finally {
    client.release()
    await pool.end()
  }
}

async function seedActors(): Promise<Actors> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-controls-${randomUUID()}`
  const requesterId = randomUUID()
  const executorAdminId = randomUUID()
  const approverAdminId = randomUUID()
  try {
    await client.query('BEGIN')
    for (const [index, [userId, role, name]] of [
      [requesterId, 'USER', 'E2E Control User'],
      [executorAdminId, 'ADMIN', 'E2E Control Executor'],
      [approverAdminId, 'ADMIN', 'E2E Control Approver'],
    ].entries()) {
      await client.query(
        `INSERT INTO users (
           user_id, signup_attempt_id, student_id, name, gender, school_email,
           role, account_status
         ) VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [
          userId,
          randomUUID(),
          `5${Date.now().toString().slice(-7)}${index}`,
          `${runId}-${name}`,
          `${runId}-${index}@jbnu.ac.kr`,
          role,
        ],
      )
    }
    await client.query('COMMIT')
    return { requesterId, executorAdminId, approverAdminId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

test('linked point-request grant cannot commit while its request remains PENDING, and service replay writes one grant', async () => {
  const actors = await seedActors()
  const amount = 750
  const reason = 'E2E linked point request atomicity'
  const requestId = await requestPoints({
    requesterId: actors.requesterId,
    amount,
    reason,
    idempotencyKey: randomUUID(),
  })
  const executionRequestId = await preparePointRequestFulfillment({
    adminId: actors.executorAdminId,
    requestId,
    idempotencyKey: randomUUID(),
  })
  const approvalCommandId = await approvePointGrantExecution({
    adminId: actors.approverAdminId,
    executionRequestId,
    idempotencyKey: randomUUID(),
  })

  const pool = database()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO point_ledger (
         user_id, entry_type, available_delta, held_delta, actor_user_id, reason,
         idempotency_key, point_request_id, grant_execution_request_id,
         grant_approval_command_id
       ) VALUES ($1, 'ADMIN_GRANT', $2, 0, $3, $4, $5, $6, $7, $8)`,
      [
        actors.requesterId,
        amount,
        actors.executorAdminId,
        reason,
        `e2e-invalid-pending-grant:${randomUUID()}`,
        requestId,
        executionRequestId,
        approvalCommandId,
      ],
    )
    await expect(client.query('COMMIT')).rejects.toThrow(
      /linked point request must be fulfilled/i,
    )
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
    await pool.end()
  }

  expect(await queryRows<{ status: string }>(
    `SELECT status FROM point_grant_requests WHERE request_id = $1`, [requestId],
  )).toEqual([{ status: 'PENDING' }])
  expect(await queryRows(
    `SELECT ledger_id FROM point_ledger WHERE grant_execution_request_id = $1`,
    [executionRequestId],
  )).toEqual([])

  const [first, replay] = await Promise.all([
    executePointGrantExecution({ adminId: actors.executorAdminId, executionRequestId }),
    executePointGrantExecution({ adminId: actors.executorAdminId, executionRequestId }),
  ])
  expect(replay).toBe(first)
  expect(await queryRows<{ status: string; fulfilled_ledger_id: string }>(
    `SELECT status, fulfilled_ledger_id FROM point_grant_requests WHERE request_id = $1`, [requestId],
  )).toEqual([{ status: 'FULFILLED', fulfilled_ledger_id: first }])
  expect(await queryRows(
    `SELECT ledger_id FROM point_ledger WHERE grant_execution_request_id = $1`,
    [executionRequestId],
  )).toEqual([{ ledger_id: first }])
})

async function seedNoShowJourney() {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-no-show-controls-${randomUUID()}`
  const adminId = randomUUID()
  const approverAdminId = randomUUID()
  const hostId = randomUUID()
  const memberId = randomUUID()
  const tripId = randomUUID()
  try {
    await client.query('BEGIN')
    for (const [index, [userId, role, name]] of [
      [adminId, 'ADMIN', 'E2E Incident Admin'],
      [approverAdminId, 'ADMIN', 'E2E Grant Approver'],
      [hostId, 'USER', 'E2E Incident Host'],
      [memberId, 'USER', 'E2E Incident Member'],
    ].entries()) {
      await client.query(
        `INSERT INTO users (
           user_id, signup_attempt_id, student_id, name, gender, school_email,
           role, account_status
         ) VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [userId, randomUUID(), `4${Date.now().toString().slice(-7)}${index}`, `${runId}-${name}`, `${runId}-${index}@jbnu.ac.kr`, role],
      )
    }
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at, max_participants,
         estimated_fare, status, creation_idempotency_key, closed_at, closure_type
       ) VALUES ($1, $2, 'E2E Origin', 'E2E Destination', now() + interval '1 hour',
         2, 10000, 'OPEN', $3, NULL, NULL)`,
      [tripId, hostId, randomUUID()],
    )
    for (const [userId, role] of [[hostId, 'HOST'], [memberId, 'MEMBER']] as const) {
      await client.query(
        `INSERT INTO trip_participants (trip_id, user_id, role, status, approval_idempotency_key)
         VALUES ($1, $2, $3, 'APPROVED', $4)`,
        [tripId, userId, role, randomUUID()],
      )
    }
    await client.query(`UPDATE trip_groups SET status = 'CLOSED', closed_at = now(), closure_type = 'HOST' WHERE trip_id = $1`, [tripId])
    for (const userId of [hostId, memberId]) {
      await seedApprovedDirectGrant({
        client,
        targetUserId: userId,
        amount: 5000,
        requestedByAdminId: adminId,
        approvedByAdminId: approverAdminId,
        reason: 'E2E incident fixture grant',
      })
      await client.query(`INSERT INTO trip_deposits (trip_id, user_id, amount) VALUES ($1, $2, 5000)`, [tripId, userId])
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'DEPOSIT', -5000, 5000, $2, $3, 'E2E incident fixture deposit', $4)`,
        [userId, tripId, hostId, `${runId}:deposit:${userId}`],
      )
      await client.query(`UPDATE trip_participants SET status = 'DEPOSITED' WHERE trip_id = $1 AND user_id = $2`, [tripId, userId])
    }
    const fareEstimateId = randomUUID()
    const location = await client.query(`SELECT location_revision FROM trip_groups WHERE trip_id = $1`, [tripId])
    await client.query(
      `INSERT INTO fare_estimates (
         fare_estimate_id, trip_id, trip_location_revision, route_calculation_id, fare_calculation_id,
         provider_key, route_distance_m, duration_seconds, estimated_fare_won, deposit_points_total,
         fare_source, pricing_policy_key, pricing_policy_version, calculated_at, expires_at,
         request_trace_id, request_fingerprint, calculation_basis, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, 'E2E', 1000, 60, 10000, 10000,
         'E2E fixture', 'E2E', '1', now(), now() + interval '1 day', $6, $7,
         '{"fixture":true}'::jsonb, $8)`,
      [fareEstimateId, tripId, location.rows[0].location_revision, `${runId}:route`, `${runId}:fare`, `${runId}:trace`, `${runId}:fingerprint`, randomUUID()],
    )
    await client.query(`UPDATE trip_groups SET current_fare_estimate_id = $2, status = 'CONFIRMED' WHERE trip_id = $1`, [tripId, fareEstimateId])
    await client.query(
      `UPDATE trip_groups SET status = 'IN_PROGRESS', in_progress_at = now(), start_idempotency_key = $2 WHERE trip_id = $1`,
      [tripId, randomUUID()],
    )
    await client.query(
      `UPDATE trip_participants SET status = 'CHECKED_IN', checked_in_at = now(), check_in_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, hostId, randomUUID()],
    )
    await client.query('COMMIT')
    return { adminId, hostId, memberId, tripId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

test('responsibility needs a durable notification and response; no-show execution replay has one provenance record', async () => {
  const fixture = await seedNoShowJourney()
  const incidentId = await reportTripIncident({
    reporterId: fixture.hostId,
    tripId: fixture.tripId,
    reportedUserId: fixture.memberId,
    incidentType: 'MEMBER_NO_SHOW',
    description: 'E2E member did not arrive at the confirmed gathering point.',
    idempotencyKey: randomUUID(),
  })
  await decideTripIncident({
    adminId: fixture.adminId,
    incidentId,
    commandType: 'START_REVIEW',
    decisionNote: 'E2E review has started with a response opportunity.',
    evidenceBasis: 'E2E attendance and trip state records were checked.',
    idempotencyKey: randomUUID(),
  })
  expect(await queryRows(
    `SELECT notification_id FROM trip_incident_review_notifications WHERE incident_id = $1`,
    [incidentId],
  )).toHaveLength(1)
  await expect(decideTripIncident({
    adminId: fixture.adminId,
    incidentId,
    commandType: 'RESPONSIBILITY_CONFIRMED',
    decisionNote: 'E2E cannot confirm before a response or deadline.',
    evidenceBasis: 'E2E evidence remains under review until response closes.',
    idempotencyKey: randomUUID(),
  })).rejects.toThrow()
  await submitTripIncidentRebuttal({
    authorId: fixture.memberId,
    incidentId,
    statement: 'E2E rebuttal records the member response before responsibility is confirmed.',
    idempotencyKey: randomUUID(),
  })
  await decideTripIncident({
    adminId: fixture.adminId,
    incidentId,
    commandType: 'RESPONSIBILITY_CONFIRMED',
    decisionNote: 'E2E responsibility is confirmed after the member response.',
    evidenceBasis: 'E2E attendance record and written response were reviewed.',
    idempotencyKey: randomUUID(),
  })
  const [executionId, replayId] = await Promise.all([
    executeConfirmedMemberNoShow({ adminId: fixture.adminId, incidentId, idempotencyKey: randomUUID() }),
    executeConfirmedMemberNoShow({ adminId: fixture.adminId, incidentId, idempotencyKey: randomUUID() }),
  ])
  expect(replayId).toBe(executionId)
  expect(await queryRows(
    `SELECT execution_id FROM trip_incident_no_show_executions WHERE incident_id = $1`, [incidentId],
  )).toEqual([{ execution_id: executionId }])
  expect(await queryRows<{ status: string; no_show_execution_id: string }>(
    `SELECT status, no_show_execution_id FROM trip_participants WHERE trip_id = $1 AND user_id = $2`,
    [fixture.tripId, fixture.memberId],
  )).toEqual([{ status: 'NO_SHOW', no_show_execution_id: executionId }])
})
