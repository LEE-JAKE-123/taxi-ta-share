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
