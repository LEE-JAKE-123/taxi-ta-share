import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from '@neondatabase/serverless'

type Fixture = {
  adminId: string
  adminToken: string
  reporterId: string
  reporterToken: string
  reportedId: string
  reportedToken: string
  tripId: string
}

function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for E2E tests.')
  return new Pool({ connectionString, max: 1 })
}

async function seedSafetyFixture(): Promise<Fixture> {
  const pool = database()
  const client = await pool.connect()
  const runId = `e2e-safety-${randomUUID()}`
  const adminId = randomUUID()
  const reporterId = randomUUID()
  const reportedId = randomUUID()
  const tripId = randomUUID()
  const adminToken = randomBytes(32).toString('base64url')
  const reporterToken = randomBytes(32).toString('base64url')
  const reportedToken = randomBytes(32).toString('base64url')
  try {
    await client.query('BEGIN')
    const people = [
      [adminId, 'ADMIN', 'Safety Admin', adminToken],
      [reporterId, 'USER', 'Safety Reporter', reporterToken],
      [reportedId, 'USER', 'Safety Host', reportedToken],
    ] as const
    for (let index = 0; index < people.length; index += 1) {
      const [userId, role, name, token] = people[index]
      await client.query(
        `INSERT INTO users (user_id, signup_attempt_id, student_id, name, gender, school_email, role, account_status)
         VALUES ($1, $2, $3, $4, 'female', $5, $6, 'ACTIVE')`,
        [
          userId,
          randomUUID(),
          `7${Date.now().toString().slice(-7)}${index}`,
          `${runId}-${name}`,
          `${runId}-${index}@jbnu.ac.kr`,
          role,
        ],
      )
      await client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [userId, createHash('sha256').update(token).digest('hex')],
      )
    }
    await client.query(
      `INSERT INTO trip_groups (
         trip_id, host_user_id, origin, destination, departure_at, max_participants,
         estimated_fare, status, creation_idempotency_key, closed_at, closure_type
       ) VALUES ($1, $2, 'Safety Origin', 'Safety Destination', now() + interval '1 hour', 2,
         10000, 'OPEN', $3, NULL, NULL)`,
      [tripId, reportedId, randomUUID()],
    )
    await client.query(
      `INSERT INTO trip_participants (trip_id, user_id, role, status, approval_idempotency_key)
       VALUES ($1, $2, 'HOST', 'APPROVED', $3)`,
      [tripId, reportedId, randomUUID()],
    )
    await client.query('COMMIT')
    return {
      adminId,
      adminToken,
      reporterId,
      reporterToken,
      reportedId,
      reportedToken,
      tripId,
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

test('사용자 신고는 대상에게 노출되지 않는 운영 큐에 저장된다', async ({ browser }) => {
  test.setTimeout(180_000)
  const fixture = await seedSafetyFixture()
  const reporter = await pageForUser(browser, fixture.reporterToken)
  try {
    await reporter.page.goto(`/room/${fixture.tripId}`)
    const safetyDetails = reporter.page.locator('details').filter({
      has: reporter.page.locator(`input[name="reportedUserId"][value="${fixture.reportedId}"]`),
    })
    await safetyDetails.locator('summary').click()
    const reportForm = reporter.page.locator('form').filter({
      has: reporter.page.locator(`input[name="reportedUserId"][value="${fixture.reportedId}"]`),
    })
    await reportForm.locator('select[name="reasonCode"]').selectOption('SAFETY')
    await reportForm.locator('textarea[name="description"]').fill('집결 및 이동 안전에 대한 구체적인 우려가 있습니다.')
    await reportForm.getByRole('button', { name: '신고 접수' }).click()
    await expect(reporter.page.getByRole('status')).toContainText('신고가 접수되었습니다')
    const [report] = await queryRows<{ report_id: string; status: string; reporter_user_id: string; reported_user_id: string }>(
      `SELECT report_id, status, reporter_user_id, reported_user_id
       FROM user_reports WHERE reporter_user_id = $1`,
      [fixture.reporterId],
    )
    expect(report).toMatchObject({
      status: 'SUBMITTED',
      reporter_user_id: fixture.reporterId,
      reported_user_id: fixture.reportedId,
    })
  } finally {
    await reporter.context.close().catch(() => undefined)
  }
})

test('차단은 신규 참여를 DB 수준에서 막고 방 목록으로 돌아간다', async ({ browser }) => {
  test.setTimeout(180_000)
  const fixture = await seedSafetyFixture()
  const reporter = await pageForUser(browser, fixture.reporterToken)
  try {
    await reporter.page.goto(`/room/${fixture.tripId}`)
    await reporter.page.locator('details').filter({
      has: reporter.page.locator(`input[name="blockedUserId"][value="${fixture.reportedId}"]`),
    }).locator('summary').click()
    const blockForm = reporter.page.locator('form').filter({
      has: reporter.page.locator(`input[name="blockedUserId"][value="${fixture.reportedId}"]`),
    })
    await blockForm.getByRole('button', { name: '차단하기' }).click()
    await expect(reporter.page).toHaveURL(/\/home\?message=/)
    expect(await queryRows(
      `SELECT blocker_user_id FROM user_blocks
       WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
      [fixture.reporterId, fixture.reportedId],
    )).toHaveLength(1)
    await expect(queryRows(
      `INSERT INTO trip_participants (trip_id, user_id, role, status, application_idempotency_key)
       VALUES ($1, $2, 'MEMBER', 'APPLIED', $3)`,
      [fixture.tripId, fixture.reporterId, randomUUID()],
    )).rejects.toThrow()
  } finally {
    await reporter.context.close().catch(() => undefined)
  }
})

test('관리자 이용 정지는 신고·조치 감사 기록과 세션 해제를 함께 남긴다', async ({ browser }) => {
  test.setTimeout(180_000)
  const fixture = await seedSafetyFixture()
  const admin = await pageForUser(browser, fixture.adminToken)
  try {
    const reportId = randomUUID()
    const suspendedUserId = randomUUID()
    const suspendedToken = randomBytes(32).toString('base64url')
    await queryRows(
      `INSERT INTO users (
         user_id, signup_attempt_id, student_id, name, gender, school_email, role, account_status
       ) VALUES ($1, $2, $3, $4, 'female', $5, 'USER', 'ACTIVE')`,
      [
        suspendedUserId,
        randomUUID(),
        `6${Date.now().toString().slice(-7)}9`,
        `e2e-safety-suspension-${randomUUID()}`,
        `e2e-safety-suspension-${randomUUID()}@jbnu.ac.kr`,
      ],
    )
    await queryRows(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [suspendedUserId, createHash('sha256').update(suspendedToken).digest('hex')],
    )
    await queryRows(
      `INSERT INTO user_reports (
         report_id, reporter_user_id, reported_user_id, reason_code, description, idempotency_key
       ) VALUES ($1, $2, $3, 'SAFETY', '운영자 이용 정지 E2E 신고 내용입니다.', $4)`,
      [reportId, fixture.reporterId, suspendedUserId, randomUUID()],
    )
    await admin.page.goto('/admin/reports')
    const reviewForm = admin.page.locator('form').filter({
      has: admin.page.locator(`input[name="reportId"][value="${reportId}"]`),
    })
    await reviewForm.locator('select[name="outcome"]').selectOption('SUSPENDED')
    await reviewForm.locator('textarea[name="resolutionNote"]').fill('운영 검토 결과 이용 정지가 필요합니다.')
    await reviewForm.getByRole('button', { name: '신고 처리 저장' }).click()
    await expect(reviewForm).toHaveCount(0, { timeout: 30_000 })
    const [user] = await queryRows<{ account_status: string }>(
      `SELECT account_status FROM users WHERE user_id = $1`,
      [suspendedUserId],
    )
    expect(user.account_status).toBe('SUSPENDED')
    expect(await queryRows(
      `SELECT action_id FROM report_review_actions
       WHERE report_id = $1 AND action_type = 'SUSPEND_USER'`,
      [reportId],
    )).toHaveLength(1)
    expect(await queryRows(
      `SELECT action_id FROM user_enforcement_actions
       WHERE report_id = $1 AND user_id = $2`,
      [reportId, suspendedUserId],
    )).toHaveLength(1)
    const [session] = await queryRows<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM auth_sessions WHERE user_id = $1`,
      [suspendedUserId],
    )
    expect(session.revoked_at).not.toBeNull()
  } finally {
    await admin.context.close().catch(() => undefined)
  }
})
