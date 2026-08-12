import 'server-only'

import { ensureDatabaseIdentity, getDatabase } from '@/lib/db/client'
import { CoreError } from '@/lib/core/service'

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
            WHERE status = 'PENDING_CONFIRMATION') AS "pendingSettlements",
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
      s.confirmation_deadline AS "confirmationDeadline",
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
      AND s.status = 'PENDING_CONFIRMATION'
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
    confirmationDeadline: string
    routeDistanceM: number | null
    durationSeconds: number | null
    routeProvider: string | null
    routeCalculatedAt: string | null
  }>
}

export async function getAdminUsers(actorId: string) {
  const sql = await requireAdminActor(actorId)
  const rows = await sql`
    SELECT
      u.user_id AS "userId",
      u.student_id AS "studentId",
      u.role,
      u.account_status AS "accountStatus",
      COALESCE(a.available_points, 0) AS "availablePoints",
      COALESCE(a.held_points, 0) AS "heldPoints"
    FROM users u
    LEFT JOIN point_accounts a ON a.user_id = u.user_id
    ORDER BY u.created_at DESC
    LIMIT 100
  `
  return rows as unknown as Array<{
    userId: string
    studentId: string
    role: string
    accountStatus: string
    availablePoints: number
    heldPoints: number
  }>
}

export async function getAdminSafetyDashboard(actorId: string) {
  const sql = await requireAdminActor(actorId)
  const [reports, tickets] = await Promise.all([
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
  }
}
