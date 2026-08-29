import 'server-only'

import { Pool, type PoolClient } from '@neondatabase/serverless'
import { ensureDatabaseIdentity, getDatabase } from '@/lib/db/client'
import { getDatabaseUrl } from '@/lib/db/client'
import { CoreError } from '@/lib/core/service'
import { effectDueAccountSuspensions } from '../safety/suspension'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const ADMIN_USER_STATUS_FILTERS = [
  'ALL',
  'ACTIVE',
  'SUSPENDED',
  'DELETED',
] as const

export type AdminUserStatusFilter = (typeof ADMIN_USER_STATUS_FILTERS)[number]

export function normalizeAdminUserStatusFilter(
  value?: string | null,
): AdminUserStatusFilter {
  return ADMIN_USER_STATUS_FILTERS.includes(value as AdminUserStatusFilter)
    ? (value as AdminUserStatusFilter)
    : 'ALL'
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new CoreError(`${label} 식별자가 올바르지 않습니다.`)
  }
}

function normalizeReason(value: string) {
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > 1000) {
    throw new CoreError('비활성화 사유는 1~1,000자로 입력해주세요.')
  }
  return normalized
}

export const ADMIN_USAGE_METRICS = [
  'TRIP_CREATED',
  'POINT_GRANT_REQUESTED',
  'FARE_DISPUTE_SUBMITTED',
  'SETTLEMENT_SUBMITTED',
] as const

export const ADMIN_USAGE_PERIODS = ['24h', '7d', '30d'] as const

export const ADMIN_USAGE_GRANULARITIES = ['minute', 'hour', 'day'] as const

export type AdminUsageMetric = (typeof ADMIN_USAGE_METRICS)[number]
export type AdminUsagePeriod = (typeof ADMIN_USAGE_PERIODS)[number]
export type AdminUsageGranularity = (typeof ADMIN_USAGE_GRANULARITIES)[number]

export type AdminUsageSeriesPoint = {
  bucketStart: string
  count: number
}

const USAGE_GRANULARITIES_BY_PERIOD: Record<
  AdminUsagePeriod,
  readonly AdminUsageGranularity[]
> = {
  '24h': ['minute', 'hour'],
  '7d': ['hour', 'day'],
  '30d': ['day'],
}

const USAGE_PERIOD_MS: Record<AdminUsagePeriod, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

const USAGE_INTERVALS: Record<AdminUsageGranularity, string> = {
  minute: '15 minutes',
  hour: '1 hour',
  day: '1 day',
}

export function normalizeAdminUsageSelection(input: {
  metric?: string | null
  period?: string | null
  granularity?: string | null
}): {
  metric: AdminUsageMetric
  period: AdminUsagePeriod
  granularity: AdminUsageGranularity
  wasCanonicalized: boolean
} {
  const metric = ADMIN_USAGE_METRICS.includes(input.metric as AdminUsageMetric)
    ? (input.metric as AdminUsageMetric)
    : 'TRIP_CREATED'
  const period = ADMIN_USAGE_PERIODS.includes(input.period as AdminUsagePeriod)
    ? (input.period as AdminUsagePeriod)
    : '24h'
  const allowedGranularities = USAGE_GRANULARITIES_BY_PERIOD[period]
  const granularity = allowedGranularities.includes(
    input.granularity as AdminUsageGranularity,
  )
    ? (input.granularity as AdminUsageGranularity)
    : allowedGranularities[0]

  return {
    metric,
    period,
    granularity,
    wasCanonicalized:
      (input.metric != null && metric !== input.metric) ||
      (input.period != null && period !== input.period) ||
      (input.granularity != null && granularity !== input.granularity),
  }
}

function usageWindow(period: AdminUsagePeriod, granularity: AdminUsageGranularity) {
  const now = new Date()
  const bucketStart = new Date(now)

  if (granularity === 'minute') {
    bucketStart.setUTCMinutes(Math.floor(bucketStart.getUTCMinutes() / 15) * 15, 0, 0)
  } else if (granularity === 'hour') {
    bucketStart.setUTCMinutes(0, 0, 0)
  } else {
    // Korea does not observe daylight saving time. Align day buckets to midnight
    // in the dashboard's displayed timezone instead of UTC midnight (09:00 KST).
    const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    bucketStart.setTime(
      Date.UTC(
        koreaTime.getUTCFullYear(),
        koreaTime.getUTCMonth(),
        koreaTime.getUTCDate(),
      ) -
        9 * 60 * 60 * 1000,
    )
  }

  const endAt = advanceUsageBucket(bucketStart, granularity)
  const startAt = new Date(endAt.getTime() - USAGE_PERIOD_MS[period])

  return { startAt, endAt, observedAt: now, interval: USAGE_INTERVALS[granularity] }
}

function advanceUsageBucket(
  bucketStart: Date,
  granularity: AdminUsageGranularity,
) {
  const next = new Date(bucketStart)
  if (granularity === 'minute') next.setUTCMinutes(next.getUTCMinutes() + 15)
  if (granularity === 'hour') next.setUTCHours(next.getUTCHours() + 1)
  if (granularity === 'day') next.setUTCDate(next.getUTCDate() + 1)
  return next
}

async function requireAdminActor(actorId: string) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const rows = await sql`
    SELECT 1
    FROM users
    WHERE user_id = ${actorId}
      AND role = 'ADMIN'
      AND account_status = 'ACTIVE'
  `
  if (!rows.length) throw new CoreError('활성 관리자 권한이 필요합니다.')
  return sql
}

async function inAdminAccountTransaction<T>(
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

async function requireActiveAdminForAccountAction(
  client: PoolClient,
  adminId: string,
) {
  const result = await client.query(
    `SELECT user_id
     FROM users
     WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
     FOR UPDATE`,
    [adminId],
  )
  if (!result.rowCount) throw new CoreError('활성 관리자 권한이 필요합니다.')
}

export async function getAdminOperationsDashboard(actorId: string) {
  const sql = await requireAdminActor(actorId)
  const [tripCounts, queueCounts, recentTrips, recentLedger] =
    await Promise.all([
      sql`
        SELECT status, count(*)::int AS count
        FROM trip_groups
        WHERE status IN (
          'OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS',
          'SETTLEMENT_PENDING'
        )
        GROUP BY status
      `,
      sql`
        SELECT
          (SELECT count(*)::int FROM point_grant_requests
            WHERE status = 'PENDING') AS "pointRequests",
          (SELECT count(*)::int FROM trip_settlements
            WHERE status = 'PENDING_CONFIRMATION'
              AND NOT EXISTS (
                SELECT 1
                FROM fare_disputes
                WHERE fare_disputes.trip_id = trip_settlements.trip_id
                  AND fare_disputes.status = 'OPEN'
              )) AS "pendingSettlements",
          (SELECT count(*)::int FROM fare_disputes
            WHERE status = 'OPEN') AS "openDisputes"
      `,
      sql`
        SELECT
          trip_id AS "tripId",
          status,
          departure_at AS "departureAt",
          max_participants AS "maxParticipants",
          (
            SELECT count(*)::int
            FROM trip_participants p
            WHERE p.trip_id = g.trip_id
              AND p.status IN (
                'APPROVED', 'DEPOSITED', 'CHECKED_IN',
                'NO_SHOW', 'DISPUTED', 'COMPLETED'
              )
          ) AS "participantCount"
        FROM trip_groups g
        WHERE status IN (
          'OPEN', 'CLOSED', 'CONFIRMED',
          'IN_PROGRESS', 'SETTLEMENT_PENDING'
        )
        ORDER BY departure_at
        LIMIT 20
      `,
      sql`
        SELECT
          l.ledger_id AS "ledgerId",
          l.entry_type AS "entryType",
          l.available_delta AS "availableDelta",
          l.created_at AS "createdAt"
        FROM point_ledger l
        ORDER BY l.created_at DESC
        LIMIT 10
      `,
    ])
  return {
    tripCounts: tripCounts as unknown as Array<{
      status: string
      count: number
    }>,
    queues: (queueCounts[0] as
      | {
          pointRequests: number
          pendingSettlements: number
          openDisputes: number
        }
      | undefined) ?? {
      pointRequests: 0,
      pendingSettlements: 0,
      openDisputes: 0,
    },
    recentTrips: recentTrips as unknown as Array<{
      tripId: string
      status: string
      departureAt: string
      maxParticipants: number
      participantCount: number
    }>,
    recentLedger: recentLedger as unknown as Array<{
      ledgerId: string
      entryType: string
      availableDelta: number
      createdAt: string
    }>,
  }
}

export async function getAdminFareDisputes(actorId: string) {
  const sql = await requireAdminActor(actorId)
  const rows = await sql`
    SELECT
      d.dispute_id AS "disputeId",
      d.trip_id AS "tripId",
      d.reason,
      d.submitted_at AS "submittedAt",
      u.name AS "participantName",
      u.student_id AS "participantStudentId",
      g.origin,
      g.destination,
      g.departure_at AS "departureAt",
      s.actual_fare AS "actualFare",
      s.final_share AS "finalShare",
      s.participant_count AS "participantCount",
      s.fare_revision AS "fareRevision",
      s.status AS "settlementStatus",
      s.allocation_policy AS "allocationPolicy",
      s.confirmation_deadline AS "confirmationDeadline",
      s.dispute_deadline AS "disputeDeadline",
      estimate.route_distance_m AS "routeDistanceM",
      estimate.duration_seconds AS "durationSeconds",
      estimate.provider_key AS "routeProvider",
      estimate.calculated_at AS "routeCalculatedAt"
    FROM fare_disputes d
    JOIN users u ON u.user_id = d.user_id
    JOIN trip_groups g ON g.trip_id = d.trip_id
    JOIN trip_settlements s ON s.trip_id = d.trip_id
    LEFT JOIN LATERAL (
      SELECT route_distance_m, duration_seconds, provider_key, calculated_at
      FROM fare_estimates
      WHERE trip_id = d.trip_id
      ORDER BY calculated_at DESC, created_at DESC
      LIMIT 1
    ) estimate ON true
    WHERE d.status = 'OPEN'
      AND g.status = 'SETTLEMENT_PENDING'
      AND s.status IN ('PENDING_CONFIRMATION', 'PROVISIONALLY_SETTLED')
    ORDER BY d.submitted_at ASC
    LIMIT 100
  `
  return rows as unknown as Array<{
    disputeId: string
    tripId: string
    reason: string
    submittedAt: string
    participantName: string
    participantStudentId: string
    origin: string
    destination: string
    departureAt: string
    actualFare: number
    finalShare: number
    participantCount: number
    fareRevision: number
    settlementStatus: string
    allocationPolicy: string
    confirmationDeadline: string
    disputeDeadline: string | null
    routeDistanceM: number | null
    durationSeconds: number | null
    routeProvider: string | null
    routeCalculatedAt: string | null
  }>
}

export async function getAdminUsers(
  actorId: string,
  statusFilter: AdminUserStatusFilter = 'ALL',
) {
  const sql = await requireAdminActor(actorId)
  const rows = await sql`
    SELECT
      u.user_id AS "userId",
      u.name,
      u.student_id AS "studentId",
      u.role,
      u.account_status AS "accountStatus",
      COALESCE(a.available_points, 0) AS "availablePoints",
      COALESCE(a.held_points, 0) AS "heldPoints",
      activity.activity_at AS "lastActivityAt",
      pending.source_type AS "pendingSuspensionSource",
      pending.requested_at AS "pendingSuspensionRequestedAt"
    FROM users u
    LEFT JOIN point_accounts a ON a.user_id = u.user_id
    LEFT JOIN LATERAL (
      SELECT max(events.activity_at) AS activity_at
      FROM (
        SELECT s.created_at AS activity_at
        FROM auth_sessions s
        WHERE s.user_id = u.user_id
        UNION ALL
        SELECT g.created_at AS activity_at
        FROM trip_groups g
        WHERE g.host_user_id = u.user_id
        UNION ALL
        SELECT p.applied_at AS activity_at
        FROM trip_participants p
        WHERE p.user_id = u.user_id
        UNION ALL
        SELECT p.checked_in_at AS activity_at
        FROM trip_participants p
        WHERE p.user_id = u.user_id
          AND p.checked_in_at IS NOT NULL
      ) events
      LIMIT 1
    ) activity ON true
    LEFT JOIN LATERAL (
      SELECT source_type, requested_at
      FROM account_suspension_requests request
      WHERE request.target_user_id = u.user_id
        AND request.effective_at IS NULL
      LIMIT 1
    ) pending ON true
    WHERE (${statusFilter === 'ALL'} OR u.account_status = ${statusFilter})
    ORDER BY u.created_at DESC, u.user_id DESC
    LIMIT 100
  `
  return rows as unknown as Array<{
    userId: string
    name: string
    studentId: string
    role: string
    accountStatus: string
    availablePoints: number
    heldPoints: number
    lastActivityAt: string | null
    pendingSuspensionSource: 'REPORT' | 'ADMIN_DIRECT' | null
    pendingSuspensionRequestedAt: string | null
  }>
}

export async function deactivateAdminUser(input: {
  adminId: string
  targetUserId: string
  reason: string
  idempotencyKey: string
}) {
  assertUuid(input.adminId, '관리자')
  assertUuid(input.targetUserId, '사용자')
  assertUuid(input.idempotencyKey, '요청')
  if (input.adminId === input.targetUserId) {
    throw new CoreError('본인 계정은 비활성화할 수 없습니다.')
  }
  const reason = normalizeReason(input.reason)

  return inAdminAccountTransaction(async (client) => {
    await requireActiveAdminForAccountAction(client, input.adminId)

    const replay = await client.query(
      `SELECT target_user_id, reason, source_type
       FROM account_suspension_requests
       WHERE requested_by_admin_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (
        existing.target_user_id === input.targetUserId &&
        existing.reason === reason &&
        existing.source_type === 'ADMIN_DIRECT'
      ) {
        return
      }
      throw new CoreError('같은 요청 식별자가 다른 이용 정지 요청에 사용됐습니다.')
    }

    const target = await client.query(
      `SELECT user_id, role, account_status
       FROM users
       WHERE user_id = $1
       FOR UPDATE`,
      [input.targetUserId],
    )
    const targetRow = target.rows[0]
    if (!targetRow) throw new CoreError('사용자 계정을 찾을 수 없습니다.')
    if (targetRow.role !== 'USER') {
      throw new CoreError('관리자 계정은 이 화면에서 비활성화할 수 없습니다.')
    }
    if (targetRow.account_status !== 'ACTIVE') {
      throw new CoreError('활성 상태인 사용자 계정만 비활성화할 수 있습니다.')
    }

    await client.query(
      `INSERT INTO account_suspension_requests (
         target_user_id, requested_by_admin_id, source_type, reason, idempotency_key
       ) VALUES ($1, $2, 'ADMIN_DIRECT', $3, $4)`,
      [input.targetUserId, input.adminId, reason, input.idempotencyKey],
    )
    await effectDueAccountSuspensions(client, input.targetUserId)
  })
}

export async function getAdminSafetyDashboard(actorId: string) {
  const sql = await requireAdminActor(actorId)
  const [reports, tripIncidents, tickets, counts] = await Promise.all([
    sql`
      SELECT
        r.report_id AS "reportId",
        reporter.name AS "reporterName",
        reported.name AS "reportedName",
        r.trip_id AS "tripId",
        r.reason_code AS "reasonCode",
        r.description,
        r.evidence_ref AS "evidenceRef",
        r.status,
        r.created_at AS "createdAt"
      FROM user_reports r
      JOIN users reporter ON reporter.user_id = r.reporter_user_id
      LEFT JOIN users reported ON reported.user_id = r.reported_user_id
      WHERE r.status IN ('SUBMITTED', 'IN_REVIEW')
      ORDER BY r.created_at, r.report_id
      LIMIT 100
    `,
    sql`
      SELECT
        i.incident_id AS "incidentId",
        i.trip_id AS "tripId",
        i.incident_type AS "incidentType",
        reporter.name AS "reporterName",
        reported.name AS "reportedName",
        i.description,
        i.evidence_ref AS "evidenceRef",
        i.submitted_at AS "submittedAt",
        rebuttal.statement AS "rebuttalStatement",
        rebuttal.evidence_ref AS "rebuttalEvidenceRef",
        command.command_type AS status,
        command.created_at AS "commandCreatedAt",
        command.admin_user_id AS "reviewAdminId",
        execution.execution_id AS "noShowExecutionId",
        no_start_execution.execution_id AS "noStartRefundExecutionId",
        notification.notification_id AS "rebuttalNotificationId",
        notification.rebuttal_deadline_at AS "rebuttalDeadlineAt",
        coalesce(notification.rebuttal_deadline_at <= clock_timestamp(), false)
          AS "rebuttalDeadlineExpired"
      FROM trip_incidents i
      JOIN users reporter ON reporter.user_id = i.reporter_user_id
      JOIN users reported ON reported.user_id = i.reported_user_id
      LEFT JOIN trip_incident_rebuttals rebuttal
        ON rebuttal.incident_id = i.incident_id
      LEFT JOIN LATERAL (
        SELECT command_type, created_at, admin_user_id
        FROM trip_incident_review_commands
        WHERE incident_id = i.incident_id
        ORDER BY created_at DESC, command_id DESC
        LIMIT 1
      ) command ON true
      LEFT JOIN trip_incident_no_show_executions execution
        ON execution.incident_id = i.incident_id
      LEFT JOIN trip_incident_no_start_refund_executions no_start_execution
        ON no_start_execution.incident_id = i.incident_id
      LEFT JOIN trip_incident_review_notifications notification
        ON notification.incident_id = i.incident_id
      WHERE command.command_type IS NULL
         OR command.command_type = 'START_REVIEW'
         OR (
           command.command_type = 'RESPONSIBILITY_CONFIRMED'
           AND i.incident_type = 'MEMBER_NO_SHOW'
           AND execution.execution_id IS NULL
         )
         OR (
           command.command_type = 'RESPONSIBILITY_CONFIRMED'
           AND i.incident_type = 'HOST_NO_START'
           AND no_start_execution.execution_id IS NULL
         )
      ORDER BY i.submitted_at, i.incident_id
      LIMIT 100
    `,
    sql`
      SELECT
        t.ticket_id AS "ticketId",
        requester.name AS "requesterName",
        t.category,
        t.subject,
        t.body,
        t.status,
        t.created_at AS "createdAt"
      FROM support_tickets t
      JOIN users requester ON requester.user_id = t.requester_user_id
      WHERE t.status IN ('SUBMITTED', 'IN_REVIEW')
      ORDER BY t.created_at, t.ticket_id
      LIMIT 100
    `,
    sql`
      SELECT
        (SELECT count(*)::int FROM user_reports
          WHERE status IN ('SUBMITTED', 'IN_REVIEW')) AS "reportCount",
        (SELECT count(*)::int FROM support_tickets
          WHERE status IN ('SUBMITTED', 'IN_REVIEW')) AS "ticketCount",
        (SELECT count(*)::int
          FROM trip_incidents i
          WHERE NOT EXISTS (
            SELECT 1 FROM trip_incident_review_commands c
            WHERE c.incident_id = i.incident_id
              AND c.command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
          ) OR (
            i.incident_type = 'MEMBER_NO_SHOW'
            AND EXISTS (
              SELECT 1 FROM trip_incident_review_commands c
              WHERE c.incident_id = i.incident_id
                AND c.command_type = 'RESPONSIBILITY_CONFIRMED'
            )
            AND NOT EXISTS (
              SELECT 1 FROM trip_incident_no_show_executions e
              WHERE e.incident_id = i.incident_id
            )
          ) OR (
            i.incident_type = 'HOST_NO_START'
            AND EXISTS (
              SELECT 1 FROM trip_incident_review_commands c
              WHERE c.incident_id = i.incident_id
                AND c.command_type = 'RESPONSIBILITY_CONFIRMED'
            )
            AND NOT EXISTS (
              SELECT 1 FROM trip_incident_no_start_refund_executions e
              WHERE e.incident_id = i.incident_id
            )
          )) AS "tripIncidentCount"
    `,
  ])
  return {
    reports: reports as unknown as Array<{
      reportId: string
      reporterName: string
      reportedName: string | null
      tripId: string | null
      reasonCode: string
      description: string
      evidenceRef: string | null
      status: string
      createdAt: string
    }>,
    tickets: tickets as unknown as Array<{
      ticketId: string
      requesterName: string
      category: string
      subject: string
      body: string
      status: string
      createdAt: string
    }>,
    tripIncidents: tripIncidents as unknown as Array<{
      incidentId: string
      tripId: string
      incidentType: string
      reporterName: string
      reportedName: string
      description: string
      evidenceRef: string | null
      submittedAt: string
      rebuttalStatement: string | null
      rebuttalEvidenceRef: string | null
      status: string | null
      commandCreatedAt: string | null
      reviewAdminId: string | null
      noShowExecutionId: string | null
      noStartRefundExecutionId: string | null
      rebuttalNotificationId: string | null
      rebuttalDeadlineAt: string | null
      rebuttalDeadlineExpired: boolean
    }>,
    counts: (counts[0] as
      | {
          reportCount: number
          ticketCount: number
          tripIncidentCount: number
        }
      | undefined) ?? {
      reportCount: 0,
      ticketCount: 0,
      tripIncidentCount: 0,
    },
  }
}

/**
 * Returns an explicitly zero-filled series. A zero means no matching records
 * were written in that bucket; it is never estimated or synthesized usage.
 */
async function getAdminUsageSeriesForWindow(
  sql: ReturnType<typeof getDatabase>,
  selection: Pick<
    ReturnType<typeof normalizeAdminUsageSelection>,
    'metric' | 'period' | 'granularity'
  >,
  window: ReturnType<typeof usageWindow>,
) {
  const { startAt, endAt, observedAt, interval } = window

  const queryByMetric = {
    TRIP_CREATED: () => sql`
      WITH buckets AS (
        SELECT bucket_start
        FROM generate_series(
          ${startAt}::timestamptz,
          ${endAt}::timestamptz - ${interval}::interval,
          ${interval}::interval
        ) AS series(bucket_start)
      ), events AS (
        SELECT created_at AS event_at
        FROM trip_groups
        WHERE created_at >= ${startAt}::timestamptz
          AND created_at < ${endAt}::timestamptz
      )
      SELECT
        buckets.bucket_start AS "bucketStart",
        count(events.event_at)::int AS count
      FROM buckets
      LEFT JOIN events
        ON events.event_at >= buckets.bucket_start
        AND events.event_at < buckets.bucket_start + ${interval}::interval
      GROUP BY buckets.bucket_start
      ORDER BY buckets.bucket_start
    `,
    POINT_GRANT_REQUESTED: () => sql`
      WITH buckets AS (
        SELECT bucket_start
        FROM generate_series(
          ${startAt}::timestamptz,
          ${endAt}::timestamptz - ${interval}::interval,
          ${interval}::interval
        ) AS series(bucket_start)
      ), events AS (
        SELECT requested_at AS event_at
        FROM point_grant_requests
        WHERE requested_at >= ${startAt}::timestamptz
          AND requested_at < ${endAt}::timestamptz
      )
      SELECT
        buckets.bucket_start AS "bucketStart",
        count(events.event_at)::int AS count
      FROM buckets
      LEFT JOIN events
        ON events.event_at >= buckets.bucket_start
        AND events.event_at < buckets.bucket_start + ${interval}::interval
      GROUP BY buckets.bucket_start
      ORDER BY buckets.bucket_start
    `,
    FARE_DISPUTE_SUBMITTED: () => sql`
      WITH buckets AS (
        SELECT bucket_start
        FROM generate_series(
          ${startAt}::timestamptz,
          ${endAt}::timestamptz - ${interval}::interval,
          ${interval}::interval
        ) AS series(bucket_start)
      ), events AS (
        SELECT submitted_at AS event_at
        FROM fare_disputes
        WHERE submitted_at >= ${startAt}::timestamptz
          AND submitted_at < ${endAt}::timestamptz
      )
      SELECT
        buckets.bucket_start AS "bucketStart",
        count(events.event_at)::int AS count
      FROM buckets
      LEFT JOIN events
        ON events.event_at >= buckets.bucket_start
        AND events.event_at < buckets.bucket_start + ${interval}::interval
      GROUP BY buckets.bucket_start
      ORDER BY buckets.bucket_start
    `,
    SETTLEMENT_SUBMITTED: () => sql`
      WITH buckets AS (
        SELECT bucket_start
        FROM generate_series(
          ${startAt}::timestamptz,
          ${endAt}::timestamptz - ${interval}::interval,
          ${interval}::interval
        ) AS series(bucket_start)
      ), events AS (
        SELECT submitted_at AS event_at
        FROM trip_settlements
        WHERE submitted_at >= ${startAt}::timestamptz
          AND submitted_at < ${endAt}::timestamptz
      )
      SELECT
        buckets.bucket_start AS "bucketStart",
        count(events.event_at)::int AS count
      FROM buckets
      LEFT JOIN events
        ON events.event_at >= buckets.bucket_start
        AND events.event_at < buckets.bucket_start + ${interval}::interval
      GROUP BY buckets.bucket_start
      ORDER BY buckets.bucket_start
    `,
  }

  const rows = await queryByMetric[selection.metric]()
  return {
    ...selection,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    observedAt: observedAt.toISOString(),
    points: rows as unknown as AdminUsageSeriesPoint[],
  }
}

export async function getAdminUsageSeries(
  actorId: string,
  selection: Pick<
    ReturnType<typeof normalizeAdminUsageSelection>,
    'metric' | 'period' | 'granularity'
  >,
) {
  const sql = await requireAdminActor(actorId)
  return getAdminUsageSeriesForWindow(
    sql,
    selection,
    usageWindow(selection.period, selection.granularity),
  )
}

/**
 * Returns all block-summary series from one authorized, shared time window.
 * The UI may switch among these server-authorized records without another query.
 */
export async function getAdminUsageOverview(actorId: string) {
  const sql = await requireAdminActor(actorId)
  const selection = {
    period: '24h' as const,
    granularity: 'hour' as const,
  }
  const window = usageWindow(selection.period, selection.granularity)
  const entries = await Promise.all(
    ADMIN_USAGE_METRICS.map(async (metric) => {
      try {
        return [
          metric,
          await getAdminUsageSeriesForWindow(sql, { ...selection, metric }, window),
        ] as const
      } catch {
        // A failed metric is unavailable, never equivalent to a zero-event series.
        return [metric, null] as const
      }
    }),
  )

  return Object.fromEntries(entries) as Record<
    AdminUsageMetric,
    Awaited<ReturnType<typeof getAdminUsageSeries>> | null
  >
}
