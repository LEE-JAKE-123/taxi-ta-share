import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_MIGRATION_URL
const expectedDatabaseName = process.env.DATABASE_EXPECTED_NAME
const expectedRole = process.env.DATABASE_EXPECTED_MIGRATION_ROLE
const expectedEnvironment = process.env.APP_ENVIRONMENT
const expectedFingerprint = process.env.DATABASE_FINGERPRINT

if (
  !databaseUrl ||
  !expectedDatabaseName ||
  !expectedRole ||
  !expectedEnvironment ||
  !expectedFingerprint
) {
  throw new Error('Migration identity variables are required.')
}

const prerequisiteChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0029_debt_repayment_ledger_type_guard.sql'))
  .digest('hex')

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()

try {
  await client.query('BEGIN READ ONLY')
  await client.query(`SET LOCAL lock_timeout = '5s'`)
  await client.query(`SET LOCAL statement_timeout = '30s'`)
  const result = await client.query(
    `SELECT
       current_database() = $1 AS database_matches,
       current_user = $2 AS role_matches,
       EXISTS (
         SELECT 1 FROM application_environment
         WHERE singleton = true AND environment = $3 AND fingerprint = $4
       ) AS environment_matches,
       (
         SELECT count(*) = 1
         FROM schema_migrations
         WHERE version = '0029_debt_repayment_ledger_type_guard'
           AND checksum = $5
           AND environment = $3
       ) AS prerequisite_valid,
       (
         SELECT count(*) = 0
         FROM schema_migrations
         WHERE version IN (
           '0030_predeparture_escrow_guard',
           '0031_trip_incident_intake',
           '0032_trip_incident_review_workflow',
           '0033_member_no_show_execution',
           '0034_host_no_start_refund_execution',
           '0035_trip_incident_rebuttal_window',
           '0036_admin_point_grant_dual_control'
         )
       ) AS batch_not_recorded,
       NOT EXISTS (
         SELECT 1
         FROM trip_groups g
         JOIN trip_deposits d ON d.trip_id = g.trip_id
         WHERE g.status = 'CLOSED'
           AND g.departure_at <= clock_timestamp()
       ) AS no_late_closed_trip_deposits,
       NOT EXISTS (
         SELECT 1
         FROM point_grant_requests r
         LEFT JOIN point_ledger l ON l.ledger_id = r.fulfilled_ledger_id
         WHERE r.status = 'FULFILLED'
           AND (
             l.ledger_id IS NULL
             OR l.entry_type <> 'ADMIN_GRANT'
             OR l.point_request_id <> r.request_id
             OR l.user_id <> r.requester_user_id
             OR l.actor_user_id <> r.fulfilled_by
             OR l.available_delta <> r.requested_amount
             OR l.held_delta <> 0
           )
       ) AS fulfilled_point_request_provenance_valid,
       NOT EXISTS (
         SELECT 1
         FROM point_grant_requests r
         JOIN point_ledger l
           ON l.point_request_id = r.request_id
          AND l.entry_type = 'ADMIN_GRANT'
         WHERE r.status <> 'FULFILLED'
            OR r.fulfilled_ledger_id IS DISTINCT FROM l.ledger_id
            OR r.fulfilled_by IS DISTINCT FROM l.actor_user_id
       ) AS point_request_ledger_links_valid`,
    [
      expectedDatabaseName,
      expectedRole,
      expectedEnvironment,
      expectedFingerprint,
      prerequisiteChecksum,
    ],
  )

  const failures = Object.entries(result.rows[0] ?? {})
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name)
  if (failures.length) {
    throw new Error(
      `0030-0036 migration preflight failed: ${failures.join(', ')}.`,
    )
  }
  console.log(`0030-0036 migration preflight passed; 0029 sha256 ${prerequisiteChecksum}.`)
  await client.query('ROLLBACK')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
