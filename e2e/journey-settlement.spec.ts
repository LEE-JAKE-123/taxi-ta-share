import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'

type JourneyFixture = {
  tripId: string
  hostId: string
  memberId: string
  noShowId: string
  hostToken: string
  memberToken: string
  noShowToken: string
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function seedConfirmedJourney(): Promise<JourneyFixture> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-journey-${randomUUID()}`
  const adminId = randomUUID()
  const hostId = randomUUID()
  const memberId = randomUUID()
  const noShowId = randomUUID()
  const tripId = randomUUID()
  const hostToken = randomBytes(32).toString('base64url')
  const memberToken = randomBytes(32).toString('base64url')
  const noShowToken = randomBytes(32).toString('base64url')
  const participantIds = [hostId, memberId, noShowId]

  try {
    await client.query('BEGIN')
    const people = [
      [adminId, 'ADMIN', 'E2E Admin'],
      [hostId, 'USER', 'E2E Host'],
      [memberId, 'USER', 'E2E Member'],
      [noShowId, 'USER', 'E2E No Show'],
    ] as const
    for (let index = 0; index < people.length; index += 1) {
      const [userId, role, name] = people[index]
      await client.query(
        `INSERT INTO users (user_id, signup_attempt_id, student_id, name, gender, school_email, role, account_status)
         VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [
          userId,
          randomUUID(),
          `8${Date.now().toString().slice(-7)}${index}`,
          `${runId}-${name}`,
          `${runId}-${index}@jbnu.ac.kr`,
          role,
        ],
      )
    }
    for (const [userId, token] of [
      [hostId, hostToken],
      [memberId, memberToken],
      [noShowId, noShowToken],
    ] as const) {
      await client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [userId, createHash('sha256').update(token).digest('hex')],
      )
    }
    for (const userId of participantIds) {
      await client.query(
        `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
         VALUES ($1, 'ADMIN_GRANT', 7500, 0, NULL, $2, 'E2E journey grant', $3)`,
        [userId, adminId, `${runId}:grant:${userId}`],
      )
    }
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at, max_participants,
         estimated_fare, status, creation_idempotency_key, closed_at, closure_type
       ) VALUES ($1, $2, 'E2E Origin', 'E2E Destination', now() + interval '1 hour', 3,
         15000, 'OPEN', $3, NULL, NULL)`,
      [tripId, hostId, randomUUID()],
    )
    for (const [userId, role] of [[hostId, 'HOST'], [memberId, 'MEMBER'], [noShowId, 'MEMBER']] as const) {
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
    for (const userId of participantIds) {
      await client.query(
        `INSERT INTO trip_deposits (trip_id, user_id, amount) VALUES ($1, $2, 5000)`,
        [tripId, userId],
      )
      await client.query(
        `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
         VALUES ($1, 'DEPOSIT', -5000, 5000, $2, $3, 'E2E journey deposit', $4)`,
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
      `UPDATE trip_groups SET current_fare_estimate_id = $2, status = 'CONFIRMED' WHERE trip_id = $1`,
      [tripId, fareEstimateId],
    )
    await client.query('COMMIT')
    return {
      tripId,
      hostId,
      memberId,
      noShowId,
      hostToken,
      memberToken,
      noShowToken,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

async function pageForUser(browser: Browser, token: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  await context.addCookies([{
    name: 'taxitashare_session',
    value: token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 3600,
  }])
  return { context, page: await context.newPage() }
}

async function queryRows<T>(sql: string, values: unknown[]) {
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

test('확정·예치 cohort는 브라우저 여정에서 체크인·노쇼 상태를 보존한다', async ({ browser }) => {
  test.setTimeout(120_000)
  const fixture = await seedConfirmedJourney()
  const host = await pageForUser(browser, fixture.hostToken)
  const member = await pageForUser(browser, fixture.memberToken)
  const noShow = await pageForUser(browser, fixture.noShowToken)

  try {
    await host.page.goto(`/room/${fixture.tripId}`)
    const startForm = host.page.locator(`form:has(input[name="tripId"][value="${fixture.tripId}"]):has(button:has-text("출발"))`)
    await startForm.getByRole('button').click()
    await expect(startForm).toHaveCount(0, { timeout: 30_000 })

    await member.page.goto(`/room/${fixture.tripId}/gathering`)
    const memberCheckInForm = member.page.locator('form:has(input[name="tripId"]):not(:has(input[name="participantId"]))')
    await memberCheckInForm.getByRole('button').click()
    await expect(memberCheckInForm).toHaveCount(0, { timeout: 30_000 })

    await host.page.goto(`/room/${fixture.tripId}/gathering`)
    const checkInForm = host.page.locator('form:has(input[name="tripId"]):not(:has(input[name="participantId"]))')
    await checkInForm.getByRole('button').click()
    await expect(checkInForm).toHaveCount(0, { timeout: 30_000 })
    const noShowForm = host.page.locator('form').filter({ has: host.page.locator(`input[name="participantId"][value="${fixture.noShowId}"]`) })
    await noShowForm.getByRole('button').click()
    await expect(noShowForm).toHaveCount(0, { timeout: 30_000 })

    const [trip] = await queryRows<{ status: string }>(
      `SELECT status FROM trip_groups WHERE trip_id = $1`,
      [fixture.tripId],
    )
    expect(trip).toMatchObject({ status: 'IN_PROGRESS' })
    const participants = await queryRows<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM trip_participants WHERE trip_id = $1 ORDER BY user_id`,
      [fixture.tripId],
    )
    expect(participants).toHaveLength(3)
    expect(participants).toEqual(expect.arrayContaining([
      { user_id: fixture.hostId, status: 'CHECKED_IN' },
      { user_id: fixture.memberId, status: 'CHECKED_IN' },
      { user_id: fixture.noShowId, status: 'NO_SHOW' },
    ]))
    expect(await queryRows(
      `SELECT trip_id FROM trip_deposits WHERE trip_id = $1`,
      [fixture.tripId],
    )).toHaveLength(3)
    expect(await queryRows(
      `SELECT ledger_id FROM point_ledger WHERE trip_id = $1 AND entry_type = 'DEPOSIT'`,
      [fixture.tripId],
    )).toHaveLength(3)
    expect(await queryRows(
      `SELECT trip_id FROM trip_settlements WHERE trip_id = $1`,
      [fixture.tripId],
    )).toHaveLength(0)
    expect(await queryRows(
      `SELECT user_id, available_points, held_points FROM point_accounts WHERE user_id = ANY($1::uuid[]) AND (available_points <> 2500 OR held_points <> 5000)`,
      [[fixture.hostId, fixture.memberId, fixture.noShowId]],
    )).toHaveLength(0)

    // Submit a lower actual fare through the host UI. This inserts the host's
    // confirmation, while the checked-in member and no-show confirm separately.
    await host.page.goto(`/room/${fixture.tripId}`)
    const openFareModal = host.page.getByRole('button', { name: '도착' })
    await openFareModal.click()
    const fareForm = host.page.locator('form').filter({
      has: host.page.locator('input[name="actualFare"]'),
    })
    await fareForm.locator('input[name="actualFare"]').fill('12000')
    await fareForm.getByRole('button', { name: '실제 요금 제출' }).click()
    await expect(host.page).toHaveURL(new RegExp(`/room/${fixture.tripId}/settle`), {
      timeout: 30_000,
    })
    await expect(host.page.getByText('12,000P')).toBeVisible()

    const [submitted] = await queryRows<{
      status: string
      actual_fare: number
      participant_count: number
      final_share: number
      submitted_by: string
    }>(
      `SELECT status, actual_fare, participant_count, final_share, submitted_by
       FROM trip_settlements WHERE trip_id = $1`,
      [fixture.tripId],
    )
    expect(submitted).toEqual({
      status: 'PENDING_CONFIRMATION',
      actual_fare: 12000,
      participant_count: 3,
      final_share: 4000,
      submitted_by: fixture.hostId,
    })
    expect(await queryRows(
      `SELECT user_id FROM fare_confirmations WHERE trip_id = $1`,
      [fixture.tripId],
    )).toEqual([{ user_id: fixture.hostId }])
    expect(await queryRows(
      `SELECT user_id, deposit_amount, final_share
       FROM trip_settlement_participants WHERE trip_id = $1 ORDER BY user_id`,
      [fixture.tripId],
    )).toEqual(expect.arrayContaining([
      { user_id: fixture.hostId, deposit_amount: 5000, final_share: 4000 },
      { user_id: fixture.memberId, deposit_amount: 5000, final_share: 4000 },
      { user_id: fixture.noShowId, deposit_amount: 5000, final_share: 4000 },
    ]))

    for (const participant of [member, noShow]) {
      await participant.page.goto(`/room/${fixture.tripId}/settle`)
      const confirmFare = participant.page.getByRole('button', {
        name: '실제 요금에 동의',
      })
      await expect(confirmFare).toHaveCount(1)
      await confirmFare.click()
      await expect(confirmFare).toHaveCount(0, { timeout: 30_000 })
    }

    expect(await queryRows(
      `SELECT user_id FROM fare_confirmations WHERE trip_id = $1 ORDER BY user_id`,
      [fixture.tripId],
    )).toEqual([
      fixture.hostId,
      fixture.memberId,
      fixture.noShowId,
    ].sort().map((user_id) => ({ user_id })))

    await host.page.goto(`/room/${fixture.tripId}/settle`)
    const settleTrip = host.page.getByRole('button', { name: '최종 정산 실행' })
    await expect(settleTrip).toHaveCount(1)
    await settleTrip.click()
    await expect(host.page).toHaveURL(
      new RegExp(`/room/${fixture.tripId}/settle/complete`),
      { timeout: 30_000 },
    )
    await expect(host.page.getByText('12,000P')).toBeVisible()
    await expect(host.page.getByText('4,000P', { exact: true })).toBeVisible()

    const [completed] = await queryRows<{
      status: string
      settlement_mode: string
      settled_by_user_id: string
    }>(
      `SELECT status, settlement_mode, settled_by_user_id
       FROM trip_settlements WHERE trip_id = $1`,
      [fixture.tripId],
    )
    expect(completed).toEqual({
      status: 'COMPLETED',
      settlement_mode: 'HOST',
      settled_by_user_id: fixture.hostId,
    })
    expect(await queryRows(
      `SELECT status FROM trip_groups WHERE trip_id = $1`,
      [fixture.tripId],
    )).toEqual([{ status: 'COMPLETED' }])
    expect(await queryRows(
      `SELECT user_id, status FROM trip_participants WHERE trip_id = $1 ORDER BY user_id`,
      [fixture.tripId],
    )).toEqual([
      fixture.hostId,
      fixture.memberId,
      fixture.noShowId,
    ].sort().map((user_id) => ({ user_id, status: 'COMPLETED' })))
    expect(await queryRows(
      `SELECT user_id, entry_type, available_delta, held_delta
       FROM point_ledger
       WHERE trip_id = $1 AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
       ORDER BY user_id, entry_type`,
      [fixture.tripId],
    )).toEqual([
      fixture.hostId,
      fixture.memberId,
      fixture.noShowId,
    ].sort().flatMap((user_id) => [
      { user_id, entry_type: 'REFUND', available_delta: 1000, held_delta: -1000 },
      { user_id, entry_type: 'SETTLEMENT_CHARGE', available_delta: 0, held_delta: -4000 },
    ]))
    expect(await queryRows(
      `SELECT user_id,
              available_points::integer AS available_points,
              held_points::integer AS held_points
       FROM point_accounts WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
      [[fixture.hostId, fixture.memberId, fixture.noShowId]],
    )).toEqual([
      fixture.hostId,
      fixture.memberId,
      fixture.noShowId,
    ].sort().map((user_id) => ({ user_id, available_points: 3500, held_points: 0 })))
  } finally {
    await host.context.close()
    await member.context.close()
    await noShow.context.close()
  }
})
