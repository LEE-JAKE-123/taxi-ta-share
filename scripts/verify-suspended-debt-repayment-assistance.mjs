import { randomUUID } from 'node:crypto'
import { Pool } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_MIGRATION_URL

if (!databaseUrl) {
  throw new Error('DATABASE_MIGRATION_URL is required.')
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()
const probeSuffix = String(Date.now()).slice(-8)

async function expectCheckViolation(run, message) {
  await client.query('SAVEPOINT expected_check_violation')
  try {
    await run()
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expected_check_violation')
    if (typeof error === 'object' && error && error.code === '23514') return
    throw error
  }
  await client.query('RELEASE SAVEPOINT expected_check_violation')
  throw new Error(message)
}

async function createExecutionRequest({ targetUserId, adminId, amount, purpose }) {
  const result = await client.query(
    `INSERT INTO point_grant_execution_requests (
       target_user_id, amount, reason, purpose, requested_by_admin_id,
       idempotency_key
     ) VALUES ($1, $2, 'settlement assistance verification', $3, $4, $5)
     RETURNING execution_request_id`,
    [targetUserId, amount, purpose, adminId, randomUUID()],
  )
  return result.rows[0].execution_request_id
}

async function approveExecution({ executionRequestId, approverId }) {
  const result = await client.query(
    `INSERT INTO point_grant_approval_commands (
       execution_request_id, approved_by_admin_id, idempotency_key
     ) VALUES ($1, $2, $3)
     RETURNING approval_command_id`,
    [executionRequestId, approverId, randomUUID()],
  )
  return result.rows[0].approval_command_id
}

try {
  await client.query('BEGIN')

  const users = await client.query(
    `INSERT INTO users (
       signup_attempt_id, student_id, name, gender, school_email, role,
       account_status
     ) VALUES
       (gen_random_uuid(), $1, '상환 검증 기안 관리자', 'female', $2, 'ADMIN', 'ACTIVE'),
       (gen_random_uuid(), $3, '상환 검증 승인 관리자', 'female', $4, 'ADMIN', 'ACTIVE'),
       (gen_random_uuid(), $5, '상환 검증 정지 사용자', 'female', $6, 'USER', 'SUSPENDED')
     RETURNING user_id, role`,
    [
      `5${probeSuffix}`,
      `debt-grant-requester-${randomUUID()}@jbnu.ac.kr`,
      `6${probeSuffix}`,
      `debt-grant-approver-${randomUUID()}@jbnu.ac.kr`,
      `7${probeSuffix}`,
      `debt-grant-target-${randomUUID()}@jbnu.ac.kr`,
    ],
  )
  const requesterId = users.rows.filter((row) => row.role === 'ADMIN')[0].user_id
  const approverId = users.rows.filter((row) => row.role === 'ADMIN')[1].user_id
  const targetId = users.rows.find((row) => row.role === 'USER').user_id

  const trip = await client.query(
    `INSERT INTO trip_groups (
       host_user_id, origin, destination, departure_at, max_participants,
       estimated_fare, creation_idempotency_key
     ) VALUES ($1, '상환 검증 출발지', '상환 검증 도착지',
       now() + interval '1 day', 2, 100, $2)
     RETURNING trip_id`,
    [requesterId, randomUUID()],
  )
  const debt = await client.query(
    `INSERT INTO point_debt_obligations (user_id, trip_id, fare_revision)
     VALUES ($1, $2, 1)
     RETURNING debt_id`,
    [targetId, trip.rows[0].trip_id],
  )
  await client.query(
    `INSERT INTO point_debt_events (
       debt_id, user_id, event_type, debt_delta, actor_user_id, reason,
       idempotency_key
     ) VALUES ($1, $2, 'INCUR', 100, $3, 'verification debt', $4)`,
    [debt.rows[0].debt_id, targetId, requesterId, randomUUID()],
  )

  await expectCheckViolation(
    () =>
      createExecutionRequest({
        targetUserId: targetId,
        adminId: requesterId,
        amount: 100,
        purpose: 'GENERAL',
      }),
    'Suspended users must not receive a general point grant.',
  )

  const executionRequestId = await createExecutionRequest({
    targetUserId: targetId,
    adminId: requesterId,
    amount: 100,
    purpose: 'SETTLEMENT_DEBT_REPAYMENT',
  })
  const approvalCommandId = await approveExecution({
    executionRequestId,
    approverId,
  })
  const grant = await client.query(
    `INSERT INTO point_ledger (
       user_id, entry_type, available_delta, held_delta, actor_user_id, reason,
       idempotency_key, grant_execution_request_id, grant_approval_command_id
     ) VALUES ($1, 'ADMIN_GRANT', 100, 0, $2,
       'settlement assistance verification', $3, $4, $5)
     RETURNING ledger_id`,
    [targetId, requesterId, randomUUID(), executionRequestId, approvalCommandId],
  )
  const repaymentLedger = await client.query(
    `INSERT INTO point_ledger (
       user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id,
       reason, idempotency_key
     ) VALUES ($1, 'DEBT_REPAYMENT', -100, 0, $2, $3,
       'settlement assistance verification', $4)
     RETURNING ledger_id`,
    [targetId, trip.rows[0].trip_id, requesterId, randomUUID()],
  )
  await client.query(
    `INSERT INTO point_debt_events (
       debt_id, user_id, event_type, debt_delta, actor_user_id, reason,
       idempotency_key, repayment_ledger_id, grant_execution_request_id
     ) VALUES ($1, $2, 'REPAYMENT', -100, $3,
       'settlement assistance verification', $4, $5, $6)`,
    [
      debt.rows[0].debt_id,
      targetId,
      requesterId,
      randomUUID(),
      repaymentLedger.rows[0].ledger_id,
      executionRequestId,
    ],
  )
  await client.query('SET CONSTRAINTS ALL IMMEDIATE')

  const result = await client.query(
    `SELECT u.account_status, d.status, d.outstanding_points,
            account.available_points
     FROM users u
     JOIN point_debt_obligations d ON d.user_id = u.user_id
     JOIN point_accounts account ON account.user_id = u.user_id
     WHERE u.user_id = $1 AND d.debt_id = $2`,
    [targetId, debt.rows[0].debt_id],
  )
  const row = result.rows[0]
  if (
    row?.account_status !== 'SUSPENDED' ||
    row?.status !== 'SETTLED' ||
    Number(row?.outstanding_points) !== 0 ||
    Number(row?.available_points) !== 0 ||
    !grant.rows[0]?.ledger_id
  ) {
    throw new Error('Settlement assistance did not fully repay debt without reactivating or crediting balance.')
  }

  await client.query('ROLLBACK')
  console.log(
    'Verified suspended debt assistance fully repays debt, leaves no usable surplus, and does not reactivate the account; transaction rolled back.',
  )
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
