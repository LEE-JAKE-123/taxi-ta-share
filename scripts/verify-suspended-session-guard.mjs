import { randomUUID } from 'node:crypto'
import { Pool } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_MIGRATION_URL

if (!databaseUrl) {
  throw new Error('DATABASE_MIGRATION_URL is required.')
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
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

try {
  await client.query('BEGIN')

  const suspendedUser = await client.query(
    `INSERT INTO users (
       signup_attempt_id, student_id, name, gender, school_email, account_status
     ) VALUES (gen_random_uuid(), $1, '정지 세션 검증', 'female', $2, 'SUSPENDED')
     RETURNING user_id`,
    [`8${probeSuffix}`, `suspended-session-${randomUUID()}@jbnu.ac.kr`],
  )
  await expectCheckViolation(
    () =>
      client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [suspendedUser.rows[0].user_id, 'a'.repeat(64), expiresAt],
      ),
    'Suspended users must not create a session.',
  )

  const activeUser = await client.query(
    `INSERT INTO users (
       signup_attempt_id, student_id, name, gender, school_email
     ) VALUES (gen_random_uuid(), $1, '재활성 검증', 'female', $2)
     RETURNING user_id`,
    [`7${probeSuffix}`, `reactivation-session-${randomUUID()}@jbnu.ac.kr`],
  )
  const activeUserId = activeUser.rows[0].user_id
  await client.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at, revoked_at)
     VALUES ($1, $2, $3, now())`,
    [activeUserId, 'b'.repeat(64), expiresAt],
  )
  await client.query(
    `UPDATE users SET account_status = 'SUSPENDED' WHERE user_id = $1`,
    [activeUserId],
  )
  await expectCheckViolation(
    () =>
      client.query(
        `UPDATE auth_sessions SET revoked_at = NULL WHERE user_id = $1`,
        [activeUserId],
      ),
    'Suspended users must not reactivate a revoked session.',
  )

  await client.query('ROLLBACK')
  console.log(
    'Verified suspended-account session creation and reactivation are rejected; transaction rolled back.',
  )
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
