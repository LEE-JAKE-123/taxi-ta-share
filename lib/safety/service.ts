import 'server-only'

import { Pool, type PoolClient } from '@neondatabase/serverless'
import { CoreError } from '@/lib/core/service'
import { effectDueAccountSuspensions } from './suspension'
import {
  ensureDatabaseIdentity,
  getDatabase,
  getDatabaseUrl,
} from '@/lib/db/client'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const REPORT_REASONS = new Set([
  'SAFETY',
  'HARASSMENT',
  'NO_SHOW',
  'FRAUD',
  'OTHER',
])
const SUPPORT_CATEGORIES = new Set([
  'ACCOUNT',
  'MATCHING',
  'POINTS',
  'SAFETY',
  'OTHER',
])

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new CoreError(`${label} 식별자가 올바르지 않습니다.`)
  }
}

function normalizeText(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
) {
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new CoreError(`${label}은 ${minimum}~${maximum}자로 입력해주세요.`)
  }
  return normalized
}

async function inSafetyTransaction<T>(
  run: (client: PoolClient) => Promise<T>,
) {
  await ensureDatabaseIdentity()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pool = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
      await client.query(`SET LOCAL lock_timeout = '5s'`)
      await client.query(`SET LOCAL statement_timeout = '15s'`)
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : ''
      if (attempt >= 2 || !['40001', '40P01'].includes(code)) throw error
    } finally {
      client.release()
      await pool.end()
    }
  }
  throw new CoreError('동시 요청을 처리하지 못했습니다. 다시 시도해주세요.')
}

async function requireActiveUser(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT user_id FROM users
     WHERE user_id = $1 AND account_status = 'ACTIVE'
     FOR UPDATE`,
    [userId],
  )
  if (!result.rowCount) throw new CoreError('활성 사용자만 요청할 수 있습니다.')
}

async function requireActiveAdmin(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT user_id FROM users
     WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
     FOR UPDATE`,
    [userId],
  )
  if (!result.rowCount) throw new CoreError('활성 관리자 권한이 필요합니다.')
}

export async function submitUserReport(input: {
  reporterId: string
  reportedUserId?: string | null
  tripId?: string | null
  reasonCode: string
  description: string
  evidenceRef?: string | null
  idempotencyKey: string
}) {
  assertUuid(input.reporterId, '신고자')
  assertUuid(input.idempotencyKey, '요청')
  const reportedUserId = input.reportedUserId?.trim() || null
  const tripId = input.tripId?.trim() || null
  if ((reportedUserId === null) === (tripId === null)) {
    throw new CoreError('신고 대상 사용자 또는 모집을 하나만 선택해주세요.')
  }
  if (reportedUserId) {
    assertUuid(reportedUserId, '신고 대상')
    if (reportedUserId === input.reporterId) {
      throw new CoreError('본인을 신고할 수 없습니다.')
    }
  }
  if (tripId) assertUuid(tripId, '모집')
  if (!REPORT_REASONS.has(input.reasonCode)) {
    throw new CoreError('신고 사유를 선택해주세요.')
  }
  const description = normalizeText(input.description, '신고 내용', 10, 2000)
  const evidenceRef = input.evidenceRef?.trim() || null
  if (evidenceRef && evidenceRef.length > 2000) {
    throw new CoreError('증빙 설명은 2,000자 이하로 입력해주세요.')
  }

  return inSafetyTransaction(async (client) => {
    await requireActiveUser(client, input.reporterId)
    const replay = await client.query(
      `SELECT report_id, reported_user_id, trip_id, reason_code, description,
              evidence_ref
       FROM user_reports
       WHERE reporter_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.reporterId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (
        existing.reported_user_id === reportedUserId &&
        existing.trip_id === tripId &&
        existing.reason_code === input.reasonCode &&
        existing.description === description &&
        existing.evidence_ref === evidenceRef
      ) {
        return existing.report_id as string
      }
      throw new CoreError('같은 요청 식별자가 다른 신고에 사용되었습니다.')
    }
    if (reportedUserId) {
      const target = await client.query(
        `SELECT user_id FROM users
         WHERE user_id = $1 AND role = 'USER'
         FOR SHARE`,
        [reportedUserId],
      )
      if (!target.rowCount) throw new CoreError('신고 대상을 찾을 수 없습니다.')
    }
    if (tripId) {
      const target = await client.query(
        `SELECT trip_id FROM trip_groups WHERE trip_id = $1 FOR SHARE`,
        [tripId],
      )
      if (!target.rowCount) throw new CoreError('신고할 모집을 찾을 수 없습니다.')
    }
    const created = await client.query(
      `INSERT INTO user_reports (
         reporter_user_id, reported_user_id, trip_id, reason_code,
         description, evidence_ref, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING report_id`,
      [
        input.reporterId,
        reportedUserId,
        tripId,
        input.reasonCode,
        description,
        evidenceRef,
        input.idempotencyKey,
      ],
    )
    return created.rows[0].report_id as string
  })
}

export async function blockUser(input: {
  blockerId: string
  blockedUserId: string
  idempotencyKey: string
}) {
  assertUuid(input.blockerId, '차단자')
  assertUuid(input.blockedUserId, '차단 대상')
  assertUuid(input.idempotencyKey, '요청')
  if (input.blockerId === input.blockedUserId) {
    throw new CoreError('본인을 차단할 수 없습니다.')
  }
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const replay = await sql`
    SELECT blocked_user_id AS "blockedUserId"
    FROM user_blocks
    WHERE blocker_user_id = ${input.blockerId}
      AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `
  const replayed = replay[0] as { blockedUserId: string } | undefined
  if (replayed) {
    if (replayed.blockedUserId === input.blockedUserId) return
    throw new CoreError('같은 요청 식별자가 다른 차단에 사용되었습니다.')
  }
  const users = await sql`
    SELECT user_id AS "userId", account_status AS "accountStatus"
    FROM users
    WHERE user_id = ${input.blockerId} OR user_id = ${input.blockedUserId}
  `
  if (users.length !== 2) throw new CoreError('차단 대상을 찾을 수 없습니다.')
  const blocker = users.find(
    (user) => (user as { userId: string }).userId === input.blockerId,
  ) as { accountStatus: string } | undefined
  if (blocker?.accountStatus !== 'ACTIVE') {
    throw new CoreError('활성 사용자만 차단할 수 있습니다.')
  }
  await sql`
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id, idempotency_key)
    VALUES (${input.blockerId}, ${input.blockedUserId}, ${input.idempotencyKey})
    ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
  `
}

export async function submitSupportTicket(input: {
  requesterId: string
  category: string
  subject: string
  body: string
  idempotencyKey: string
}) {
  assertUuid(input.requesterId, '문의자')
  assertUuid(input.idempotencyKey, '요청')
  if (!SUPPORT_CATEGORIES.has(input.category)) {
    throw new CoreError('문의 유형을 선택해주세요.')
  }
  const subject = normalizeText(input.subject, '문의 제목', 2, 120)
  const body = normalizeText(input.body, '문의 내용', 10, 2000)
  return inSafetyTransaction(async (client) => {
    await requireActiveUser(client, input.requesterId)
    const replay = await client.query(
      `SELECT ticket_id, category, subject, body FROM support_tickets
       WHERE requester_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.requesterId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (
        existing.category === input.category &&
        existing.subject === subject &&
        existing.body === body
      ) return existing.ticket_id as string
      throw new CoreError('같은 요청 식별자가 다른 문의에 사용되었습니다.')
    }
    const created = await client.query(
      `INSERT INTO support_tickets (
         requester_user_id, category, subject, body, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING ticket_id`,
      [input.requesterId, input.category, subject, body, input.idempotencyKey],
    )
    return created.rows[0].ticket_id as string
  })
}

export async function resolveUserReport(input: {
  adminId: string
  reportId: string
  outcome: 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED' | 'SUSPENDED'
  resolutionNote: string
  idempotencyKey: string
}) {
  assertUuid(input.adminId, '관리자')
  assertUuid(input.reportId, '신고')
  assertUuid(input.idempotencyKey, '요청')
  const note = normalizeText(input.resolutionNote, '처리 메모', 1, 1000)
  return inSafetyTransaction(async (client) => {
    await requireActiveAdmin(client, input.adminId)
    const replay = await client.query(
      `SELECT report_id, action_type, resolution_note FROM report_review_actions
       WHERE admin_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    const actionType =
      input.outcome === 'IN_REVIEW'
        ? 'START_REVIEW'
        : input.outcome === 'RESOLVED'
          ? 'RESOLVE'
          : input.outcome === 'DISMISSED'
            ? 'DISMISS'
            : 'SUSPEND_USER'
    if (replay.rowCount) {
      const action = replay.rows[0]
      if (
        action.report_id === input.reportId &&
        action.action_type === actionType &&
        action.resolution_note === note
      ) return
      throw new CoreError('같은 요청 식별자가 다른 신고 처리에 사용되었습니다.')
    }
    const report = await client.query(
      `SELECT report_id, reported_user_id, reason_code, status
       FROM user_reports WHERE report_id = $1 FOR UPDATE`,
      [input.reportId],
    )
    const row = report.rows[0]
    if (!row) throw new CoreError('신고를 찾을 수 없습니다.')
    if (['RESOLVED', 'DISMISSED'].includes(row.status)) {
      throw new CoreError('이미 처리된 신고입니다.')
    }
    if (input.outcome === 'IN_REVIEW' && row.status !== 'SUBMITTED') {
      throw new CoreError('접수된 신고만 검토로 전환할 수 있습니다.')
    }
    if (input.outcome === 'SUSPENDED' && !row.reported_user_id) {
      throw new CoreError('모집 신고로는 사용자 이용 정지를 처리할 수 없습니다.')
    }
    if (input.outcome === 'SUSPENDED' && row.reason_code === 'NO_SHOW') {
      throw new CoreError(
        '노쇼 신고는 사건 검토와 반박 절차를 거쳐 처리해야 하므로 즉시 이용 정지할 수 없습니다.',
      )
    }
    if (input.outcome === 'SUSPENDED') {
      const target = await client.query(
        `SELECT user_id, role, account_status
         FROM users
         WHERE user_id = $1
         FOR UPDATE`,
        [row.reported_user_id],
      )
      const targetRow = target.rows[0]
      if (
        !targetRow ||
        targetRow.role !== 'USER' ||
        targetRow.account_status !== 'ACTIVE'
      ) {
        throw new CoreError(
          '활성 상태인 일반 사용자 계정만 즉시 이용 정지할 수 있습니다.',
        )
      }
    }
    const review = await client.query(
      `INSERT INTO report_review_actions (
         report_id, admin_user_id, action_type, resolution_note, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING action_id`,
      [input.reportId, input.adminId, actionType, note, input.idempotencyKey],
    )
    if (input.outcome === 'SUSPENDED') {
      await client.query(
        `INSERT INTO account_suspension_requests (
           target_user_id, requested_by_admin_id, source_type, report_id,
           report_review_action_id, reason, idempotency_key
         ) VALUES ($1, $2, 'REPORT', $3, $4, $5, $6)`,
        [
          row.reported_user_id,
          input.adminId,
          input.reportId,
          review.rows[0].action_id,
          note,
          input.idempotencyKey,
        ],
      )
      await effectDueAccountSuspensions(client, row.reported_user_id)
    }
    const status =
      input.outcome === 'IN_REVIEW'
        ? 'IN_REVIEW'
        : input.outcome === 'DISMISSED'
          ? 'DISMISSED'
          : 'RESOLVED'
    await client.query(
      `UPDATE user_reports
       SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(),
           resolution_note = CASE WHEN $2 = 'IN_REVIEW' THEN NULL ELSE $4 END
       WHERE report_id = $1`,
      [input.reportId, status, input.adminId, note],
    )
  })
}

export async function resolveSupportTicket(input: {
  adminId: string
  ticketId: string
  outcome: 'IN_REVIEW' | 'ANSWERED' | 'CLOSED'
  resolutionNote: string
  idempotencyKey: string
}) {
  assertUuid(input.adminId, '관리자')
  assertUuid(input.ticketId, '문의')
  assertUuid(input.idempotencyKey, '요청')
  const note = normalizeText(input.resolutionNote, '처리 메모', 1, 1000)
  return inSafetyTransaction(async (client) => {
    await requireActiveAdmin(client, input.adminId)
    const actionType =
      input.outcome === 'IN_REVIEW'
        ? 'START_REVIEW'
        : input.outcome === 'ANSWERED'
          ? 'ANSWER'
          : 'CLOSE'
    const replay = await client.query(
      `SELECT ticket_id, action_type, resolution_note FROM support_ticket_actions
       WHERE admin_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const action = replay.rows[0]
      if (
        action.ticket_id === input.ticketId &&
        action.action_type === actionType &&
        action.resolution_note === note
      ) return
      throw new CoreError('같은 요청 식별자가 다른 문의 처리에 사용되었습니다.')
    }
    const ticket = await client.query(
      `SELECT ticket_id, status FROM support_tickets
       WHERE ticket_id = $1 FOR UPDATE`,
      [input.ticketId],
    )
    const row = ticket.rows[0]
    if (!row) throw new CoreError('문의를 찾을 수 없습니다.')
    if (['ANSWERED', 'CLOSED'].includes(row.status)) {
      throw new CoreError('이미 처리된 문의입니다.')
    }
    if (input.outcome === 'IN_REVIEW' && row.status !== 'SUBMITTED') {
      throw new CoreError('접수된 문의만 검토로 전환할 수 있습니다.')
    }
    await client.query(
      `INSERT INTO support_ticket_actions (
         ticket_id, admin_user_id, action_type, resolution_note, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5)`,
      [input.ticketId, input.adminId, actionType, note, input.idempotencyKey],
    )
    await client.query(
      `UPDATE support_tickets
       SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(),
           resolution_note = CASE WHEN $2 = 'IN_REVIEW' THEN NULL ELSE $4 END
       WHERE ticket_id = $1`,
      [input.ticketId, input.outcome, input.adminId, note],
    )
  })
}
