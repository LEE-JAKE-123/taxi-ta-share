import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'

type Fixture = {
  runId: string
  tripId: string
  adminId: string
  adminToken: string
  disputeId: string
  memberIds: string[]
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function seedPendingDispute(): Promise<Fixture> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-${randomUUID()}`
  const tripId = randomUUID()
  const adminId = randomUUID()
  const hostId = randomUUID()
  const memberId = randomUUID()
  const noShowId = randomUUID()
  const ids = [hostId, memberId, noShowId]
  const token = randomBytes(32).toString('base64url')
  const disputeId = randomUUID()
  try {
    await client.query('BEGIN')
    const people = [
      [adminId, 'ADMIN', '관리자'],
      [hostId, 'USER', '방장'],
      [memberId, 'USER', '이의참여자'],
      [noShowId, 'USER', '노쇼참여자'],
    ] as const
    for (let index = 0; index < people.length; index += 1) {
      const [userId, role, name] = people[index]
      await client.query(
        `INSERT INTO users (user_id, signup_attempt_id, student_id, name, gender, school_email, role, account_status)
         VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [userId, randomUUID(), `9${Date.now().toString().slice(-7)}${index}`, `${runId}-${name}`, `${runId}-${index}@jbnu.ac.kr`, role],
      )
    }
    await client.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [adminId, createHash('sha256').update(token).digest('hex')],
    )
    for (const userId of ids) {
      await client.query(
        `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
         VALUES ($1, 'ADMIN_GRANT', 6000, 0, NULL, $2, 'E2E fixture grant', $3)`,
        [userId, adminId, `${runId}:grant:${userId}`],
      )
    }
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at, max_participants,
         estimated_fare, status, creation_idempotency_key, closed_at, closure_type
       ) VALUES ($1, $2, '전북대학교', '전주역', now() + interval '1 hour', 3,
         15000, 'OPEN', $3, NULL, NULL)`,
      [tripId, hostId, randomUUID()],
    )
    const participants = [[hostId, 'HOST'], [memberId, 'MEMBER'], [noShowId, 'MEMBER']] as const
    for (const [userId, role] of participants) {
      await client.query(
        `INSERT INTO trip_participants (trip_id, user_id, role, status, approval_idempotency_key)
         VALUES ($1, $2, $3, 'APPROVED', $4)`,
        [tripId, userId, role, randomUUID()],
      )
    }
    await client.query(
      `UPDATE trip_groups SET status = 'CLOSED', closed_at = now(), closure_type = 'HOST' WHERE trip_id = $1`,
      [tripId],
    )
    for (const [userId] of participants) {
      await client.query(
        `INSERT INTO trip_deposits (trip_id, user_id, amount) VALUES ($1, $2, 6000)`,
        [tripId, userId],
      )
      await client.query(
        `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
         VALUES ($1, 'DEPOSIT', -6000, 6000, $2, $3, 'E2E escrow deposit', $4)`,
        [userId, tripId, hostId, `${runId}:deposit:${userId}`],
      )
      await client.query(
        `UPDATE trip_participants SET status = 'DEPOSITED' WHERE trip_id = $1 AND user_id = $2`,
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
       ) VALUES ($1, $2, $3, $4, $5, 'E2E', 10000, 1200, 15000, 15000,
         'E2E fixture', 'E2E', '1', now(), now() + interval '1 day', $6, $7,
         '{"fixture":true}'::jsonb, $8)`,
      [fareEstimateId, tripId, location.rows[0].location_revision, `${runId}:route`, `${runId}:fare`, `${runId}:trace`, `${runId}:fingerprint`, randomUUID()],
    )
    await client.query(
      `UPDATE trip_groups SET current_fare_estimate_id = $2 WHERE trip_id = $1`,
      [tripId, fareEstimateId],
    )
    await client.query(`UPDATE trip_groups SET status = 'CONFIRMED' WHERE trip_id = $1`, [tripId])
    await client.query(
      `UPDATE trip_groups SET status = 'IN_PROGRESS', in_progress_at = now(), start_idempotency_key = $2
       WHERE trip_id = $1`,
      [tripId, randomUUID()],
    )
    await client.query(
      `UPDATE trip_participants SET status = 'CHECKED_IN', checked_in_at = now(), check_in_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, hostId, randomUUID()],
    )
    await client.query(
      `UPDATE trip_participants SET status = 'CHECKED_IN', checked_in_at = now(), check_in_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, memberId, randomUUID()],
    )
    await client.query(
      `UPDATE trip_participants SET status = 'NO_SHOW', no_show_at = now(), no_show_marked_by = $3, no_show_idempotency_key = $4
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, noShowId, hostId, randomUUID()],
    )
    await client.query(
      `INSERT INTO trip_settlements (
         trip_id, actual_fare, participant_count, final_share, submitted_by,
         fare_submission_idempotency_key, confirmation_deadline, cohort_basis
       ) VALUES ($1, 15000, 3, 5000, $2, $3, now() + interval '24 hours', 'ESCROW_CONFIRMED')`,
      [tripId, hostId, randomUUID()],
    )
    for (const userId of ids) {
      await client.query(
        `INSERT INTO trip_settlement_participants (trip_id, user_id, deposit_amount, final_share)
         VALUES ($1, $2, 6000, 5000)`,
        [tripId, userId],
      )
    }
    await client.query(`UPDATE trip_groups SET status = 'SETTLEMENT_PENDING' WHERE trip_id = $1`, [tripId])
    await client.query(
      `INSERT INTO fare_confirmations (trip_id, user_id, idempotency_key) VALUES ($1, $2, $3)`,
      [tripId, hostId, randomUUID()],
    )
    await client.query(
      `INSERT INTO fare_disputes (dispute_id, trip_id, user_id, reason, idempotency_key, fare_revision)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [disputeId, tripId, memberId, `${runId} actual fare dispute`, randomUUID()],
    )
    await client.query('COMMIT')
    return { runId, tripId, adminId, adminToken: token, disputeId, memberIds: ids }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

async function queryOne<T>(sql: string, values: unknown[]) {
  const pool = database()
  const client = await pool.connect()
  try {
    const result = await client.query(sql, values)
    return result.rows as T[]
  } finally {
    client.release()
    await pool.end()
  }
}

async function openAdmin(page: Page, fixture: Fixture) {
  await page.context().addCookies([{
    name: 'taxitashare_session', value: fixture.adminToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600,
  }])
  await page.goto('/admin/settlements')
  await expect(page.locator(`form:has(input[name="tripId"][value="${fixture.tripId}"])`)).toBeVisible()
}

function disputeForm(page: Page, tripId: string) {
  return page.locator(`form:has(input[name="tripId"][value="${tripId}"])`)
}

test('관리자가 이의를 기각하면 요금·원장·정산 제안은 유지된다', async ({ page }) => {
  const fixture = await seedPendingDispute()
  await openAdmin(page, fixture)
  const form = disputeForm(page, fixture.tripId)
  await form.locator('select[name="outcome"]').selectOption('REJECTED')
  await form.locator('textarea[name="resolutionNote"]').fill('영수증과 운행 정보를 검토했습니다.')
  await form.getByRole('button').click()
  await expect(form).toHaveCount(0, { timeout: 60_000 })
  const [dispute] = await queryOne<{ status: string; resolved_by_user_id: string }>(
    `SELECT status, resolved_by_user_id FROM fare_disputes WHERE dispute_id = $1`, [fixture.disputeId],
  )
  expect(dispute).toMatchObject({ status: 'REJECTED', resolved_by_user_id: fixture.adminId })
  const [settlement] = await queryOne<{ actual_fare: number; fare_revision: number; status: string }>(
    `SELECT actual_fare, fare_revision, status FROM trip_settlements WHERE trip_id = $1`, [fixture.tripId],
  )
  expect(settlement).toMatchObject({ actual_fare: 15000, fare_revision: 1, status: 'PENDING_CONFIRMATION' })
  expect(await queryOne(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')`, [fixture.tripId])).toHaveLength(0)
})

test('관리자 요금 수정은 새 확인 차수를 만들고 원장을 쓰지 않는다', async ({ page }) => {
  const fixture = await seedPendingDispute()
  await openAdmin(page, fixture)
  const form = disputeForm(page, fixture.tripId)
  await form.locator('select[name="outcome"]').selectOption('ADJUSTED')
  await form.locator('input[name="actualFare"]').fill('12001')
  await form.locator('textarea[name="resolutionNote"]').fill('영수증 금액으로 수정합니다.')
  await form.getByRole('button').click()
  await expect(form).toHaveCount(0, { timeout: 60_000 })
  const [settlement] = await queryOne<{ actual_fare: number; final_share: number; fare_revision: number; status: string; resubmission_required: boolean }>(
    `SELECT actual_fare, final_share, fare_revision, status, resubmission_required FROM trip_settlements WHERE trip_id = $1`, [fixture.tripId],
  )
  expect(settlement).toMatchObject({ actual_fare: 12001, final_share: 4001, fare_revision: 2, status: 'PENDING_CONFIRMATION', resubmission_required: false })
  expect(await queryOne(`SELECT command_id FROM admin_dispute_commands WHERE trip_id = $1 AND command_type = 'ADJUST_FARE'`, [fixture.tripId])).toHaveLength(1)
  expect(await queryOne(`SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')`, [fixture.tripId])).toHaveLength(0)
  expect(await queryOne(`SELECT user_id FROM trip_settlement_participants WHERE trip_id = $1`, [fixture.tripId])).toHaveLength(3)
})

test('관리자 강제 정산은 노쇼를 포함한 cohort를 한 번만 완료한다', async ({ page }) => {
  const fixture = await seedPendingDispute()
  await openAdmin(page, fixture)
  const form = disputeForm(page, fixture.tripId)
  await form.locator('select[name="outcome"]').selectOption('FORCE_SETTLE')
  await form.locator('textarea[name="resolutionNote"]').fill('마지막 이의를 검토해 현재 금액으로 정산합니다.')
  await form.getByRole('button').click()
  await expect(form).toHaveCount(0, { timeout: 60_000 })
  const [settlement] = await queryOne<{ status: string; settlement_mode: string; settled_by_user_id: string }>(
    `SELECT status, settlement_mode, settled_by_user_id FROM trip_settlements WHERE trip_id = $1`, [fixture.tripId],
  )
  expect(settlement).toMatchObject({ status: 'COMPLETED', settlement_mode: 'ADMIN_FORCE', settled_by_user_id: fixture.adminId })
  expect(await queryOne(`SELECT user_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'SETTLEMENT_CHARGE'`, [fixture.tripId])).toHaveLength(3)
  expect(await queryOne(`SELECT user_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'REFUND'`, [fixture.tripId])).toHaveLength(3)
  expect(await queryOne(`SELECT user_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'ADDITIONAL_DEBIT'`, [fixture.tripId])).toHaveLength(0)
  const participants = await queryOne<{ status: string }>(`SELECT status FROM trip_participants WHERE trip_id = $1`, [fixture.tripId])
  expect(participants).toHaveLength(3)
  expect(participants.every((participant) => participant.status === 'COMPLETED')).toBe(true)
})
