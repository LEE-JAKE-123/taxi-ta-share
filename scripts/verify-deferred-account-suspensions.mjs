import { randomUUID } from 'node:crypto'
import { Pool } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_MIGRATION_URL

if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL is required.')

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()
const probeSuffix = String(Date.now()).slice(-8)

try {
  await client.query('BEGIN')
  const users = await client.query(
    `INSERT INTO users (
       signup_attempt_id, student_id, name, gender, school_email, role
     ) VALUES
       (gen_random_uuid(), $1, '정지 지정 검증 관리자', 'female', $2, 'ADMIN'),
       (gen_random_uuid(), $3, '정지 지정 검증 사용자', 'male', $4, 'USER')
     RETURNING user_id, role`,
    [
      `7${probeSuffix}`,
      `deferred-admin-${randomUUID()}@jbnu.ac.kr`,
      `8${probeSuffix}`,
      `deferred-user-${randomUUID()}@jbnu.ac.kr`,
    ],
  )
  const adminId = users.rows.find((row) => row.role === 'ADMIN').user_id
  const targetId = users.rows.find((row) => row.role === 'USER').user_id
  const trip = await client.query(
    `INSERT INTO trip_groups (
       host_user_id, origin, destination, departure_at, max_participants,
       estimated_fare, creation_idempotency_key
     ) VALUES ($1, '정지 대기 출발지', '정지 대기 목적지',
       now() + interval '1 day', 2, 100, $2)
     RETURNING trip_id`,
    [targetId, randomUUID()],
  )
  await client.query(
    `INSERT INTO account_suspension_requests (
       target_user_id, requested_by_admin_id, source_type, reason, idempotency_key
     ) VALUES ($1, $2, 'ADMIN_DIRECT', 'deferred suspension verification', $3)`,
    [targetId, adminId, randomUUID()],
  )
  await client.query('SELECT effect_due_account_suspensions_for_user($1)', [targetId])
  const pending = await client.query(
    `SELECT u.account_status, request.effective_at
     FROM users u
     JOIN account_suspension_requests request ON request.target_user_id = u.user_id
     WHERE u.user_id = $1`,
    [targetId],
  )
  if (
    pending.rows[0]?.account_status !== 'ACTIVE' ||
    pending.rows[0]?.effective_at !== null
  ) {
    throw new Error('Active trip must defer direct suspension effect.')
  }

  await client.query(
    `UPDATE trip_groups
     SET status = 'CANCELLED', closed_at = now(), closure_type = 'CANCELLED',
         cancelled_at = now(), cancellation_idempotency_key = $2
     WHERE trip_id = $1`,
    [trip.rows[0].trip_id, randomUUID()],
  )
  await client.query('SET CONSTRAINTS ALL IMMEDIATE')
  const effected = await client.query(
    `SELECT u.account_status, request.effective_at,
            EXISTS (
              SELECT 1 FROM admin_account_actions action
              WHERE action.target_user_id = u.user_id
                AND action.action_type = 'SUSPEND'
            ) AS has_direct_audit
     FROM users u
     JOIN account_suspension_requests request ON request.target_user_id = u.user_id
     WHERE u.user_id = $1`,
    [targetId],
  )
  if (
    effected.rows[0]?.account_status !== 'SUSPENDED' ||
    !effected.rows[0]?.effective_at ||
    effected.rows[0]?.has_direct_audit !== true
  ) {
    throw new Error('Terminal trip must atomically effect the deferred suspension.')
  }

  await client.query('ROLLBACK')
  console.log(
    'Verified administrator-designated suspension waits for terminal trip state, then records one audit action and suspends; transaction rolled back.',
  )
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
