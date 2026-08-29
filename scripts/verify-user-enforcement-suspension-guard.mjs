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

async function createReport({ reporterId, reportedUserId, reasonCode }) {
  const result = await client.query(
    `INSERT INTO user_reports (
       reporter_user_id, reported_user_id, reason_code, description,
       idempotency_key
     ) VALUES ($1, $2, $3, 'suspension guard verification report', $4)
     RETURNING report_id`,
    [reporterId, reportedUserId, reasonCode, randomUUID()],
  )
  return result.rows[0].report_id
}

async function insertSuspension({ userId, reportId, adminId, idempotencyKey }) {
  await client.query(
    `INSERT INTO user_enforcement_actions (
       user_id, report_id, admin_user_id, action_type, reason, idempotency_key
     ) VALUES ($1, $2, $3, 'SUSPEND', 'suspension guard verification', $4)`,
    [userId, reportId, adminId, idempotencyKey],
  )
}

async function insertSuspendReview({ reportId, adminId, idempotencyKey }) {
  await client.query(
    `INSERT INTO report_review_actions (
       report_id, admin_user_id, action_type, resolution_note, idempotency_key
     ) VALUES ($1, $2, 'SUSPEND_USER', 'suspension guard verification', $3)`,
    [reportId, adminId, idempotencyKey],
  )
}

try {
  await client.query('BEGIN')

  const users = await client.query(
    `INSERT INTO users (
       signup_attempt_id, student_id, name, gender, school_email, role
     ) VALUES
       (gen_random_uuid(), $1, '정지 검증 신고자', 'female', $2, 'USER'),
       (gen_random_uuid(), $3, '정지 검증 대상', 'female', $4, 'USER'),
       (gen_random_uuid(), $5, '정지 검증 관리자', 'female', $6, 'ADMIN'),
       (gen_random_uuid(), $7, '정지 검증 관리자 대상', 'female', $8, 'ADMIN')
     RETURNING user_id, role`,
    [
      `1${probeSuffix}`,
      `enforcement-reporter-${randomUUID()}@jbnu.ac.kr`,
      `2${probeSuffix}`,
      `enforcement-target-${randomUUID()}@jbnu.ac.kr`,
      `3${probeSuffix}`,
      `enforcement-executor-${randomUUID()}@jbnu.ac.kr`,
      `4${probeSuffix}`,
      `enforcement-admin-target-${randomUUID()}@jbnu.ac.kr`,
    ],
  )
  const reporterId = users.rows.find((row) => row.role === 'USER').user_id
  const targetId = users.rows.filter((row) => row.role === 'USER')[1].user_id
  const adminId = users.rows.find((row) => row.role === 'ADMIN').user_id
  const adminTargetId = users.rows.filter((row) => row.role === 'ADMIN')[1]
    .user_id

  const noShowReportId = await createReport({
    reporterId,
    reportedUserId: targetId,
    reasonCode: 'NO_SHOW',
  })
  const noShowIdempotencyKey = randomUUID()
  await insertSuspendReview({
    reportId: noShowReportId,
    adminId,
    idempotencyKey: noShowIdempotencyKey,
  })
  await expectCheckViolation(
    () =>
      insertSuspension({
        userId: targetId,
        reportId: noShowReportId,
        adminId,
        idempotencyKey: noShowIdempotencyKey,
      }),
    'NO_SHOW reports must not create an immediate suspension.',
  )

  const adminTargetReportId = await createReport({
    reporterId,
    reportedUserId: adminTargetId,
    reasonCode: 'SAFETY',
  })
  const adminTargetIdempotencyKey = randomUUID()
  await insertSuspendReview({
    reportId: adminTargetReportId,
    adminId,
    idempotencyKey: adminTargetIdempotencyKey,
  })
  await expectCheckViolation(
    () =>
      insertSuspension({
        userId: adminTargetId,
        reportId: adminTargetReportId,
        adminId,
        idempotencyKey: adminTargetIdempotencyKey,
      }),
    'Administrator accounts must not be suspended through user enforcement.',
  )

  const unreviewedReportId = await createReport({
    reporterId,
    reportedUserId: targetId,
    reasonCode: 'SAFETY',
  })
  await expectCheckViolation(
    () =>
      insertSuspension({
        userId: targetId,
        reportId: unreviewedReportId,
        adminId,
        idempotencyKey: randomUUID(),
      }),
    'Suspension enforcement requires its matching report review action.',
  )

  const safetyReportId = await createReport({
    reporterId,
    reportedUserId: targetId,
    reasonCode: 'SAFETY',
  })
  const safetyIdempotencyKey = randomUUID()
  await insertSuspendReview({
    reportId: safetyReportId,
    adminId,
    idempotencyKey: safetyIdempotencyKey,
  })
  await insertSuspension({
    userId: targetId,
    reportId: safetyReportId,
    adminId,
    idempotencyKey: safetyIdempotencyKey,
  })

  await client.query('ROLLBACK')
  console.log(
    'Verified no-show and administrator targets are rejected while a valid user suspension is accepted; transaction rolled back.',
  )
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
