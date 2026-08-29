import 'server-only'

import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from '@neondatabase/serverless'
import { ensureDatabaseIdentity, getDatabase, getDatabaseUrl } from '@/lib/db/client'
import { resolveTripClosureStatus } from '@/lib/core/trip-validation'
import { calculateDemoFinalShare } from '@/lib/core/journey'
import {
  isPointRequestUuid,
  MAX_POINT_AMOUNT,
  normalizePointReason,
  parsePointAmount,
} from '@/lib/core/point-validation'
import {
  estimateRoute,
  RoutingError,
  type RoutingProvider,
} from '@/lib/routing'
import { verifyPlaceSelectionToken } from '@/lib/routing/place-token'
import {
  assertNoPendingSuspensionForNewUse,
  effectDueAccountSuspensions,
} from '../safety/suspension'

const MAX_POINTS = MAX_POINT_AMOUNT

export class CoreError extends Error {}

type TripRow = {
  tripId: string
  hostUserId: string
  hostName: string
  origin: string
  destination: string
  departureAt: string
  maxParticipants: number
  estimatedFare: number | null
  status: string
  approvedCount: number
  currentUserStatus: string | null
  hasRecommendationLocation: boolean
  originLatitude: number | null
  originLongitude: number | null
  destinationLatitude: number | null
  destinationLongitude: number | null
  fareSubmitterUserId: string | null
  hostMemo: string | null
}

export async function getDiscoverableTrips(userId: string) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const trips = await sql`
    SELECT
      g.trip_id AS "tripId",
      g.host_user_id AS "hostUserId",
      host.name AS "hostName",
      g.origin,
      g.destination,
      g.departure_at AS "departureAt",
      g.max_participants AS "maxParticipants",
      g.estimated_fare AS "estimatedFare",
      g.origin_latitude::float8 AS "originLatitude",
      g.origin_longitude::float8 AS "originLongitude",
      g.destination_latitude::float8 AS "destinationLatitude",
      g.destination_longitude::float8 AS "destinationLongitude",
      g.fare_submitter_user_id AS "fareSubmitterUserId",
      CASE
        WHEN mine.status IN (
          'APPLIED', 'APPROVED', 'DEPOSITED', 'CHECKED_IN',
          'NO_SHOW', 'DISPUTED', 'COMPLETED'
        ) THEN g.host_memo
        ELSE NULL
      END AS "hostMemo",
      g.status,
      count(p.user_id) FILTER (
        WHERE p.status IN (
          'APPROVED', 'DEPOSITED', 'CHECKED_IN',
          'NO_SHOW', 'DISPUTED', 'COMPLETED'
        )
      )::int AS "approvedCount",
      mine.status AS "currentUserStatus",
      (
        g.departure_at > now()
        AND g.origin_latitude IS NOT NULL
        AND g.origin_longitude IS NOT NULL
        AND g.destination_latitude IS NOT NULL
        AND g.destination_longitude IS NOT NULL
        AND g.destination_place_provider IS NOT NULL
        AND g.destination_provider_place_id IS NOT NULL
      ) AS "hasRecommendationLocation"
    FROM trip_groups g
    JOIN users host ON host.user_id = g.host_user_id
    LEFT JOIN trip_participants p ON p.trip_id = g.trip_id
    LEFT JOIN trip_participants mine
      ON mine.trip_id = g.trip_id AND mine.user_id = ${userId}
    WHERE g.status = 'OPEN'
      AND g.departure_at > now()
      AND (
        mine.user_id IS NOT NULL
        OR NOT EXISTS (
          SELECT 1
          FROM trip_participants safety_participant
          JOIN user_blocks block ON (
            (block.blocker_user_id = ${userId}
              AND block.blocked_user_id = safety_participant.user_id)
            OR (block.blocker_user_id = safety_participant.user_id
              AND block.blocked_user_id = ${userId})
          )
          WHERE safety_participant.trip_id = g.trip_id
            AND safety_participant.user_id <> ${userId}
            AND safety_participant.status IN (
              'APPROVED', 'DEPOSITED', 'CHECKED_IN',
              'NO_SHOW', 'DISPUTED', 'COMPLETED'
            )
        )
    )
    GROUP BY g.trip_id, host.name, mine.status
    HAVING count(p.user_id) FILTER (
      WHERE p.status IN (
        'APPROVED', 'DEPOSITED', 'CHECKED_IN',
        'NO_SHOW', 'DISPUTED', 'COMPLETED'
      )
    ) < g.max_participants
    ORDER BY g.created_at DESC
  `

  return trips as unknown as TripRow[]
}

export async function getCoreDashboard(userId: string, isAdmin: boolean) {
  await closeDueTrips()
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const [balanceRows, tripRows, participantRows, settlementRows, users] =
    await Promise.all([
      sql`
        SELECT available_points AS "availablePoints", held_points AS "heldPoints"
        FROM point_balances WHERE user_id = ${userId}
      `,
      sql`
        SELECT
          g.trip_id AS "tripId",
          g.host_user_id AS "hostUserId",
          host.name AS "hostName",
          g.origin,
          g.destination,
          g.departure_at AS "departureAt",
          g.max_participants AS "maxParticipants",
          g.estimated_fare AS "estimatedFare",
          g.origin_latitude::float8 AS "originLatitude",
          g.origin_longitude::float8 AS "originLongitude",
          g.destination_latitude::float8 AS "destinationLatitude",
          g.destination_longitude::float8 AS "destinationLongitude",
          g.fare_submitter_user_id AS "fareSubmitterUserId",
          CASE
            WHEN mine.status IN (
              'APPLIED', 'APPROVED', 'DEPOSITED', 'CHECKED_IN',
              'NO_SHOW', 'DISPUTED', 'COMPLETED'
            ) THEN g.host_memo
            ELSE NULL
          END AS "hostMemo",
          g.status,
          count(p.user_id) FILTER (
            WHERE p.status IN (
              'APPROVED', 'DEPOSITED', 'CHECKED_IN',
              'NO_SHOW', 'DISPUTED', 'COMPLETED'
            )
          )::int AS "approvedCount",
          mine.status AS "currentUserStatus",
          (
            g.departure_at > now()
            AND g.status NOT IN ('CANCELLED', 'EXPIRED', 'COMPLETED')
            AND g.origin_latitude IS NOT NULL
            AND g.origin_longitude IS NOT NULL
            AND g.destination_latitude IS NOT NULL
            AND g.destination_longitude IS NOT NULL
            AND g.destination_place_provider IS NOT NULL
            AND g.destination_provider_place_id IS NOT NULL
          ) AS "hasRecommendationLocation"
        FROM trip_groups g
        JOIN users host ON host.user_id = g.host_user_id
        LEFT JOIN trip_participants p ON p.trip_id = g.trip_id
        LEFT JOIN trip_participants mine
          ON mine.trip_id = g.trip_id AND mine.user_id = ${userId}
        WHERE mine.user_id IS NOT NULL
           OR NOT EXISTS (
             SELECT 1
             FROM trip_participants safety_participant
             JOIN user_blocks block ON (
               (block.blocker_user_id = ${userId}
                 AND block.blocked_user_id = safety_participant.user_id)
               OR (block.blocker_user_id = safety_participant.user_id
                 AND block.blocked_user_id = ${userId})
             )
             WHERE safety_participant.trip_id = g.trip_id
               AND safety_participant.user_id <> ${userId}
               AND safety_participant.status IN (
                 'APPROVED', 'DEPOSITED', 'CHECKED_IN',
                 'NO_SHOW', 'DISPUTED', 'COMPLETED'
               )
           )
        GROUP BY g.trip_id, host.name, mine.status
        ORDER BY g.created_at DESC
      `,
      sql`
        SELECT
          p.trip_id AS "tripId",
          p.user_id AS "userId",
          u.name,
          u.student_id AS "studentId",
          p.role,
          p.status
        FROM trip_participants p
        JOIN users u ON u.user_id = p.user_id
        JOIN trip_groups g ON g.trip_id = p.trip_id
        WHERE g.host_user_id = ${userId} OR p.user_id = ${userId}
        ORDER BY p.applied_at
      `,
      sql`
        SELECT
          s.trip_id AS "tripId",
          s.actual_fare AS "actualFare",
          s.final_share AS "finalShare",
          s.status,
          count(c.user_id)::int AS "confirmationCount",
          s.participant_count AS "participantCount",
          bool_or(c.user_id = ${userId}) AS "currentUserConfirmed"
        FROM trip_settlements s
        LEFT JOIN fare_confirmations c ON c.trip_id = s.trip_id
        JOIN trip_participants p
          ON p.trip_id = s.trip_id AND p.user_id = ${userId}
        GROUP BY s.trip_id
      `,
      isAdmin
        ? sql`
            SELECT user_id AS "userId", name, student_id AS "studentId"
            FROM users WHERE account_status = 'ACTIVE'
            ORDER BY created_at
          `
        : Promise.resolve([]),
    ])

  return {
    balance: (balanceRows[0] as
      | { availablePoints: string; heldPoints: string }
      | undefined) ?? { availablePoints: '0', heldPoints: '0' },
    trips: tripRows as unknown as TripRow[],
    participants: participantRows as unknown as Array<{
      tripId: string
      userId: string
      name: string
      studentId: string
      role: string
      status: string
    }>,
    settlements: settlementRows as unknown as Array<{
      tripId: string
      actualFare: number
      finalShare: number
      status: string
      confirmationCount: number
      participantCount: number
      currentUserConfirmed: boolean
    }>,
    users: users as unknown as Array<{
      userId: string
      name: string
      studentId: string
    }>,
  }
}

export async function getTripJourney(userId: string, tripId: string) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const [tripRows, participantRows, settlementRows, ledgerRows, incidentRows] =
    await Promise.all([
      sql`
        SELECT
          g.trip_id AS "tripId",
          g.host_user_id AS "hostUserId",
          g.origin,
          g.destination,
          g.departure_at AS "departureAt",
          g.status,
          g.in_progress_at AS "inProgressAt",
          p.status AS "currentUserStatus",
          p.role AS "currentUserRole",
          (
            SELECT count(*)::int
            FROM trip_deposits d
            WHERE d.trip_id = g.trip_id
          ) AS "escrowParticipantCount"
        FROM trip_groups g
        JOIN trip_participants p
          ON p.trip_id = g.trip_id
         AND p.user_id = ${userId}
        JOIN trip_deposits mine
          ON mine.trip_id = p.trip_id
         AND mine.user_id = p.user_id
        WHERE g.trip_id = ${tripId}
      `,
      sql`
        SELECT
          p.user_id AS "userId",
          u.name,
          p.role,
          p.status,
          p.checked_in_at AS "checkedInAt",
          p.no_show_at AS "noShowAt",
          d.amount AS "depositAmount"
        FROM trip_participants p
        JOIN users u ON u.user_id = p.user_id
        JOIN trip_deposits d
          ON d.trip_id = p.trip_id
         AND d.user_id = p.user_id
        WHERE p.trip_id = ${tripId}
          AND EXISTS (
            SELECT 1
            FROM trip_participants viewer
            JOIN trip_deposits viewer_deposit
              ON viewer_deposit.trip_id = viewer.trip_id
             AND viewer_deposit.user_id = viewer.user_id
            WHERE viewer.trip_id = p.trip_id
              AND viewer.user_id = ${userId}
          )
        ORDER BY p.role DESC, p.applied_at
      `,
      sql`
        SELECT
          s.actual_fare AS "actualFare",
          COALESCE((
            SELECT adjustment.revised_actual_fare
            FROM policy_v2_adjustment_commands adjustment
            WHERE adjustment.trip_id = s.trip_id
            ORDER BY adjustment.created_at DESC, adjustment.command_id DESC
            LIMIT 1
          ), s.actual_fare) AS "effectiveActualFare",
          EXISTS (
            SELECT 1
            FROM policy_v2_adjustment_commands adjustment
            WHERE adjustment.trip_id = s.trip_id
          ) AS "hasFareAdjustment",
          s.final_share AS "finalShare",
          s.participant_count AS "participantCount",
          s.status,
          s.allocation_policy AS "allocationPolicy",
          s.confirmation_deadline AS "confirmationDeadline",
          s.confirmation_deadline <= now() AS "confirmationExpired",
          s.dispute_deadline AS "disputeDeadline",
          (s.dispute_deadline IS NOT NULL AND s.dispute_deadline <= now())
            AS "disputeExpired",
          s.submitted_by = ${userId} AS "currentUserSubmittedFare",
          COALESCE((
            SELECT allocation.revised_share
            FROM policy_v2_adjustment_commands adjustment
            JOIN policy_v2_adjustment_allocations allocation
              ON allocation.command_id = adjustment.command_id
            WHERE adjustment.trip_id = s.trip_id AND allocation.user_id = ${userId}
            ORDER BY adjustment.created_at DESC, adjustment.command_id DESC
            LIMIT 1
          ), (
            SELECT sp.allocated_share
            FROM trip_settlement_participants sp
            WHERE sp.trip_id = s.trip_id AND sp.user_id = ${userId}
          ), s.final_share) AS "currentUserFinalShare",
          count(c.user_id)::int AS "confirmationCount",
          bool_or(c.user_id = ${userId}) AS "currentUserConfirmed",
          EXISTS (
            SELECT 1
            FROM fare_disputes d
            WHERE d.trip_id = s.trip_id
              AND d.user_id = ${userId}
              AND d.status = 'OPEN'
          ) AS "currentUserHasOpenDispute",
          (
            SELECT count(*)::int
            FROM fare_disputes d
            WHERE d.trip_id = s.trip_id AND d.status = 'OPEN'
          ) AS "openDisputeCount",
          s.settled_at AS "settledAt"
        FROM trip_settlements s
        LEFT JOIN fare_confirmations c ON c.trip_id = s.trip_id
        WHERE s.trip_id = ${tripId}
        GROUP BY s.trip_id
      `,
      sql`
        SELECT
          entry_type AS "entryType",
          available_delta AS "availableDelta",
          held_delta AS "heldDelta",
          reason,
          created_at AS "createdAt"
        FROM point_ledger
        WHERE trip_id = ${tripId}
          AND user_id = ${userId}
          AND entry_type IN (
            'DEPOSIT', 'SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT',
            'FARE_ADJUSTMENT_REFUND', 'FARE_ADJUSTMENT_DEBIT'
          )
        ORDER BY created_at
      `,
      sql`
        SELECT
          i.incident_id AS "incidentId",
          i.incident_type AS "incidentType",
          i.submitted_at AS "submittedAt",
          CASE
            WHEN i.reporter_user_id = ${userId} THEN 'REPORTER'
            ELSE 'REPORTED'
          END AS "viewerRole",
          CASE WHEN i.reporter_user_id = ${userId} THEN i.description ELSE NULL END
            AS "description",
          CASE WHEN i.reporter_user_id = ${userId} THEN i.evidence_ref ELSE NULL END
            AS "evidenceRef",
          rebuttal.rebuttal_id IS NOT NULL AS "hasRebuttal",
          CASE WHEN i.reported_user_id = ${userId} THEN rebuttal.statement ELSE NULL END
            AS "rebuttalStatement",
          CASE WHEN i.reported_user_id = ${userId} THEN rebuttal.evidence_ref ELSE NULL END
            AS "rebuttalEvidenceRef",
          command.command_type AS "commandType",
          command.created_at AS "commandCreatedAt",
          notification.exposed_at AS "rebuttalNoticePublishedAt",
          notification.rebuttal_deadline_at AS "rebuttalDeadlineAt",
          coalesce((
            command.command_type = 'START_REVIEW'
            AND rebuttal.rebuttal_id IS NULL
            AND notification.rebuttal_deadline_at > clock_timestamp()
          ), false) AS "rebuttalOpen"
        FROM trip_incidents i
        LEFT JOIN trip_incident_rebuttals rebuttal
          ON rebuttal.incident_id = i.incident_id
        LEFT JOIN LATERAL (
          SELECT command_type, created_at
          FROM trip_incident_review_commands
          WHERE incident_id = i.incident_id
          ORDER BY created_at DESC, command_id DESC
          LIMIT 1
        ) command ON true
        LEFT JOIN trip_incident_review_notifications notification
          ON notification.incident_id = i.incident_id
        WHERE i.trip_id = ${tripId}
          AND ${userId} IN (i.reporter_user_id, i.reported_user_id)
        ORDER BY i.submitted_at DESC, i.incident_id DESC
      `,
    ])

  const trip = tripRows[0] as
    | {
        tripId: string
        hostUserId: string
        origin: string
        destination: string
        departureAt: string
        status: string
        inProgressAt: string | null
        currentUserStatus: string
        currentUserRole: string
        escrowParticipantCount: number
      }
    | undefined
  if (!trip) throw new CoreError('확정 참여자만 집결 정보를 볼 수 있습니다.')

  return {
    trip,
    participants: participantRows as unknown as Array<{
      userId: string
      name: string
      role: string
      status: string
      checkedInAt: string | null
      noShowAt: string | null
      depositAmount: number
    }>,
    settlement: settlementRows[0] as
      | {
          actualFare: number
          effectiveActualFare: number
          hasFareAdjustment: boolean
          finalShare: number
          participantCount: number
          status: string
          allocationPolicy: string
          confirmationDeadline: string
          confirmationExpired: boolean
          disputeDeadline: string | null
          disputeExpired: boolean
          currentUserSubmittedFare: boolean
          currentUserFinalShare: number
          confirmationCount: number
          currentUserConfirmed: boolean
          currentUserHasOpenDispute: boolean
          openDisputeCount: number
          settledAt: string | null
        }
      | undefined,
    ledger: ledgerRows as unknown as Array<{
      entryType: string
      availableDelta: number
      heldDelta: number
      reason: string
      createdAt: string
    }>,
    incidents: incidentRows as unknown as Array<{
      incidentId: string
      incidentType: TripIncidentType
      submittedAt: string
      viewerRole: 'REPORTER' | 'REPORTED'
      description: string | null
      evidenceRef: string | null
      hasRebuttal: boolean
      rebuttalStatement: string | null
      rebuttalEvidenceRef: string | null
      commandType: TripIncidentReviewCommandType | null
      commandCreatedAt: string | null
      rebuttalNoticePublishedAt: string | null
      rebuttalDeadlineAt: string | null
      rebuttalOpen: boolean
    }>,
  }
}

export async function getMyPageBalanceSummary(userId: string) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const balances = await sql`
    SELECT
      available_points AS "availablePoints",
      held_points AS "heldPoints"
    FROM point_accounts
    WHERE user_id = ${userId}
  `

  const balance = balances[0] as
    | { availablePoints: string; heldPoints: string }
    | undefined

  return {
    availablePoints: Number(balance?.availablePoints ?? 0),
    heldPoints: Number(balance?.heldPoints ?? 0),
  }
}

export async function getPointDashboard(userId: string) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const [balances, ledger, requests, escrowShortfalls] = await Promise.all([
    sql`
      SELECT
        available_points AS "availablePoints",
        held_points AS "heldPoints"
      FROM point_accounts
      WHERE user_id = ${userId}
    `,
    sql`
      SELECT
        ledger_id AS "ledgerId",
        entry_type AS "entryType",
        available_delta AS "availableDelta",
        held_delta AS "heldDelta",
        reason,
        trip_id AS "tripId",
        created_at AS "createdAt"
      FROM point_ledger
      WHERE user_id = ${userId}
      ORDER BY created_at DESC, ledger_id DESC
      LIMIT 100
    `,
    sql`
      SELECT
        request_id AS "requestId",
        requested_amount AS "requestedAmount",
        reason,
        status,
        requested_at AS "requestedAt",
        fulfilled_at AS "fulfilledAt"
      FROM point_grant_requests
      WHERE requester_user_id = ${userId}
      ORDER BY requested_at DESC, request_id DESC
      LIMIT 20
    `,
    sql`
      SELECT
        shortfall_id AS "shortfallId",
        trip_id AS "tripId",
        expected_deposit_points AS "expectedDepositPoints",
        outstanding_points AS "outstandingPoints",
        status,
        created_at AS "createdAt",
        settled_at AS "settledAt"
      FROM trip_escrow_shortfalls
      WHERE user_id = ${userId}
      ORDER BY created_at DESC, shortfall_id DESC
      LIMIT 20
    `,
  ])

  const balance = balances[0] as
    | { availablePoints: string; heldPoints: string }
    | undefined
  return {
    balance: {
      availablePoints: Number(balance?.availablePoints ?? 0),
      heldPoints: Number(balance?.heldPoints ?? 0),
    },
    ledger: ledger as unknown as Array<{
      ledgerId: string
      entryType:
        | 'ADMIN_GRANT'
        | 'DEPOSIT'
        | 'SETTLEMENT_CHARGE'
        | 'REFUND'
        | 'ADDITIONAL_DEBIT'
      availableDelta: number
      heldDelta: number
      reason: string
      tripId: string | null
      createdAt: string
    }>,
    requests: requests as unknown as Array<{
      requestId: string
      requestedAmount: number
      reason: string
      status: 'PENDING' | 'FULFILLED'
      requestedAt: string
      fulfilledAt: string | null
    }>,
    escrowShortfalls: escrowShortfalls as unknown as Array<{
      shortfallId: string
      tripId: string
      expectedDepositPoints: number
      outstandingPoints: number
      status: 'OPEN' | 'SETTLED' | 'WAIVED'
      createdAt: string
      settledAt: string | null
    }>,
  }
}

export async function getAdminPointDashboard(actorId: string) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const actorRows = await sql`
    SELECT 1
    FROM users
    WHERE user_id = ${actorId}
      AND role = 'ADMIN'
      AND account_status = 'ACTIVE'
  `
  if (!actorRows.length) {
    throw new CoreError('활성 관리자만 관리자 정보를 조회할 수 있습니다.')
  }
  const [users, grants, unpreparedRequests, approvalQueue, executionQueue, totals] = await Promise.all([
    sql`
      SELECT
        user_id AS "userId",
        name,
        student_id AS "studentId",
        account_status AS "accountStatus",
        COALESCE((
          SELECT sum(d.outstanding_points)::integer
          FROM point_debt_obligations d
          WHERE d.user_id = users.user_id
            AND d.status = 'OPEN'
        ), 0) AS "settlementDebtOutstanding"
      FROM users
      WHERE role = 'USER'
        AND (
          account_status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM account_suspension_requests request
            WHERE request.target_user_id = users.user_id
              AND request.effective_at IS NULL
          )
          OR (
            account_status = 'SUSPENDED'
            AND EXISTS (
              SELECT 1
              FROM point_debt_obligations d
              WHERE d.user_id = users.user_id
                AND d.status = 'OPEN'
            )
          )
        )
        -- These are non-human provider/production verification accounts. They
        -- must never be offered as point recipients in the admin workflow.
        AND lower(btrim(name)) NOT IN (
          'map api',
          'route api',
          'production verification',
          'production verfication'
      )
      ORDER BY name, student_id
    `,
    sql`
      SELECT
        l.ledger_id AS "ledgerId",
        l.available_delta AS amount,
        l.reason,
        l.created_at AS "createdAt",
        target.name AS "targetName",
        target.student_id AS "targetStudentId",
        executor.name AS "executorName",
        approver.name AS "approverName"
      FROM point_ledger l
      JOIN users target ON target.user_id = l.user_id
      JOIN users executor ON executor.user_id = l.actor_user_id
      LEFT JOIN point_grant_approval_commands approval
        ON approval.approval_command_id = l.grant_approval_command_id
      LEFT JOIN users approver ON approver.user_id = approval.approved_by_admin_id
      WHERE l.entry_type = 'ADMIN_GRANT'
      ORDER BY l.created_at DESC, l.ledger_id DESC
      LIMIT 100
    `,
    sql`
      SELECT
        r.request_id AS "requestId",
        r.requested_amount AS "requestedAmount",
        r.reason,
        r.requested_at AS "requestedAt",
        u.user_id AS "userId",
        u.name,
        u.student_id AS "studentId"
      FROM point_grant_requests r
      JOIN users u ON u.user_id = r.requester_user_id
      WHERE r.status = 'PENDING'
        AND NOT EXISTS (
          SELECT 1 FROM point_grant_execution_requests e
          WHERE e.source_point_request_id = r.request_id
        )
      ORDER BY r.requested_at, r.request_id
      LIMIT 100
    `,
    sql`
      SELECT
        e.execution_request_id AS "executionRequestId",
        e.amount, e.reason, e.created_at AS "createdAt",
        e.source_point_request_id AS "sourcePointRequestId",
        target.name AS "targetName", target.student_id AS "targetStudentId",
        requester.name AS "requestedByName"
      FROM point_grant_execution_requests e
      JOIN users target ON target.user_id = e.target_user_id
      JOIN users requester ON requester.user_id = e.requested_by_admin_id
      WHERE e.requested_by_admin_id <> ${actorId}
        AND NOT EXISTS (
        SELECT 1 FROM point_grant_approval_commands a
        WHERE a.execution_request_id = e.execution_request_id
      )
      ORDER BY e.created_at, e.execution_request_id
      LIMIT 100
    `,
    sql`
      SELECT
        e.execution_request_id AS "executionRequestId",
        e.amount, e.reason, e.created_at AS "createdAt",
        e.source_point_request_id AS "sourcePointRequestId",
        target.name AS "targetName", target.student_id AS "targetStudentId",
        approver.name AS "approverName", a.approved_at AS "approvedAt"
      FROM point_grant_execution_requests e
      JOIN point_grant_approval_commands a
        ON a.execution_request_id = e.execution_request_id
      JOIN users target ON target.user_id = e.target_user_id
      JOIN users approver ON approver.user_id = a.approved_by_admin_id
      WHERE e.requested_by_admin_id = ${actorId}
        AND NOT EXISTS (
          SELECT 1 FROM point_ledger l
          WHERE l.grant_execution_request_id = e.execution_request_id
        )
      ORDER BY a.approved_at, e.execution_request_id
      LIMIT 100
    `,
    sql`
      SELECT COALESCE(sum(available_delta), 0) AS "totalGranted"
      FROM point_ledger
      WHERE entry_type = 'ADMIN_GRANT'
    `,
  ])

  return {
    users: users as unknown as Array<{
      userId: string
      name: string
      studentId: string
      accountStatus: 'ACTIVE' | 'SUSPENDED'
      settlementDebtOutstanding: number
    }>,
    grants: grants as unknown as Array<{
      ledgerId: string
      amount: number
      reason: string
      createdAt: string
      targetName: string
      targetStudentId: string
      executorName: string
      approverName: string | null
    }>,
    unpreparedRequests: unpreparedRequests as unknown as Array<{
      requestId: string
      requestedAmount: number
      reason: string
      requestedAt: string
      userId: string
      name: string
      studentId: string
    }>,
    approvalQueue: approvalQueue as unknown as Array<{
      executionRequestId: string
      amount: number
      reason: string
      createdAt: string
      sourcePointRequestId: string | null
      targetName: string
      targetStudentId: string
      requestedByName: string
    }>,
    executionQueue: executionQueue as unknown as Array<{
      executionRequestId: string
      amount: number
      reason: string
      createdAt: string
      sourcePointRequestId: string | null
      targetName: string
      targetStudentId: string
      approverName: string
      approvedAt: string
    }>,
    totalGranted: Number(
      (totals[0] as { totalGranted?: string } | undefined)?.totalGranted ?? 0,
    ),
  }
}

async function inTransaction<T>(run: (client: PoolClient) => Promise<T>) {
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

async function requireActiveUserForAction(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1 FROM users
     WHERE user_id = $1 AND account_status = 'ACTIVE'
     FOR SHARE`,
    [userId],
  )
  if (!result.rowCount) {
    throw new CoreError(
      '이용 정지된 계정은 실제 요금 입력·확인·이의 제기와 철회 같은 사용자 요청을 할 수 없습니다.',
    )
  }
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POINTS) {
    throw new CoreError(`${label}은 1~${MAX_POINTS.toLocaleString()} 사이의 정수여야 합니다.`)
  }
}

/**
 * DEC-013 allocation is deliberately kept separate from the legacy ceil
 * allocation. The returned snapshots are the values which must be persisted
 * with a policy-v2 settlement; callers must not re-sort or re-calculate them.
 */
export type HostApprovalAllocationParticipant = {
  userId: string
  role: 'HOST' | 'PARTICIPANT'
  approvedAt: Date | string | null
}

export type HostApprovalAllocation = HostApprovalAllocationParticipant & {
  allocationRank: number
  allocatedShare: number
}

export type PolicyV2ProvisionalAmounts = {
  chargedFromDeposit: number
  refund: number
  additionalDebit: number
  debtIncurred: number
}

/**
 * DEC-014: use every available point before recording the remainder as debt.
 * The worker obtains the available balance under a row lock before calling
 * this helper; it must never use a client-supplied balance.
 */
export function calculatePolicyV2ProvisionalAmounts(input: {
  depositAmount: number
  allocatedShare: number
  availablePoints: number
}): PolicyV2ProvisionalAmounts {
  const values = [input.depositAmount, input.allocatedShare, input.availablePoints]
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    input.depositAmount > MAX_POINTS || input.allocatedShare > MAX_POINTS
  ) {
    throw new CoreError('정산 포인트 금액이 올바르지 않습니다.')
  }
  const chargedFromDeposit = Math.min(input.depositAmount, input.allocatedShare)
  const refund = Math.max(0, input.depositAmount - input.allocatedShare)
  const shortfall = Math.max(0, input.allocatedShare - input.depositAmount)
  const additionalDebit = Math.min(input.availablePoints, shortfall)
  return {
    chargedFromDeposit,
    refund,
    additionalDebit,
    debtIncurred: shortfall - additionalDebit,
  }
}

export type PolicyV2AdjustmentAmounts = {
  availableDebit: number
  debtIncrease: number
  debtReduction: number
  availableRefund: number
}

/**
 * A corrected fare compensates only the difference from the immutable
 * provisional allocation.  Refunds retire this trip's outstanding debt first
 * so a user can never keep spendable points while the same overcharge remains
 * recorded as debt.
 */
export function calculatePolicyV2AdjustmentAmounts(input: {
  previousShare: number
  revisedShare: number
  availablePoints: number
  outstandingDebt: number
}): PolicyV2AdjustmentAmounts {
  const values = [
    input.previousShare,
    input.revisedShare,
    input.availablePoints,
    input.outstandingDebt,
  ]
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new CoreError('보정 정산 금액이 올바르지 않습니다.')
  }
  const difference = input.revisedShare - input.previousShare
  if (difference >= 0) {
    const availableDebit = Math.min(input.availablePoints, difference)
    return {
      availableDebit,
      debtIncrease: difference - availableDebit,
      debtReduction: 0,
      availableRefund: 0,
    }
  }
  const refund = -difference
  const debtReduction = Math.min(input.outstandingDebt, refund)
  return {
    availableDebit: 0,
    debtIncrease: 0,
    debtReduction,
    availableRefund: refund - debtReduction,
  }
}

function approvedAtMillis(value: Date | string | null) {
  if (value === null) return Number.POSITIVE_INFINITY
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(time)) {
    throw new CoreError('참여 승인 시각이 올바르지 않습니다.')
  }
  return time
}

export function allocateHostApprovalOrder(
  actualFare: number,
  participants: readonly HostApprovalAllocationParticipant[],
): HostApprovalAllocation[] {
  positiveInteger(actualFare, '실제 요금')
  if (participants.length < 2 || participants.length > 4) {
    throw new CoreError('정산 대상 인원은 2~4명이어야 합니다.')
  }

  const userIds = new Set<string>()
  let hostCount = 0
  for (const participant of participants) {
    if (!participant.userId || userIds.has(participant.userId)) {
      throw new CoreError('정산 대상 참여자가 올바르지 않습니다.')
    }
    userIds.add(participant.userId)
    if (participant.role === 'HOST') hostCount += 1
    else if (participant.role !== 'PARTICIPANT') {
      throw new CoreError('정산 대상 역할이 올바르지 않습니다.')
    }
    approvedAtMillis(participant.approvedAt)
  }
  if (hostCount !== 1) {
    throw new CoreError('정산 대상에는 방장이 정확히 한 명 있어야 합니다.')
  }

  const ordered = [...participants].sort((left, right) => {
    if (left.role !== right.role) return left.role === 'HOST' ? -1 : 1
    const approvalDifference = approvedAtMillis(left.approvedAt) - approvedAtMillis(right.approvedAt)
    return approvalDifference || left.userId.localeCompare(right.userId)
  })
  const baseShare = Math.floor(actualFare / ordered.length)
  const higherShareStartsAt = ordered.length - (actualFare % ordered.length)

  return ordered.map((participant, index) => ({
    ...participant,
    allocationRank: index + 1,
    allocatedShare: baseShare + (index + 1 > higherShareStartsAt ? 1 : 0),
  }))
}

export type PolicyV2UsageEligibility = {
  eligible: boolean
  reason: 'ELIGIBLE' | 'OPEN_DISPUTE_LIMIT' | 'UNCONTESTED_DEBT'
  openDisputeCount: number
  uncontestedDebtCount: number
  contestedDebtCount: number
}

/** Pure DEC-014 decision rule; query code only supplies the audited counts. */
export function policyV2UsageEligibilityFromCounts(input: {
  openDisputeCount: number
  uncontestedDebtCount: number
  contestedDebtCount: number
}): PolicyV2UsageEligibility {
  const counts = [
    input.openDisputeCount,
    input.uncontestedDebtCount,
    input.contestedDebtCount,
  ]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new CoreError('이용 제한 판정 값이 올바르지 않습니다.')
  }
  if (input.openDisputeCount >= 3) {
    return { ...input, eligible: false, reason: 'OPEN_DISPUTE_LIMIT' }
  }
  if (input.uncontestedDebtCount > 0) {
    return { ...input, eligible: false, reason: 'UNCONTESTED_DEBT' }
  }
  return { ...input, eligible: true, reason: 'ELIGIBLE' }
}

/**
 * Reads only policy-v2 data. An OPEN dispute is linked to a debt only when it
 * is from the same user, trip, and fare revision, preventing another user's
 * dispute from bypassing the debtor's normal-use restriction.
 */
export async function getPolicyV2UsageEligibility(
  userId: string,
): Promise<PolicyV2UsageEligibility> {
  if (!isPointRequestUuid(userId)) {
    throw new CoreError('사용자 식별자가 올바르지 않습니다.')
  }
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const rows = await sql`
    WITH open_debts AS (
      SELECT
        d.debt_id,
        EXISTS (
          SELECT 1
          FROM fare_disputes dispute
          WHERE dispute.trip_id = d.trip_id
            AND dispute.user_id = d.user_id
            AND dispute.fare_revision = d.fare_revision
            AND dispute.status = 'OPEN'
        ) AS is_contested
      FROM point_debt_obligations d
      WHERE d.user_id = ${userId}
        AND d.status = 'OPEN'
    ), open_disputes AS (
      SELECT count(*)::int AS count
      FROM fare_disputes
      WHERE user_id = ${userId}
        AND status = 'OPEN'
    )
    SELECT
      (SELECT count FROM open_disputes) AS "openDisputeCount",
      count(*) FILTER (WHERE NOT is_contested)::int AS "uncontestedDebtCount",
      count(*) FILTER (WHERE is_contested)::int AS "contestedDebtCount"
    FROM open_debts
  `
  const row = rows[0] as
    | { openDisputeCount: number; uncontestedDebtCount: number; contestedDebtCount: number }
    | undefined
  return policyV2UsageEligibilityFromCounts({
    openDisputeCount: Number(row?.openDisputeCount ?? 0),
    uncontestedDebtCount: Number(row?.uncontestedDebtCount ?? 0),
    contestedDebtCount: Number(row?.contestedDebtCount ?? 0),
  })
}

export async function assertPolicyV2UsageEligible(userId: string) {
  const eligibility = await getPolicyV2UsageEligibility(userId)
  assertPolicyV2UsageEligibility(eligibility)
  return eligibility
}

function assertPolicyV2UsageEligibility(eligibility: PolicyV2UsageEligibility) {
  if (!eligibility.eligible) {
    throw new CoreError(
      eligibility.reason === 'OPEN_DISPUTE_LIMIT'
        ? '미해결 이의가 3건 이상이면 정상 이용을 할 수 없습니다.'
        : '미상환 외상이 있어 정상 이용을 할 수 없습니다.',
    )
  }
}

/** Rechecks DEC-014 within the SERIALIZABLE transaction before a use write. */
async function assertPolicyV2UsageEligibleForWrite(
  client: PoolClient,
  userId: string,
) {
  try {
    await assertNoPendingSuspensionForNewUse(client, userId)
  } catch (error) {
    throw new CoreError(
      error instanceof Error
        ? error.message
        : '정지 예정 계정은 새 이용을 시작할 수 없습니다.',
    )
  }
  const debts = await client.query(
    `SELECT d.trip_id, d.fare_revision
     FROM point_debt_obligations d
     WHERE d.user_id = $1 AND d.status = 'OPEN'
     FOR UPDATE OF d`,
    [userId],
  )
  const disputes = await client.query(
    `SELECT trip_id, fare_revision
     FROM fare_disputes
     WHERE user_id = $1 AND status = 'OPEN'
     FOR UPDATE`,
    [userId],
  )
  const disputedDebtKeys = new Set(
    disputes.rows.map((dispute) => `${dispute.trip_id}:${dispute.fare_revision}`),
  )
  const contestedDebtCount = debts.rows.filter(
    (debt) => disputedDebtKeys.has(`${debt.trip_id}:${debt.fare_revision}`),
  ).length
  const eligibility = policyV2UsageEligibilityFromCounts({
    openDisputeCount: disputes.rowCount ?? 0,
    contestedDebtCount,
    uncontestedDebtCount: (debts.rowCount ?? 0) - contestedDebtCount,
  })
  assertPolicyV2UsageEligibility(eligibility)
  return eligibility
}

type PolicyV2ProvisionalPrerequisites = {
  schemaReady: boolean
  transitionGuardReady: boolean
  reversibleLedgerReady: boolean
}

/**
 * 0022 supplies the schema, but it intentionally leaves the legacy settlement
 * and ledger guards in place. Before any v2 write we require replacement
 * guards which explicitly support provisional/reversal entries. This makes a
 * partially deployed migration fail before it can write an irreversible row.
 */
async function getPolicyV2ProvisionalPrerequisites(
  client: PoolClient,
): Promise<PolicyV2ProvisionalPrerequisites> {
  const result = await client.query(
    `SELECT
       to_regclass('public.point_debt_obligations') IS NOT NULL
         AND to_regclass('public.point_debt_events') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM pg_attribute
           WHERE attrelid = 'trip_settlements'::regclass
             AND attname IN ('agreement_deadline', 'dispute_deadline', 'provisionally_settled_at', 'allocation_policy')
             AND NOT attisdropped
           GROUP BY attrelid HAVING count(*) = 4
         ) AS "schemaReady",
       EXISTS (
         SELECT 1 FROM pg_proc
         WHERE proname = 'guard_trip_settlement_update'
           AND pg_get_functiondef(oid) LIKE '%PROVISIONALLY_SETTLED%'
       ) AS "transitionGuardReady",
       EXISTS (
         SELECT 1
         FROM pg_trigger
         WHERE tgrelid = 'point_ledger'::regclass
           AND tgname = 'point_ledger_validate_policy_v2_financials'
           AND NOT tgisinternal
       )
       AND EXISTS (
         SELECT 1
         FROM pg_trigger
         WHERE tgrelid = 'system_deadline_commands'::regclass
           AND tgname = 'system_deadline_commands_validate_policy_v2_linkage'
           AND NOT tgisinternal
       ) AS "reversibleLedgerReady"`,
  )
  const row = result.rows[0] as PolicyV2ProvisionalPrerequisites | undefined
  return {
    schemaReady: Boolean(row?.schemaReady),
    transitionGuardReady: Boolean(row?.transitionGuardReady),
    reversibleLedgerReady: Boolean(row?.reversibleLedgerReady),
  }
}

export async function provisionallySettleTripV2(input: {
  tripId: string
  idempotencyKey: string
}) {
  if (!isPointRequestUuid(input.tripId) || !isPointRequestUuid(input.idempotencyKey)) {
    throw new CoreError('잠정 정산 요청 식별자가 올바르지 않습니다.')
  }

  return inTransaction(async (client) => {
    const prerequisites = await getPolicyV2ProvisionalPrerequisites(client)
    if (
      !prerequisites.schemaReady ||
      !prerequisites.transitionGuardReady ||
      !prerequisites.reversibleLedgerReady
    ) {
      throw new CoreError(
        '잠정 정산 정책 데이터베이스 준비가 완료되지 않았습니다. 원장 또는 상태를 변경하지 않았습니다.',
      )
    }

    const trip = await client.query(
      `SELECT g.status AS trip_status,
              s.status AS settlement_status,
              s.allocation_policy,
              s.participant_count,
              s.actual_fare,
              s.fare_revision,
              s.resubmission_required,
              s.agreement_deadline <= now() AS agreement_due,
              s.provisional_deadline_command_id
       FROM trip_groups g
       JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g, s`,
      [input.tripId],
    )
    const settlement = trip.rows[0] as Record<string, unknown> | undefined
    if (!settlement || settlement.allocation_policy !== 'HOST_APPROVAL_ORDER') {
      return 'SKIPPED' as const
    }
    if (settlement.settlement_status === 'PROVISIONALLY_SETTLED') {
      const command = await client.query(
        `SELECT 1 FROM system_deadline_commands
         WHERE command_id = $1 AND trip_id = $2 AND fare_revision = $3
           AND command_type = 'PROVISIONAL_SETTLE'
         FOR SHARE`,
        [
          settlement.provisional_deadline_command_id,
          input.tripId,
          settlement.fare_revision,
        ],
      )
      if (!command.rowCount) {
        throw new CoreError('잠정 정산 명령의 감사 연결이 손상되었습니다.')
      }
      return 'SETTLED' as const
    }
    if (
      settlement.trip_status !== 'SETTLEMENT_PENDING' ||
      settlement.settlement_status !== 'PENDING_CONFIRMATION' ||
      settlement.resubmission_required
    ) {
      return 'SKIPPED' as const
    }

    const snapshots = await client.query(
      `SELECT sp.user_id, sp.deposit_amount, sp.allocation_rank, sp.allocated_share,
              p.role, p.status, p.approved_at,
              c.user_id IS NOT NULL AS confirmed
       FROM trip_settlement_participants sp
       JOIN trip_participants p
         ON p.trip_id = sp.trip_id AND p.user_id = sp.user_id
       JOIN trip_deposits d
         ON d.trip_id = sp.trip_id AND d.user_id = sp.user_id
       LEFT JOIN fare_confirmations c
         ON c.trip_id = sp.trip_id AND c.user_id = sp.user_id
       WHERE sp.trip_id = $1
         AND sp.deposit_amount = d.amount
       ORDER BY sp.user_id
       FOR UPDATE OF sp, p, d`,
      [input.tripId],
    )
    const participantCount = Number(settlement.participant_count)
    if (snapshots.rowCount !== participantCount || participantCount < 2 || participantCount > 4) {
      throw new CoreError('정산 참여자 스냅샷이 확정 예치 인원과 일치하지 않습니다.')
    }
    if (
      snapshots.rows.some(
        (row) =>
          !['HOST', 'MEMBER'].includes(String(row.role)) ||
          !['DEPOSITED', 'CHECKED_IN', 'NO_SHOW'].includes(String(row.status)) ||
          !Number.isSafeInteger(Number(row.allocation_rank)) ||
          !Number.isSafeInteger(Number(row.allocated_share)),
      )
    ) {
      throw new CoreError('잠정 정산에 필요한 확정 참여자 정보가 올바르지 않습니다.')
    }
    const allocation = snapshots.rows
      .map((row) => ({
        userId: String(row.user_id),
        role: row.role === 'HOST' ? 'HOST' as const : 'PARTICIPANT' as const,
        approvedAt: row.approved_at as Date | string | null,
      }))
    const expectedAllocation = allocateHostApprovalOrder(Number(settlement.actual_fare), allocation)
    const snapshotByUser = new Map(snapshots.rows.map((row) => [String(row.user_id), row]))
    if (
      expectedAllocation.some((expected) => {
        const snapshot = snapshotByUser.get(expected.userId)
        return !snapshot || Number(snapshot.allocation_rank) !== expected.allocationRank ||
          Number(snapshot.allocated_share) !== expected.allocatedShare
      })
    ) {
      throw new CoreError('정산 배분 스냅샷이 방장·승인 순서 정책과 일치하지 않습니다.')
    }
    const allConfirmed = snapshots.rows.every((row) => row.confirmed === true)
    if (!allConfirmed && settlement.agreement_due !== true) return 'SKIPPED' as const

    const disputes = await client.query(
      `SELECT dispute_id FROM fare_disputes
       WHERE trip_id = $1 AND fare_revision = $2 AND status = 'OPEN'
       FOR UPDATE`,
      [input.tripId, settlement.fare_revision],
    )
    if (disputes.rowCount) return 'SKIPPED' as const

    const userIds = snapshots.rows.map((row) => String(row.user_id))
    const balances = await client.query(
      `SELECT user_id, available_points, held_points
       FROM point_accounts
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    if (balances.rowCount !== participantCount) {
      throw new CoreError('잠정 정산 참여자의 포인트 계정을 찾을 수 없습니다.')
    }
    const balanceByUser = new Map(
      balances.rows.map((row) => [String(row.user_id), {
        available: Number(row.available_points),
        held: Number(row.held_points),
      }]),
    )
    for (const snapshot of snapshots.rows) {
      const balance = balanceByUser.get(String(snapshot.user_id))
      if (!balance || balance.held < Number(snapshot.deposit_amount)) {
        throw new CoreError('예치 포인트 잔액이 정산 스냅샷과 일치하지 않습니다.')
      }
    }

    const executionKey = `provisional:${input.tripId}:revision:${settlement.fare_revision}`
    const command = await client.query(
      `INSERT INTO system_deadline_commands (
         trip_id, fare_revision, command_type, execution_key
       ) VALUES ($1, $2, 'PROVISIONAL_SETTLE', $3)
       ON CONFLICT (trip_id, fare_revision, command_type) DO NOTHING
       RETURNING command_id`,
      [input.tripId, settlement.fare_revision, executionKey],
    )
    const commandId = command.rows[0]?.command_id as string | undefined
    if (!commandId) {
      // A command without the transition must never be silently reused: it
      // would conceal a partial historical write and make recovery ambiguous.
      throw new CoreError('이미 생성된 잠정 정산 명령을 안전하게 재사용할 수 없습니다.')
    }

    await client.query(
      `UPDATE trip_settlements
       SET status = 'PROVISIONALLY_SETTLED',
           settlement_mode = 'SYSTEM_PROVISIONAL',
           provisional_deadline_command_id = $2
       WHERE trip_id = $1 AND status = 'PENDING_CONFIRMATION'`,
      [input.tripId, commandId],
    )

    for (const snapshot of snapshots.rows) {
      const userId = String(snapshot.user_id)
      const amounts = calculatePolicyV2ProvisionalAmounts({
        depositAmount: Number(snapshot.deposit_amount),
        allocatedShare: Number(snapshot.allocated_share),
        availablePoints: balanceByUser.get(userId)!.available,
      })
      if (amounts.chargedFromDeposit > 0) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, system_deadline_command_id, reason, idempotency_key
           ) VALUES ($1, 'SETTLEMENT_CHARGE', 0, $2, $3, NULL, $4,
             'policy-v2 provisional settlement charge', $5)`,
          [userId, -amounts.chargedFromDeposit, input.tripId, commandId,
            `provisional:${input.tripId}:revision:${settlement.fare_revision}:charge:${userId}`],
        )
      }
      if (amounts.refund > 0) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, system_deadline_command_id, reason, idempotency_key
           ) VALUES ($1, 'REFUND', $2, $3, $4, NULL, $5,
             'policy-v2 provisional settlement refund', $6)`,
          [userId, amounts.refund, -amounts.refund, input.tripId, commandId,
            `provisional:${input.tripId}:revision:${settlement.fare_revision}:refund:${userId}`],
        )
      }
      if (amounts.additionalDebit > 0) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, system_deadline_command_id, reason, idempotency_key
           ) VALUES ($1, 'ADDITIONAL_DEBIT', $2, 0, $3, NULL, $4,
             'policy-v2 provisional settlement additional debit', $5)`,
          [userId, -amounts.additionalDebit, input.tripId, commandId,
            `provisional:${input.tripId}:revision:${settlement.fare_revision}:debit:${userId}`],
        )
      }
      if (amounts.debtIncurred > 0) {
        const obligation = await client.query(
          `INSERT INTO point_debt_obligations (user_id, trip_id, fare_revision)
           VALUES ($1, $2, $3)
           ON CONFLICT (trip_id, user_id, fare_revision) DO NOTHING
           RETURNING debt_id`,
          [userId, input.tripId, settlement.fare_revision],
        )
        const debtId = obligation.rows[0]?.debt_id as string | undefined
        if (!debtId) {
          throw new CoreError('기존 외상 의무가 있어 잠정 정산을 안전하게 실행할 수 없습니다.')
        }
        await client.query(
          `INSERT INTO point_debt_events (
             debt_id, user_id, event_type, debt_delta, actor_user_id, reason,
             idempotency_key, system_deadline_command_id
           ) VALUES ($1, $2, 'INCUR', $3, NULL, 'policy-v2 provisional settlement debt', $4, $5)`,
          [debtId, userId, amounts.debtIncurred,
            `provisional:${input.tripId}:revision:${settlement.fare_revision}:debt-incur:${userId}`,
            commandId],
        )
      }
    }
    const escrowShortfalls = await client.query(
      `SELECT shortfall_id, user_id, outstanding_points
       FROM trip_escrow_shortfalls
       WHERE trip_id = $1
         AND user_id = ANY($2::uuid[])
         AND status = 'OPEN'
       ORDER BY user_id
       FOR UPDATE`,
      [input.tripId, userIds],
    )
    for (const shortfall of escrowShortfalls.rows) {
      const outstandingPoints = Number(shortfall.outstanding_points)
      if (!Number.isSafeInteger(outstandingPoints) || outstandingPoints < 1) {
        throw new CoreError('예치 부족 외상 잔액이 올바르지 않습니다.')
      }
      await client.query(
        `INSERT INTO trip_escrow_shortfall_events (
           shortfall_id, user_id, event_type, points_delta,
           system_deadline_command_id, reason, idempotency_key
         ) VALUES ($1, $2, 'RECONCILE', $3, $4,
           '실제 요금 잠정 정산으로 예치 부족 외상을 상계', $5)`,
        [
          shortfall.shortfall_id,
          shortfall.user_id,
          -outstandingPoints,
          commandId,
          `provisional:${input.tripId}:revision:${settlement.fare_revision}:escrow-shortfall-reconcile:${shortfall.user_id}`,
        ],
      )
    }
    return 'SETTLED' as const
  })
}

export async function finalizePolicyV2Settlement(input: {
  tripId: string
  idempotencyKey: string
}) {
  if (!isPointRequestUuid(input.tripId) || !isPointRequestUuid(input.idempotencyKey)) {
    throw new CoreError('최종 정산 요청 식별자가 올바르지 않습니다.')
  }
  return inTransaction(async (client) => {
    const settlement = await client.query(
      `SELECT g.status AS trip_status, s.status AS settlement_status,
              s.allocation_policy, s.fare_revision, s.dispute_deadline,
              s.provisional_deadline_command_id, s.finalization_deadline_command_id,
              s.participant_count
       FROM trip_groups g
       JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g, s`,
      [input.tripId],
    )
    const row = settlement.rows[0]
    if (!row || row.trip_status !== 'SETTLEMENT_PENDING' ||
      row.allocation_policy !== 'HOST_APPROVAL_ORDER') {
      return 'SKIPPED' as const
    }
    if (row.settlement_status === 'COMPLETED') return 'SETTLED' as const
    if (row.settlement_status !== 'PROVISIONALLY_SETTLED' ||
      new Date(row.dispute_deadline).getTime() > Date.now()) {
      return 'SKIPPED' as const
    }
    const disputes = await client.query(
      `SELECT d.status, c.command_id
       FROM fare_disputes d
       LEFT JOIN policy_v2_adjustment_commands c ON c.dispute_id = d.dispute_id
       WHERE d.trip_id = $1 AND d.fare_revision = $2
       FOR UPDATE OF d`,
      [input.tripId, row.fare_revision],
    )
    const openDisputeCount = disputes.rows.filter((dispute) => dispute.status === 'OPEN').length
    const resolvedDisputes = disputes.rows.filter((dispute) => dispute.status === 'RESOLVED')
    if (openDisputeCount > 0 || resolvedDisputes.some((dispute) => !dispute.command_id)) {
      return 'SKIPPED' as const
    }

    const existingCommand = await client.query(
      `SELECT command_id FROM system_deadline_commands
       WHERE trip_id = $1 AND fare_revision = $2 AND command_type = 'FINALIZE_SETTLEMENT'
       FOR UPDATE`,
      [input.tripId, row.fare_revision],
    )
    if (existingCommand.rowCount) {
      throw new CoreError('기존 최종 정산 명령이 있어 안전하게 재실행할 수 없습니다.')
    }
    const executionKey = `finalize:${input.tripId}:revision:${row.fare_revision}`
    const command = await client.query(
      `INSERT INTO system_deadline_commands (
         trip_id, fare_revision, command_type, execution_key
       ) VALUES ($1, $2, 'FINALIZE_SETTLEMENT', $3)
       RETURNING command_id`,
      [input.tripId, row.fare_revision, executionKey],
    )
    const commandId = String(command.rows[0]?.command_id ?? '')
    if (!commandId) throw new CoreError('최종 정산 명령을 만들지 못했습니다.')
    const participants = await client.query(
      `SELECT user_id FROM trip_settlement_participants
       WHERE trip_id = $1
       ORDER BY user_id
       FOR UPDATE`,
      [input.tripId],
    )
    if (participants.rowCount !== Number(row.participant_count)) {
      throw new CoreError('최종 정산 참여자 스냅샷이 일치하지 않습니다.')
    }
    await client.query(
      `UPDATE trip_participants SET status = 'COMPLETED', completed_at = now()
       WHERE trip_id = $1 AND user_id = ANY($2::uuid[])
         AND status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')`,
      [input.tripId, participants.rows.map((participant) => participant.user_id)],
    )
    await client.query(
      `UPDATE trip_settlements
       SET status = 'COMPLETED', settlement_idempotency_key = $2,
           settled_at = now(), settled_by_user_id = NULL,
           settlement_mode = 'SYSTEM_FINALIZE',
           finalization_deadline_command_id = $3
       WHERE trip_id = $1 AND status = 'PROVISIONALLY_SETTLED'`,
      [input.tripId, input.idempotencyKey, commandId],
    )
    await client.query(
      `UPDATE trip_groups SET status = 'COMPLETED', updated_at = now()
       WHERE trip_id = $1`,
      [input.tripId],
    )
    return 'SETTLED' as const
  })
}

export async function createTrip(input: {
  actorId: string
  origin: string
  originLatitude: number
  originLongitude: number
  originProvider: RoutingProvider
  originProviderPlaceId: string
  originSelectionToken: string
  destination: string
  destinationLatitude: number
  destinationLongitude: number
  destinationProvider: RoutingProvider
  destinationProviderPlaceId: string
  destinationSelectionToken: string
  hostMemo: string
  departureAt: Date
  maxParticipants: number
  idempotencyKey: string
}) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const hostMemo = input.hostMemo.trim() || null
  const replayRows = await sql`
    SELECT trip_id AS "tripId", origin, destination,
           departure_at AS "departureAt",
           max_participants AS "maxParticipants",
           origin_latitude::float8 AS "originLatitude",
           origin_longitude::float8 AS "originLongitude",
           origin_place_provider AS "originProvider",
           origin_provider_place_id AS "originProviderPlaceId",
           destination_latitude::float8 AS "destinationLatitude",
           destination_longitude::float8 AS "destinationLongitude",
           destination_place_provider AS "destinationProvider",
           destination_provider_place_id AS "destinationProviderPlaceId",
           host_memo AS "hostMemo"
    FROM trip_groups
    WHERE host_user_id = ${input.actorId}
      AND creation_idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `
  if (replayRows.length) {
    const row = replayRows[0] as Record<string, unknown>
    const same =
      row.origin === input.origin.trim() &&
      row.destination === input.destination.trim() &&
      Number(row.originLatitude) === input.originLatitude &&
      Number(row.originLongitude) === input.originLongitude &&
      row.originProvider === input.originProvider &&
      row.originProviderPlaceId === input.originProviderPlaceId.trim() &&
      Number(row.destinationLatitude) === input.destinationLatitude &&
      Number(row.destinationLongitude) === input.destinationLongitude &&
      row.destinationProvider === input.destinationProvider &&
      row.destinationProviderPlaceId === input.destinationProviderPlaceId.trim() &&
      (row.hostMemo ?? null) === hostMemo &&
      new Date(String(row.departureAt)).getTime() === input.departureAt.getTime() &&
      Number(row.maxParticipants) === input.maxParticipants
    if (!same) throw new CoreError('이미 사용한 요청 식별자입니다. 페이지를 새로 열어 다시 시도해 주세요.')
    return String(row.tripId)
  }

  const originPlace = {
    label: input.origin.trim(),
    latitude: input.originLatitude,
    longitude: input.originLongitude,
    provider: input.originProvider,
    providerPlaceId: input.originProviderPlaceId.trim(),
  }
  const destinationPlace = {
    label: input.destination.trim(),
    latitude: input.destinationLatitude,
    longitude: input.destinationLongitude,
    provider: input.destinationProvider,
    providerPlaceId: input.destinationProviderPlaceId.trim(),
  }
  if (
    !verifyPlaceSelectionToken(input.originSelectionToken, originPlace, input.actorId) ||
    !verifyPlaceSelectionToken(
      input.destinationSelectionToken,
      destinationPlace,
      input.actorId,
    )
  ) {
    throw new CoreError('장소 검색 결과가 만료되었거나 변경되었습니다. 다시 검색해 선택해 주세요.')
  }

  let estimate
  try {
    estimate = await estimateRoute(
      { latitude: input.originLatitude, longitude: input.originLongitude },
      { latitude: input.destinationLatitude, longitude: input.destinationLongitude },
    )
  } catch (error) {
    if (error instanceof RoutingError && error.code === 'NOT_CONFIGURED') {
      throw new CoreError('지도 API가 아직 설정되지 않아 방을 만들 수 없습니다.')
    }
    throw new CoreError('경로와 예상 요금을 다시 확인하지 못했습니다.')
  }
  if (estimate.estimatedFareWon === null) {
    throw new CoreError('지도 API가 예상 택시요금을 제공하지 않아 방을 만들 수 없습니다.')
  }

  return inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT trip_id, origin, destination, departure_at, max_participants,
              origin_latitude, origin_longitude, origin_place_provider,
              origin_provider_place_id, destination_latitude,
              destination_longitude, destination_place_provider,
              destination_provider_place_id, host_memo
       FROM trip_groups
       WHERE host_user_id = $1 AND creation_idempotency_key = $2`,
      [input.actorId, input.idempotencyKey],
    )
    if (existing.rowCount) {
      const row = existing.rows[0]
      const same =
        row.origin === input.origin.trim() &&
        row.destination === input.destination.trim() &&
        Number(row.origin_latitude) === input.originLatitude &&
        Number(row.origin_longitude) === input.originLongitude &&
        row.origin_place_provider === input.originProvider &&
        row.origin_provider_place_id === input.originProviderPlaceId.trim() &&
        Number(row.destination_latitude) === input.destinationLatitude &&
        Number(row.destination_longitude) === input.destinationLongitude &&
        row.destination_place_provider === input.destinationProvider &&
        row.destination_provider_place_id === input.destinationProviderPlaceId.trim() &&
        (row.host_memo ?? null) === hostMemo &&
        new Date(row.departure_at).getTime() === input.departureAt.getTime() &&
        Number(row.max_participants) === input.maxParticipants
      if (!same) {
        throw new CoreError('이미 사용한 요청 식별자입니다. 페이지를 새로 열어 다시 시도해 주세요.')
      }
      return row.trip_id as string
    }

    const actor = await client.query(
      `SELECT 1 FROM users WHERE user_id = $1 AND account_status = 'ACTIVE'
       AND btrim(student_id) <> '' AND btrim(name) <> ''
       AND btrim(school_email) <> '' FOR UPDATE`,
      [input.actorId],
    )
    if (!actor.rowCount) throw new CoreError('가입 필수 정보를 완료한 사용자만 방을 만들 수 있습니다.')

    await assertPolicyV2UsageEligibleForWrite(client, input.actorId)

    const created = await client.query(
      `INSERT INTO trip_groups (
         host_user_id, origin, destination,
         origin_latitude, origin_longitude, origin_location_source,
         origin_place_provider, origin_provider_place_id,
         destination_latitude, destination_longitude, destination_location_source,
         destination_place_provider, destination_provider_place_id,
         host_memo, departure_at, max_participants, estimated_fare, creation_idempotency_key
       ) VALUES (
         $1,$2,$3,$4,$5,'SEARCH',$6,$7,$8,$9,'SEARCH',$10,$11,$12,$13,$14,$15,$16
       ) RETURNING trip_id, location_revision`,
      [
        input.actorId, input.origin.trim(), input.destination.trim(),
        input.originLatitude, input.originLongitude, input.originProvider,
        input.originProviderPlaceId.trim(), input.destinationLatitude,
        input.destinationLongitude, input.destinationProvider,
        input.destinationProviderPlaceId.trim(), hostMemo, input.departureAt,
        input.maxParticipants, estimate.estimatedFareWon, input.idempotencyKey,
      ],
    )
    const tripId = created.rows[0].trip_id as string
    const fare = await client.query(
      `INSERT INTO fare_estimates (
         trip_id, trip_location_revision, route_calculation_id,
         fare_calculation_id, provider_key, route_distance_m, duration_seconds,
         estimated_fare_won, deposit_points_total, fare_source,
         pricing_policy_key, pricing_policy_version, calculated_at, expires_at,
         request_trace_id, request_fingerprint, calculation_basis, idempotency_key
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17
       ) RETURNING fare_estimate_id`,
      [
        tripId, created.rows[0].location_revision, estimate.routeCalculationId,
        estimate.fareCalculationId, estimate.provider, estimate.distanceMeters,
        estimate.durationSeconds, estimate.estimatedFareWon, estimate.fareSource,
        estimate.pricingPolicyKey, estimate.pricingPolicyVersion,
        estimate.calculatedAt, estimate.expiresAt, estimate.requestTraceId,
        estimate.requestFingerprint, JSON.stringify(estimate.calculationBasis),
        input.idempotencyKey,
      ],
    )
    await client.query(
      `UPDATE trip_groups SET current_fare_estimate_id = $2 WHERE trip_id = $1`,
      [tripId, fare.rows[0].fare_estimate_id],
    )
    await client.query(
      `INSERT INTO trip_participants
         (trip_id, user_id, role, status, approved_at)
       VALUES ($1, $2, 'HOST', 'APPROVED', now())`,
      [tripId, input.actorId],
    )
    return tripId
  })
}


export async function applyToTrip(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    const replay = await client.query(
      `SELECT trip_id
       FROM trip_participants
       WHERE user_id = $1 AND application_idempotency_key = $2`,
      [actorId, idempotencyKey],
    )
    if (replay.rowCount) {
      if (replay.rows[0].trip_id === tripId) return
      throw new CoreError('이미 다른 참여 신청에 사용한 요청 식별자입니다.')
    }

    const trip = await client.query(
      `SELECT host_user_id, status, departure_at
       FROM trip_groups WHERE trip_id = $1 FOR UPDATE`,
      [tripId],
    )
    if (!trip.rowCount) throw new CoreError('방을 찾을 수 없습니다.')
    const row = trip.rows[0]
    if (row.host_user_id === actorId) throw new CoreError('자신의 방에는 신청할 수 없습니다.')
    if (row.status !== 'OPEN' || new Date(row.departure_at) <= new Date()) {
      throw new CoreError('모집 중인 방에만 신청할 수 있습니다.')
    }
    const actor = await client.query(
      `SELECT 1
       FROM users
       WHERE user_id = $1
         AND account_status = 'ACTIVE'
         AND btrim(student_id) <> ''
         AND btrim(name) <> ''
         AND btrim(school_email) <> ''
       FOR UPDATE`,
      [actorId],
    )
    if (!actor.rowCount) {
      throw new CoreError('가입 필수 정보를 완료한 사용자만 참여할 수 있습니다.')
    }
    const blocked = await client.query(
      `SELECT 1
       FROM trip_participants existing
       JOIN user_blocks b ON (
         (b.blocker_user_id = $2 AND b.blocked_user_id = existing.user_id)
         OR (b.blocker_user_id = existing.user_id AND b.blocked_user_id = $2)
       )
       WHERE existing.trip_id = $1
         AND existing.user_id <> $2
         AND existing.status IN (
           'APPROVED', 'DEPOSITED', 'CHECKED_IN',
           'NO_SHOW', 'DISPUTED', 'COMPLETED'
         )
       LIMIT 1`,
      [tripId, actorId],
    )
    if (blocked.rowCount) {
      throw new CoreError('차단 관계가 있는 사용자와는 새 동승을 신청할 수 없습니다.')
    }
    await assertPolicyV2UsageEligibleForWrite(client, actorId)
    const inserted = await client.query(
      `INSERT INTO trip_participants
         (trip_id, user_id, role, status, application_idempotency_key)
       VALUES ($1, $2, 'MEMBER', 'APPLIED', $3)
       ON CONFLICT (trip_id, user_id) DO NOTHING
       RETURNING user_id`,
      [tripId, actorId, idempotencyKey],
    )
    if (!inserted.rowCount) {
      throw new CoreError('이미 이 방에 참여 신청했거나 참여한 사용자입니다.')
    }
  })
}

export async function approveParticipant(input: {
  actorId: string
  tripId: string
  participantId: string
  idempotencyKey: string
}) {
  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT host_user_id, status, max_participants,
              departure_at > now() AS departure_open
       FROM trip_groups WHERE trip_id = $1 FOR UPDATE`,
      [input.tripId],
    )
    const row = trip.rows[0]
    if (!row || row.host_user_id !== input.actorId) throw new CoreError('방장만 승인할 수 있습니다.')
    const replay = await client.query(
      `SELECT user_id
       FROM trip_participants
       WHERE trip_id = $1 AND approval_idempotency_key = $2`,
      [input.tripId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      if (replay.rows[0].user_id === input.participantId) return
      throw new CoreError('이미 다른 승인에 사용한 요청 식별자입니다.')
    }
    if (row.status !== 'OPEN' || !row.departure_open) {
      throw new CoreError('출발 전 모집 중인 방에서만 승인할 수 있습니다.')
    }
    const participantUser = await client.query(
      `SELECT 1
       FROM users
       WHERE user_id = $1
         AND account_status = 'ACTIVE'
         AND btrim(student_id) <> ''
         AND btrim(name) <> ''
         AND btrim(school_email) <> ''
       FOR SHARE`,
      [input.participantId],
    )
    if (!participantUser.rowCount) {
      throw new CoreError('가입 정보가 완료된 활성 사용자만 승인할 수 있습니다.')
    }
    const blocked = await client.query(
      `SELECT 1
       FROM trip_participants existing
       JOIN user_blocks b ON (
         (b.blocker_user_id = $2 AND b.blocked_user_id = existing.user_id)
         OR (b.blocker_user_id = existing.user_id AND b.blocked_user_id = $2)
       )
       WHERE existing.trip_id = $1
         AND existing.user_id <> $2
         AND existing.status IN (
           'APPROVED', 'DEPOSITED', 'CHECKED_IN',
           'NO_SHOW', 'DISPUTED', 'COMPLETED'
         )
       LIMIT 1`,
      [input.tripId, input.participantId],
    )
    if (blocked.rowCount) {
      throw new CoreError('차단 관계가 있는 사용자는 참여 승인할 수 없습니다.')
    }
    const count = await client.query(
      `SELECT count(*)::int AS count FROM trip_participants
       WHERE trip_id = $1 AND status IN ('APPROVED', 'DEPOSITED', 'COMPLETED')`,
      [input.tripId],
    )
    if (count.rows[0].count >= row.max_participants) throw new CoreError('최대 인원에 도달했습니다.')
    const updated = await client.query(
      `UPDATE trip_participants
       SET status = 'APPROVED', approved_at = now(), approval_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2 AND role = 'MEMBER'
         AND status = 'APPLIED'
       RETURNING user_id`,
      [input.tripId, input.participantId, input.idempotencyKey],
    )
    if (!updated.rowCount) {
      throw new CoreError('승인 대상을 확인해주세요.')
    }
  })
}

export async function closeTrip(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT host_user_id, status, departure_at > now() AS departure_open,
              close_idempotency_key
       FROM trip_groups
       WHERE trip_id = $1
       FOR UPDATE`,
      [tripId],
    )
    const row = trip.rows[0]
    if (!row || row.host_user_id !== actorId) {
      throw new CoreError('방장만 모집을 종료할 수 있습니다.')
    }
    if (row.status !== 'OPEN' && row.close_idempotency_key === idempotencyKey) return
    if (row.status !== 'OPEN') throw new CoreError('모집 중인 방만 종료할 수 있습니다.')
    if (!row.departure_open) {
      throw new CoreError('출발 시각이 지난 모집은 자동 종료 대상입니다.')
    }

    const participants = await client.query(
      `SELECT count(*)::int AS count
       FROM trip_participants
       WHERE trip_id = $1
         AND status IN ('APPROVED', 'DEPOSITED', 'CHECKED_IN', 'COMPLETED')`,
      [tripId],
    )
    const nextStatus = resolveTripClosureStatus(
      Number(participants.rows[0].count),
    )
    await client.query(
      `UPDATE trip_groups
       SET status = $2,
           closed_at = now(),
           closure_type = 'HOST',
           close_idempotency_key = $3
       WHERE trip_id = $1`,
      [tripId, nextStatus, idempotencyKey],
    )
  })
}

export async function cancelTrip(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT host_user_id, status, departure_at > now() AS departure_open,
              cancellation_idempotency_key
       FROM trip_groups
       WHERE trip_id = $1
       FOR UPDATE`,
      [tripId],
    )
    const row = trip.rows[0]
    if (!row || row.host_user_id !== actorId) {
      throw new CoreError('방장만 모집을 취소할 수 있습니다.')
    }
    if (
      row.status === 'CANCELLED' &&
      row.cancellation_idempotency_key === idempotencyKey
    ) {
      return
    }
    if (row.status !== 'OPEN') {
      throw new CoreError('모집 중이며 예치 전인 방만 취소할 수 있습니다.')
    }
    if (!row.departure_open) {
      throw new CoreError('출발 시각이 지난 모집은 취소할 수 없습니다.')
    }
    const deposits = await client.query(
      `SELECT 1 FROM trip_deposits WHERE trip_id = $1 LIMIT 1 FOR SHARE`,
      [tripId],
    )
    if (deposits.rowCount) {
      throw new CoreError(
        '예치가 완료된 모집은 취소할 수 없습니다. 확정 인원은 최종 정산까지 유지됩니다.',
      )
    }
    await client.query(
      `UPDATE trip_participants
       SET status = 'CANCELLED', cancelled_at = now(),
           cancellation_idempotency_key = $2
       WHERE trip_id = $1 AND status IN ('APPLIED', 'APPROVED')`,
      [tripId, idempotencyKey],
    )
    await client.query(
      `UPDATE trip_groups
       SET status = 'CANCELLED',
           closed_at = now(),
           closure_type = 'CANCELLED',
           cancelled_at = now(),
           cancellation_idempotency_key = $3
       WHERE trip_id = $1 AND host_user_id = $2`,
      [tripId, actorId, idempotencyKey],
    )
  })
}

export async function cancelParticipation(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    const participant = await client.query(
      `SELECT g.status AS trip_status, g.departure_at > now() AS departure_open,
              p.role, p.status, p.cancellation_idempotency_key,
              EXISTS (
                SELECT 1 FROM trip_deposits d
                WHERE d.trip_id = p.trip_id AND d.user_id = p.user_id
              ) AS has_deposit
       FROM trip_groups g
       JOIN trip_participants p ON p.trip_id = g.trip_id
       WHERE g.trip_id = $1 AND p.user_id = $2
       FOR UPDATE OF g, p`,
      [tripId, actorId],
    )
    const row = participant.rows[0]
    if (!row || row.role !== 'MEMBER') {
      throw new CoreError('참여 중인 사용자만 참여를 취소할 수 있습니다.')
    }
    if (
      row.status === 'CANCELLED' &&
      row.cancellation_idempotency_key === idempotencyKey
    ) {
      return
    }
    if (row.trip_status !== 'OPEN' || !row.departure_open) {
      throw new CoreError('모집 중이며 출발 전인 방에서만 참여를 취소할 수 있습니다.')
    }
    if (!['APPLIED', 'APPROVED'].includes(row.status) || row.has_deposit) {
      throw new CoreError(
        '예치 전 신청 또는 승인 상태만 취소할 수 있습니다. 예치 후 취소는 취소 정책 결정이 필요합니다.',
      )
    }
    const cancelled = await client.query(
      `UPDATE trip_participants
       SET status = 'CANCELLED', cancelled_at = now(),
           cancellation_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2
         AND status IN ('APPLIED', 'APPROVED')
       RETURNING user_id`,
      [tripId, actorId, idempotencyKey],
    )
    if (!cancelled.rowCount) {
      throw new CoreError('참여 취소 대상을 다시 확인해 주세요.')
    }
  })
}

export async function closeDueTrips() {
  return inTransaction(async (client) => {
    const result = await client.query(
      `WITH due AS (
         SELECT g.trip_id
         FROM trip_groups g
         WHERE g.status IN ('OPEN', 'CLOSED')
           AND g.departure_at <= clock_timestamp()
           AND NOT EXISTS (
             SELECT 1 FROM trip_deposits d WHERE d.trip_id = g.trip_id
           )
         ORDER BY g.departure_at
         LIMIT 100
         FOR UPDATE OF g SKIP LOCKED
       )
       UPDATE trip_groups g
       SET status = 'EXPIRED',
           closed_at = COALESCE(g.closed_at, now()),
           closure_type = COALESCE(g.closure_type, 'AUTO')
       FROM due
       WHERE g.trip_id = due.trip_id
       RETURNING g.trip_id`,
    )
    return result.rowCount ?? 0
  })
}

export async function confirmTripAndDeposit(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const snapshots = await sql`
    SELECT host_user_id AS "hostUserId", status,
           confirmation_idempotency_key AS "confirmationIdempotencyKey",
           departure_at AS "departureAt",
           location_revision AS "locationRevision",
           origin_latitude::float8 AS "originLatitude",
           origin_longitude::float8 AS "originLongitude",
           destination_latitude::float8 AS "destinationLatitude",
           destination_longitude::float8 AS "destinationLongitude"
    FROM trip_groups WHERE trip_id = ${tripId} LIMIT 1
  `
  const snapshot = snapshots[0] as
    | {
        hostUserId: string
        status: string
        confirmationIdempotencyKey: string | null
        departureAt: string
        locationRevision: string
        originLatitude: number | null
        originLongitude: number | null
        destinationLatitude: number | null
        destinationLongitude: number | null
      }
    | undefined
  if (!snapshot || snapshot.hostUserId !== actorId) {
    throw new CoreError('방장만 모집을 확정할 수 있습니다.')
  }
  if (
    snapshot.status === 'CONFIRMED' &&
    snapshot.confirmationIdempotencyKey === idempotencyKey
  ) return
  if (snapshot.status !== 'CLOSED') {
    throw new CoreError('종료된 모집만 확정할 수 있습니다.')
  }
  if (new Date(snapshot.departureAt) <= new Date()) {
    throw new CoreError('출발 시각이 지나 모집을 확정할 수 없습니다.')
  }
  if (
    snapshot.originLatitude === null ||
    snapshot.originLongitude === null ||
    snapshot.destinationLatitude === null ||
    snapshot.destinationLongitude === null
  ) {
    throw new CoreError('저장된 장소 좌표가 없어 예상 요금을 다시 산정할 수 없습니다.')
  }
  let refreshedEstimate
  try {
    refreshedEstimate = await estimateRoute(
      {
        latitude: snapshot.originLatitude,
        longitude: snapshot.originLongitude,
      },
      {
        latitude: snapshot.destinationLatitude,
        longitude: snapshot.destinationLongitude,
      },
    )
  } catch {
    throw new CoreError('확정 직전 예상 요금을 다시 산정하지 못했습니다.')
  }
  if (refreshedEstimate.estimatedFareWon === null) {
    throw new CoreError('지도 API가 예상 택시요금을 제공하지 않아 모집을 확정할 수 없습니다.')
  }

  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT
         g.host_user_id,
         g.status,
         g.departure_at,
         g.estimated_fare,
         g.max_participants,
         g.confirmation_idempotency_key,
         g.current_fare_estimate_id,
         g.location_revision,
         f.trip_location_revision AS estimate_location_revision,
         f.deposit_points_total,
         f.expires_at AS estimate_expires_at
       FROM trip_groups g
       LEFT JOIN fare_estimates f
         ON f.trip_id = g.trip_id
        AND f.fare_estimate_id = g.current_fare_estimate_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g`,
      [tripId],
    )
    const row = trip.rows[0]
    if (
      row &&
      row.host_user_id === actorId &&
      row.status === 'CLOSED'
    ) {
      if (new Date(row.departure_at) <= new Date()) {
        throw new CoreError('출발 시각이 지나 모집을 확정할 수 없습니다.')
      }
      if (row.location_revision !== snapshot.locationRevision) {
        throw new CoreError('장소가 변경되었습니다. 예상 요금을 다시 확인해 주세요.')
      }
      const fare = await client.query(
        `INSERT INTO fare_estimates (
           trip_id, trip_location_revision, route_calculation_id,
           fare_calculation_id, provider_key, route_distance_m, duration_seconds,
           estimated_fare_won, deposit_points_total, fare_source,
           pricing_policy_key, pricing_policy_version, calculated_at, expires_at,
           request_trace_id, request_fingerprint, calculation_basis, idempotency_key
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17
         ) RETURNING fare_estimate_id`,
        [
          tripId, row.location_revision, refreshedEstimate.routeCalculationId,
          refreshedEstimate.fareCalculationId, refreshedEstimate.provider,
          refreshedEstimate.distanceMeters, refreshedEstimate.durationSeconds,
          refreshedEstimate.estimatedFareWon, refreshedEstimate.fareSource,
          refreshedEstimate.pricingPolicyKey, refreshedEstimate.pricingPolicyVersion,
          refreshedEstimate.calculatedAt, refreshedEstimate.expiresAt,
          refreshedEstimate.requestTraceId, refreshedEstimate.requestFingerprint,
          JSON.stringify(refreshedEstimate.calculationBasis), idempotencyKey,
        ],
      )
      await client.query(
        `UPDATE trip_groups
         SET current_fare_estimate_id = $2, estimated_fare = $3
         WHERE trip_id = $1`,
        [tripId, fare.rows[0].fare_estimate_id, refreshedEstimate.estimatedFareWon],
      )
      row.current_fare_estimate_id = fare.rows[0].fare_estimate_id
      row.estimated_fare = refreshedEstimate.estimatedFareWon
      row.deposit_points_total = refreshedEstimate.estimatedFareWon
      row.estimate_location_revision = row.location_revision
      row.estimate_expires_at = refreshedEstimate.expiresAt
    }
    if (!row || row.host_user_id !== actorId) throw new CoreError('방장만 모집을 확정할 수 있습니다.')
    if (row.status === 'CONFIRMED' && row.confirmation_idempotency_key === idempotencyKey) return
    if (row.status !== 'CLOSED') throw new CoreError('종료된 모집만 확정할 수 있습니다.')
    if (
      row.current_fare_estimate_id === null ||
      row.estimated_fare === null ||
      row.deposit_points_total === null
    ) {
      throw new CoreError('지도 기반 예상 요금 산정 후 모집을 확정할 수 있습니다.')
    }
    if (
      row.location_revision !== row.estimate_location_revision ||
      Number(row.estimated_fare) !== Number(row.deposit_points_total)
    ) {
      throw new CoreError('장소 또는 예상 요금이 변경되었습니다. 요금을 다시 산정해주세요.')
    }
    if (new Date(row.estimate_expires_at) <= new Date()) {
      throw new CoreError('예상 요금이 만료되었습니다. 요금을 다시 산정해주세요.')
    }

    const participants = await client.query(
      `SELECT user_id FROM trip_participants
       WHERE trip_id = $1 AND status = 'APPROVED'
       ORDER BY user_id FOR UPDATE`,
      [tripId],
    )
    const participantCount = participants.rows.length
    if (participantCount < 2 || participantCount > row.max_participants) {
      throw new CoreError('승인된 인원이 2~최대 인원일 때만 확정할 수 있습니다.')
    }
    const userIds = participants.rows.map((item) => item.user_id as string)
    const eligibleUsers = await client.query(
      `SELECT user_id
       FROM users
       WHERE user_id = ANY($1::uuid[])
         AND account_status = 'ACTIVE'
         AND nullif(btrim(student_id), '') IS NOT NULL
         AND nullif(btrim(name), '') IS NOT NULL
         AND nullif(btrim(school_email), '') IS NOT NULL
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    if (eligibleUsers.rowCount !== userIds.length) {
      throw new CoreError(
        '모든 확정 참여자가 가입 정보가 완료된 활성 사용자여야 합니다.',
      )
    }
    const deposit = Math.ceil(row.estimated_fare / participantCount)
    const balances = await client.query(
      `SELECT user_id, available_points
       FROM point_accounts
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    if (
      balances.rowCount !== userIds.length ||
      balances.rows.some((balance) =>
        !Number.isSafeInteger(Number(balance.available_points)) ||
        Number(balance.available_points) < 0,
      )
    ) {
      throw new CoreError(`모든 확정 참여자에게 ${deposit.toLocaleString()}P 이상이 필요합니다.`)
    }

    const availableByUser = new Map(
      balances.rows.map((balance) => [
        String(balance.user_id),
        Number(balance.available_points),
      ]),
    )

    for (const participantId of userIds) {
      const availablePoints = availableByUser.get(participantId)
      if (availablePoints === undefined) {
        throw new CoreError('확정 참여자의 포인트 계정을 찾을 수 없습니다.')
      }
      const heldPoints = Math.min(availablePoints, deposit)
      const shortfallPoints = deposit - heldPoints
      await client.query(
        `INSERT INTO trip_deposits (trip_id, user_id, amount)
         VALUES ($1, $2, $3)`,
        [tripId, participantId, heldPoints],
      )
      if (heldPoints > 0) {
        await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, '예상 요금 예치', $6)`,
        [participantId, -heldPoints, heldPoints, tripId, actorId, `trip:${tripId}:deposit:${participantId}`],
        )
      }
      if (shortfallPoints > 0) {
        const shortfall = await client.query(
          `INSERT INTO trip_escrow_shortfalls (
             trip_id, user_id, expected_deposit_points
           ) VALUES ($1, $2, $3)
           RETURNING shortfall_id`,
          [tripId, participantId, deposit],
        )
        const shortfallId = shortfall.rows[0]?.shortfall_id as string | undefined
        if (!shortfallId) {
          throw new CoreError('예치 부족 외상 기록을 만들 수 없습니다.')
        }
        await client.query(
          `INSERT INTO trip_escrow_shortfall_events (
             shortfall_id, user_id, event_type, points_delta, actor_user_id,
             reason, idempotency_key
           ) VALUES ($1, $2, 'INCUR', $3, $4, '예상 요금 예치 부족분', $5)`,
          [
            shortfallId,
            participantId,
            shortfallPoints,
            actorId,
            `trip:${tripId}:escrow-shortfall:${participantId}`,
          ],
        )
      }
    }
    await client.query(
      `UPDATE trip_participants SET status = 'DEPOSITED', deposited_at = now()
       WHERE trip_id = $1 AND status = 'APPROVED'`,
      [tripId],
    )
    await client.query(
      `UPDATE trip_groups
       SET status = 'CONFIRMED', confirmation_idempotency_key = $2
       WHERE trip_id = $1`,
      [tripId, idempotencyKey],
    )
  })
}

export type OpenPointDebtForRepayment = {
  debtId: string
  tripId: string
  outstandingPoints: number
}

export type PlannedDebtRepayment = {
  debtId: string
  tripId: string
  amount: number
}

/**
 * Allocates an already-approved virtual point grant to debts in the same order
 * as the database lock/query: oldest obligation first, then debt ID.
 */
export function allocateOldestDebtRepayment(
  amount: number,
  debts: readonly OpenPointDebtForRepayment[],
) {
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new CoreError('외상 상환에 사용할 포인트는 양의 정수여야 합니다.')
  }

  let remainingPoints = amount
  const repayments: PlannedDebtRepayment[] = []
  for (const debt of debts) {
    if (
      !debt.debtId ||
      !debt.tripId ||
      !Number.isSafeInteger(debt.outstandingPoints) ||
      debt.outstandingPoints < 1
    ) {
      throw new CoreError('상환할 외상 정보가 올바르지 않습니다.')
    }
    if (remainingPoints === 0) break

    const repayment = Math.min(remainingPoints, debt.outstandingPoints)
    repayments.push({
      debtId: debt.debtId,
      tripId: debt.tripId,
      amount: repayment,
    })
    remainingPoints -= repayment
  }

  return { repayments, remainingPoints }
}

async function lockOpenPointDebtsForRepayment(client: PoolClient, userId: string) {
  const account = await client.query(
    `SELECT user_id
     FROM point_accounts
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  )
  if (!account.rowCount) {
    throw new CoreError('지급 대상의 포인트 계정을 찾을 수 없습니다.')
  }

  const debts = await client.query(
    `SELECT
       debt_id AS "debtId",
       trip_id AS "tripId",
       outstanding_points AS "outstandingPoints"
     FROM point_debt_obligations
     WHERE user_id = $1 AND status = 'OPEN'
     ORDER BY created_at ASC, debt_id ASC
     FOR UPDATE`,
    [userId],
  )
  return debts.rows.map((debt) => ({
    debtId: debt.debtId as string,
    tripId: debt.tripId as string,
    outstandingPoints: Number(debt.outstandingPoints),
  })) satisfies OpenPointDebtForRepayment[]
}

async function repayOpenPointDebtsFromGrant(
  client: PoolClient,
  input: {
    userId: string
    adminId: string
    amount: number
    reason: string
    grantIdempotencyKey: string
    lockedDebts: readonly OpenPointDebtForRepayment[]
    grantExecutionRequestId: string | null
  },
) {
  const plan = allocateOldestDebtRepayment(input.amount, input.lockedDebts)
  for (const repayment of plan.repayments) {
    const repaymentReason = `관리자 지급 외상 상환: ${input.reason}`
    const ledger = await client.query(
      `INSERT INTO point_ledger (
         user_id, entry_type, available_delta, held_delta, trip_id,
         actor_user_id, reason, idempotency_key
       ) VALUES ($1, 'DEBT_REPAYMENT', $2, 0, $3, $4, $5, $6)
       RETURNING ledger_id`,
      [
        input.userId,
        -repayment.amount,
        repayment.tripId,
        input.adminId,
        repaymentReason,
        `${input.grantIdempotencyKey}:debt-ledger:${repayment.debtId}`,
      ],
    )
    const repaymentLedgerId = ledger.rows[0]?.ledger_id as string | undefined
    if (!repaymentLedgerId) {
      throw new CoreError('외상 상환 원장을 기록하지 못했습니다.')
    }
    await client.query(
      `INSERT INTO point_debt_events (
         debt_id, user_id, event_type, debt_delta, actor_user_id, reason,
         idempotency_key, repayment_ledger_id, grant_execution_request_id
       ) VALUES ($1, $2, 'REPAYMENT', $3, $4, $5, $6, $7, $8)`,
      [
        repayment.debtId,
        input.userId,
        -repayment.amount,
        input.adminId,
        repaymentReason,
        `${input.grantIdempotencyKey}:debt-event:${repayment.debtId}`,
        repaymentLedgerId,
        input.grantExecutionRequestId,
      ],
    )
  }
  return plan
}

export async function createPointGrantExecutionRequest(input: {
  adminId: string
  targetUserId: string
  amount: number
  reason: string
  idempotencyKey: string
  purpose?: string
}) {
  if (
    !isPointRequestUuid(input.adminId) ||
    !isPointRequestUuid(input.targetUserId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('포인트 지급 요청 식별자가 올바르지 않습니다.')
  }
  const amount = parsePointAmount(input.amount)
  if (amount === null) {
    throw new CoreError(
      `지급 포인트는 1~${MAX_POINTS.toLocaleString()} 사이의 정수여야 합니다.`,
    )
  }
  const reason = normalizePointReason(input.reason)
  if (!reason) throw new CoreError('지급 사유를 1~200자로 입력해주세요.')
  const purpose = input.purpose ?? 'GENERAL'
  if (!['GENERAL', 'SETTLEMENT_DEBT_REPAYMENT'].includes(purpose)) {
    throw new CoreError('지급 목적이 올바르지 않습니다.')
  }

  return inTransaction(async (client) => {
    const actors = await client.query(
      `SELECT user_id, name, role, account_status
       FROM users
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [[input.adminId, input.targetUserId]],
    )
    const admin = actors.rows.find((row) => row.user_id === input.adminId)
    const target = actors.rows.find((row) => row.user_id === input.targetUserId)
    if (admin?.role !== 'ADMIN' || admin.account_status !== 'ACTIVE') {
      throw new CoreError('활성 관리자만 지급 실행 요청을 만들 수 있습니다.')
    }
    const eligibleTarget =
      target &&
      target.role === 'USER' &&
      target.user_id !== input.adminId &&
      [
        'map api',
        'route api',
        'production verification',
        'production verfication',
      ].includes(String(target.name ?? '').trim().toLowerCase()) === false
    if (!eligibleTarget) {
      throw new CoreError('일반 사용자에게만 지급 실행 요청을 만들 수 있습니다.')
    }
    if (purpose === 'GENERAL' && target.account_status !== 'ACTIVE') {
      throw new CoreError('일반 지급은 활성 사용자에게만 요청할 수 있습니다.')
    }
    if (purpose === 'SETTLEMENT_DEBT_REPAYMENT') {
      const debt = await client.query(
        `SELECT 1
         FROM point_debt_obligations
         WHERE user_id = $1 AND status = 'OPEN'
         FOR SHARE`,
        [input.targetUserId],
      )
      if (target.account_status !== 'SUSPENDED' || !debt.rowCount) {
        throw new CoreError(
          '정산 채무 상환 지원은 미상환 외상이 있는 정지 사용자에게만 요청할 수 있습니다.',
        )
      }
    }

    const inserted = await client.query(
      `INSERT INTO point_grant_execution_requests (
         target_user_id, amount, reason, purpose, requested_by_admin_id, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING execution_request_id`,
      [input.targetUserId, amount, reason, purpose, input.adminId, input.idempotencyKey],
    )
    if (inserted.rowCount) return inserted.rows[0].execution_request_id as string

    const existing = await client.query(
      `SELECT execution_request_id, target_user_id, amount, reason, purpose
       FROM point_grant_execution_requests
       WHERE requested_by_admin_id = $1 AND idempotency_key = $2`,
      [input.adminId, input.idempotencyKey],
    )
    const row = existing.rows[0]
    if (
      !row ||
      row.target_user_id !== input.targetUserId ||
      Number(row.amount) !== amount ||
      row.reason !== reason ||
      row.purpose !== purpose
    ) {
      throw new CoreError(
        '동일한 요청 식별자가 다른 지급 실행 요청에 이미 사용되었습니다.',
      )
    }
    return row.execution_request_id as string
  })
}

export async function requestPoints(input: {
  requesterId: string
  amount: number
  reason: string
  idempotencyKey: string
}) {
  if (
    !isPointRequestUuid(input.requesterId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('포인트 요청 식별자가 올바르지 않습니다.')
  }
  const amount = parsePointAmount(input.amount)
  if (amount === null) {
    throw new CoreError(
      `요청 포인트는 1~${MAX_POINTS.toLocaleString()} 사이의 정수여야 합니다.`,
    )
  }
  const reason = normalizePointReason(input.reason)
  if (!reason) throw new CoreError('요청 사유를 1~200자로 입력해주세요.')

  return inTransaction(async (client) => {
    try {
      await assertNoPendingSuspensionForNewUse(client, input.requesterId)
    } catch (error) {
      throw new CoreError(
        error instanceof Error
          ? error.message
          : '정지 예정 계정은 새 포인트 요청을 할 수 없습니다.',
      )
    }
    const requester = await client.query(
      `SELECT 1
       FROM users
       WHERE user_id = $1
         AND account_status = 'ACTIVE'
         AND role = 'USER'
         AND nullif(btrim(student_id), '') IS NOT NULL
         AND nullif(btrim(name), '') IS NOT NULL
         AND nullif(btrim(school_email), '') IS NOT NULL
       FOR UPDATE`,
      [input.requesterId],
    )
    if (!requester.rowCount) {
      throw new CoreError('가입 정보가 완료된 활성 사용자만 포인트를 요청할 수 있습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO point_grant_requests (
         requester_user_id, requested_amount, reason, idempotency_key
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING request_id`,
      [input.requesterId, amount, reason, input.idempotencyKey],
    )
    if (inserted.rowCount) return inserted.rows[0].request_id as string

    const existing = await client.query(
      `SELECT request_id, requested_amount, reason
       FROM point_grant_requests
       WHERE requester_user_id = $1 AND idempotency_key = $2`,
      [input.requesterId, input.idempotencyKey],
    )
    const row = existing.rows[0]
    if (!row) {
      throw new CoreError(
        '이미 처리 대기 중인 포인트 지급 요청이 있습니다.',
      )
    }
    if (
      Number(row.requested_amount) !== amount ||
      row.reason !== reason
    ) {
      throw new CoreError(
        '동일한 요청 식별자가 다른 포인트 요청에 이미 사용되었습니다.',
      )
    }
    return row.request_id as string
  })
}

export async function preparePointRequestFulfillment(input: {
  adminId: string
  requestId: string
  idempotencyKey: string
}) {
  if (
    !isPointRequestUuid(input.adminId) ||
    !isPointRequestUuid(input.requestId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('포인트 지급 요청 식별자가 올바르지 않습니다.')
  }
  return inTransaction(async (client) => {
    const request = await client.query(
      `SELECT
         request_id,
         requester_user_id,
         requested_amount,
         reason,
         status,
         fulfilled_ledger_id
       FROM point_grant_requests
       WHERE request_id = $1
       FOR UPDATE`,
      [input.requestId],
    )
    const row = request.rows[0]
    if (!row) throw new CoreError('포인트 지급 요청을 찾을 수 없습니다.')
    if (row.status === 'FULFILLED') {
      throw new CoreError('이미 지급이 완료된 요청입니다.')
    }

    const users = await client.query(
      `SELECT user_id, role, account_status
       FROM users
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [[input.adminId, row.requester_user_id]],
    )
    const admin = users.rows.find((user) => user.user_id === input.adminId)
    const target = users.rows.find(
      (user) => user.user_id === row.requester_user_id,
    )
    if (admin?.role !== 'ADMIN' || admin.account_status !== 'ACTIVE') {
      throw new CoreError('활성 관리자만 지급 실행 요청을 만들 수 있습니다.')
    }
    if (
      !target ||
      target.account_status !== 'ACTIVE' ||
      target.role !== 'USER' ||
      target.user_id === input.adminId
    ) {
      throw new CoreError('활성 일반 사용자의 요청만 실행 요청으로 만들 수 있습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO point_grant_execution_requests (
       source_point_request_id, target_user_id, amount, reason,
         requested_by_admin_id, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING execution_request_id`,
      [
        input.requestId,
        row.requester_user_id,
        Number(row.requested_amount),
        row.reason,
        input.adminId,
        input.idempotencyKey,
      ],
    )
    if (inserted.rowCount) return inserted.rows[0].execution_request_id as string

    const existing = await client.query(
      `SELECT execution_request_id, source_point_request_id
       FROM point_grant_execution_requests
       WHERE requested_by_admin_id = $1 AND idempotency_key = $2`,
      [input.adminId, input.idempotencyKey],
    )
    const existingRow = existing.rows[0]
    if (
      !existingRow ||
      existingRow.source_point_request_id !== input.requestId
    ) {
      throw new CoreError('이 사용자 요청은 이미 다른 관리자가 지급 실행 요청으로 기안했습니다.')
    }
    return existingRow.execution_request_id as string
  })
}

export async function approvePointGrantExecution(input: {
  adminId: string
  executionRequestId: string
  idempotencyKey: string
}) {
  if (
    !isPointRequestUuid(input.adminId) ||
    !isPointRequestUuid(input.executionRequestId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('포인트 지급 승인 식별자가 올바르지 않습니다.')
  }
  return inTransaction(async (client) => {
    const execution = await client.query(
      `SELECT execution_request_id, requested_by_admin_id
       FROM point_grant_execution_requests
       WHERE execution_request_id = $1
       FOR UPDATE`,
      [input.executionRequestId],
    )
    const executionRow = execution.rows[0]
    if (!executionRow) throw new CoreError('지급 실행 요청을 찾을 수 없습니다.')

    const approver = await client.query(
      `SELECT role, account_status
       FROM users WHERE user_id = $1 FOR UPDATE`,
      [input.adminId],
    )
    if (
      approver.rows[0]?.role !== 'ADMIN' ||
      approver.rows[0]?.account_status !== 'ACTIVE'
    ) {
      throw new CoreError('활성 관리자만 지급 실행 요청을 승인할 수 있습니다.')
    }
    if (executionRow.requested_by_admin_id === input.adminId) {
      throw new CoreError('기안한 지급 실행 요청은 직접 승인할 수 없습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO point_grant_approval_commands (
         execution_request_id, approved_by_admin_id, idempotency_key
       ) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING approval_command_id`,
      [input.executionRequestId, input.adminId, input.idempotencyKey],
    )
    if (inserted.rowCount) return inserted.rows[0].approval_command_id as string

    const existing = await client.query(
      `SELECT approval_command_id, execution_request_id
       FROM point_grant_approval_commands
       WHERE approved_by_admin_id = $1 AND idempotency_key = $2`,
      [input.adminId, input.idempotencyKey],
    )
    const row = existing.rows[0]
    if (!row || row.execution_request_id !== input.executionRequestId) {
      throw new CoreError('동일한 요청 식별자가 다른 지급 승인에 이미 사용되었습니다.')
    }
    return row.approval_command_id as string
  })
}

export async function executePointGrantExecution(input: {
  adminId: string
  executionRequestId: string
}) {
  if (
    !isPointRequestUuid(input.adminId) ||
    !isPointRequestUuid(input.executionRequestId)
  ) {
    throw new CoreError('포인트 지급 실행 식별자가 올바르지 않습니다.')
  }
  return inTransaction(async (client) => {
    const execution = await client.query(
      `SELECT
         e.execution_request_id, e.source_point_request_id, e.target_user_id,
         e.amount, e.reason, e.purpose, e.requested_by_admin_id,
         a.approval_command_id, a.approved_by_admin_id
       FROM point_grant_execution_requests e
       JOIN point_grant_approval_commands a
         ON a.execution_request_id = e.execution_request_id
       WHERE e.execution_request_id = $1
       FOR UPDATE OF e, a`,
      [input.executionRequestId],
    )
    const row = execution.rows[0]
    if (!row) throw new CoreError('승인 완료된 지급 실행 요청을 찾을 수 없습니다.')
    if (row.requested_by_admin_id !== input.adminId) {
      throw new CoreError('기안한 관리자만 승인된 지급을 실행할 수 있습니다.')
    }
    if (row.approved_by_admin_id === input.adminId) {
      throw new CoreError('승인한 관리자는 같은 지급을 실행할 수 없습니다.')
    }

    const actors = await client.query(
      `SELECT user_id, role, account_status
       FROM users WHERE user_id = ANY($1::uuid[]) FOR UPDATE`,
      [[input.adminId, row.target_user_id]],
    )
    const executor = actors.rows.find((user) => user.user_id === input.adminId)
    const target = actors.rows.find((user) => user.user_id === row.target_user_id)
    if (executor?.role !== 'ADMIN' || executor.account_status !== 'ACTIVE') {
      throw new CoreError('활성 관리자만 승인된 지급을 실행할 수 있습니다.')
    }
    const isSettlementDebtRepayment =
      row.purpose === 'SETTLEMENT_DEBT_REPAYMENT'
    if (
      !target ||
      target.role !== 'USER' ||
      (isSettlementDebtRepayment
        ? target.account_status !== 'SUSPENDED'
        : target.account_status !== 'ACTIVE')
    ) {
      throw new CoreError(
        isSettlementDebtRepayment
          ? '정산 채무 상환 지원은 정지 상태의 일반 사용자에게만 실행할 수 있습니다.'
          : '일반 지급은 활성 일반 사용자에게만 실행할 수 있습니다.',
      )
    }

    const ledgerKey = `point-execution:${input.executionRequestId}`
    const lockedDebts = await lockOpenPointDebtsForRepayment(client, row.target_user_id as string)
    if (isSettlementDebtRepayment) {
      const outstanding = lockedDebts.reduce(
        (total, debt) => total + debt.outstandingPoints,
        0,
      )
      if (!outstanding || Number(row.amount) !== outstanding) {
        throw new CoreError(
          '정산 채무 상환 지원 금액은 현재 미상환 외상 전체와 같아야 합니다.',
        )
      }
    }
    const inserted = await client.query(
      `INSERT INTO point_ledger (
         user_id, entry_type, available_delta, held_delta, actor_user_id, reason,
         idempotency_key, point_request_id, grant_execution_request_id,
         grant_approval_command_id
       ) VALUES ($1, 'ADMIN_GRANT', $2, 0, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ledger_id`,
      [
        row.target_user_id,
        Number(row.amount),
        input.adminId,
        row.reason,
        ledgerKey,
        row.source_point_request_id,
        input.executionRequestId,
        row.approval_command_id,
      ],
    )
    let ledgerId = inserted.rows[0]?.ledger_id as string | undefined
    if (ledgerId) {
      await repayOpenPointDebtsFromGrant(client, {
        userId: row.target_user_id as string,
        adminId: input.adminId,
        amount: Number(row.amount),
        reason: row.reason as string,
        grantIdempotencyKey: ledgerKey,
        lockedDebts,
        grantExecutionRequestId: isSettlementDebtRepayment
          ? input.executionRequestId
          : null,
      })
    } else {
      const existing = await client.query(
        `SELECT ledger_id
         FROM point_ledger
         WHERE idempotency_key = $1
           AND grant_execution_request_id = $2
           AND grant_approval_command_id = $3`,
        [ledgerKey, input.executionRequestId, row.approval_command_id],
      )
      ledgerId = existing.rows[0]?.ledger_id as string | undefined
    }
    if (!ledgerId) {
      throw new CoreError('지급 실행의 멱등성 정보가 기존 원장과 일치하지 않습니다.')
    }

    if (row.source_point_request_id) {
      await client.query(
        `UPDATE point_grant_requests
         SET status = 'FULFILLED', fulfilled_by = $2, fulfilled_ledger_id = $3,
             fulfilled_at = now()
         WHERE request_id = $1 AND status = 'PENDING'`,
        [row.source_point_request_id, input.adminId, ledgerId],
      )
    }
    return ledgerId
  })
}

export async function startTrip(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT host_user_id, status, start_idempotency_key
       FROM trip_groups
       WHERE trip_id = $1
       FOR UPDATE`,
      [tripId],
    )
    const row = trip.rows[0]
    if (!row || row.host_user_id !== actorId) {
      throw new CoreError('방장만 이동을 시작할 수 있습니다.')
    }
    if (
      row.status === 'IN_PROGRESS' &&
      row.start_idempotency_key === idempotencyKey
    ) {
      return
    }
    if (row.status !== 'CONFIRMED') {
      throw new CoreError('예치가 완료된 확정 방만 이동을 시작할 수 있습니다.')
    }
    const deposits = await client.query(
      `SELECT count(*)::int AS count
       FROM trip_deposits
       WHERE trip_id = $1`,
      [tripId],
    )
    if (Number(deposits.rows[0].count) < 2) {
      throw new CoreError('예치가 완료된 참여자가 2명 이상이어야 합니다.')
    }
    await client.query(
      `UPDATE trip_groups
       SET status = 'IN_PROGRESS',
           in_progress_at = now(),
           start_idempotency_key = $2
       WHERE trip_id = $1`,
      [tripId, idempotencyKey],
    )
  })
}

export async function setDesignatedFareSubmitter(input: {
  actorId: string
  tripId: string
  submitterId: string | null
  idempotencyKey: string
}) {
  if (
    !isPointRequestUuid(input.actorId) ||
    !isPointRequestUuid(input.tripId) ||
    !isPointRequestUuid(input.idempotencyKey) ||
    (input.submitterId !== null && !isPointRequestUuid(input.submitterId))
  ) {
    throw new CoreError('실제 요금 입력자 지정 요청 식별자가 올바르지 않습니다.')
  }
  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT host_user_id, status, fare_submitter_user_id,
              fare_submitter_set_by, fare_submitter_idempotency_key
       FROM trip_groups
       WHERE trip_id = $1
       FOR UPDATE`,
      [input.tripId],
    )
    const row = trip.rows[0]
    if (!row || row.host_user_id !== input.actorId) {
      throw new CoreError('방장만 실제 요금 입력자를 지정할 수 있습니다.')
    }
    if (
      row.fare_submitter_set_by === input.actorId &&
      row.fare_submitter_idempotency_key === input.idempotencyKey &&
      row.fare_submitter_user_id === input.submitterId
    ) {
      return
    }
    if (row.status !== 'CONFIRMED') {
      throw new CoreError('출발 전 예치가 완료된 확정 방에서만 입력자를 지정할 수 있습니다.')
    }
    if (input.submitterId === input.actorId) {
      throw new CoreError('방장은 기본 실제 요금 입력자이므로 별도 지정할 필요가 없습니다.')
    }
    if (input.submitterId) {
      const participant = await client.query(
        `SELECT 1
         FROM trip_participants p
         JOIN trip_deposits d
           ON d.trip_id = p.trip_id AND d.user_id = p.user_id
         WHERE p.trip_id = $1
           AND p.user_id = $2
           AND p.role = 'MEMBER'
           AND p.status = 'DEPOSITED'
         FOR UPDATE OF p, d`,
        [input.tripId, input.submitterId],
      )
      if (!participant.rowCount) {
        throw new CoreError('예치를 마친 확정 참여자만 실제 요금 입력자로 지정할 수 있습니다.')
      }
    }
    await client.query(
      `UPDATE trip_groups
       SET fare_submitter_user_id = $2,
           fare_submitter_set_by = $3,
           fare_submitter_idempotency_key = $4,
           fare_submitter_set_at = now(),
           updated_at = now()
       WHERE trip_id = $1`,
      [input.tripId, input.submitterId, input.actorId, input.idempotencyKey],
    )
  })
}

export async function checkInParticipant(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    const participant = await client.query(
      `SELECT g.status AS trip_status, p.status, p.check_in_idempotency_key
       FROM trip_groups g
       JOIN trip_participants p
         ON p.trip_id = g.trip_id
        AND p.user_id = $2
       JOIN trip_deposits d
         ON d.trip_id = p.trip_id
        AND d.user_id = p.user_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g, p`,
      [tripId, actorId],
    )
    const row = participant.rows[0]
    if (!row) throw new CoreError('확정 참여자만 체크인할 수 있습니다.')
    if (
      row.status === 'CHECKED_IN' &&
      row.check_in_idempotency_key === idempotencyKey
    ) {
      return
    }
    if (row.trip_status !== 'IN_PROGRESS' || row.status !== 'DEPOSITED') {
      throw new CoreError('이동이 시작된 후 한 번만 체크인할 수 있습니다.')
    }
    await client.query(
      `UPDATE trip_participants
       SET status = 'CHECKED_IN',
           checked_in_at = now(),
           check_in_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2`,
      [tripId, actorId, idempotencyKey],
    )
  })
}

export type TripIncidentType = 'HOST_NO_START' | 'MEMBER_NO_SHOW'
export type TripIncidentReviewCommandType =
  | 'START_REVIEW'
  | 'RESPONSIBILITY_CONFIRMED'
  | 'NOT_ESTABLISHED'

function normalizeTripIncidentDescription(value: string) {
  const description = value.trim()
  if (description.length < 10 || description.length > 2000) {
    throw new CoreError('사건 설명은 10~2,000자로 입력해 주세요.')
  }
  return description
}

function normalizeTripIncidentEvidence(value: string | null | undefined) {
  if (!value?.trim()) return null
  const evidence = value.trim()
  if (evidence.length > 2000) {
    throw new CoreError('증빙 참조는 2,000자 이하여야 합니다.')
  }
  return evidence
}

function normalizeTripIncidentReviewText(
  value: string,
  label: string,
  maximum: number,
) {
  const text = value.trim()
  if (text.length < 10 || text.length > maximum) {
    throw new CoreError(`${label}은(는) 10~${maximum.toLocaleString()}자로 입력해 주세요.`)
  }
  return text
}

/**
 * DEC-015 intake only: an incident report never changes attendance, escrow,
 * ledger, settlement, or eligibility. Those effects require a later,
 * separately audited resolution command.
 */
export async function reportTripIncident(input: {
  reporterId: string
  tripId: string
  reportedUserId: string
  incidentType: TripIncidentType
  description: string
  evidenceRef?: string | null
  idempotencyKey: string
}) {
  const description = normalizeTripIncidentDescription(input.description)
  const evidenceRef = normalizeTripIncidentEvidence(input.evidenceRef)

  return inTransaction(async (client) => {
    const replay = await client.query(
      `SELECT incident_id, trip_id, reported_user_id, incident_type,
              description, evidence_ref
       FROM trip_incidents
       WHERE reporter_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.reporterId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      const same =
        existing.trip_id === input.tripId &&
        existing.reported_user_id === input.reportedUserId &&
        existing.incident_type === input.incidentType &&
        existing.description === description &&
        (existing.evidence_ref ?? null) === evidenceRef
      if (!same) {
        throw new CoreError('이미 다른 사건 접수에 사용한 요청 식별자입니다.')
      }
      return String(existing.incident_id)
    }

    const context = await client.query(
      `SELECT g.host_user_id, g.status AS trip_status,
              g.departure_at <= clock_timestamp() AS departure_due,
              reporter.role AS reporter_role, reporter.status AS reporter_status,
              reported.role AS reported_role, reported.status AS reported_status
       FROM trip_groups g
       JOIN trip_participants reporter
         ON reporter.trip_id = g.trip_id AND reporter.user_id = $2
       JOIN trip_participants reported
         ON reported.trip_id = g.trip_id AND reported.user_id = $3
       JOIN trip_deposits reporter_deposit
         ON reporter_deposit.trip_id = reporter.trip_id
        AND reporter_deposit.user_id = reporter.user_id
       JOIN trip_deposits reported_deposit
         ON reported_deposit.trip_id = reported.trip_id
        AND reported_deposit.user_id = reported.user_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g, reporter, reported`,
      [input.tripId, input.reporterId, input.reportedUserId],
    )
    const row = context.rows[0]
    if (!row || input.reporterId === input.reportedUserId) {
      throw new CoreError('확정 참여자만 다른 참여자에 대한 사건을 접수할 수 있습니다.')
    }

    const reporterEligible = ['DEPOSITED', 'CHECKED_IN'].includes(
      String(row.reporter_status),
    )
    if (!reporterEligible) {
      throw new CoreError('예치를 마친 확정 참여자만 사건을 접수할 수 있습니다.')
    }

    if (input.incidentType === 'HOST_NO_START') {
      if (
        row.trip_status !== 'CONFIRMED' ||
        row.departure_due !== true ||
        row.reporter_role === 'HOST' ||
        row.reported_role !== 'HOST'
      ) {
        throw new CoreError('출발 시각 이후, 시작하지 않은 방의 방장만 미출발로 신고할 수 있습니다.')
      }
    } else if (
      row.trip_status !== 'IN_PROGRESS' ||
      row.reported_role === 'HOST' ||
      row.reported_status !== 'DEPOSITED'
    ) {
      throw new CoreError('이동 중인 방의 미체크인 참여자만 노쇼로 신고할 수 있습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO trip_incidents (
         trip_id, reporter_user_id, reported_user_id, incident_type,
         description, evidence_ref, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING incident_id`,
      [
        input.tripId,
        input.reporterId,
        input.reportedUserId,
        input.incidentType,
        description,
        evidenceRef,
        input.idempotencyKey,
      ],
    )
    return String(inserted.rows[0].incident_id)
  })
}

/**
 * DEC-015 rebuttal: the reported participant may add exactly one immutable
 * statement. It never changes trip, participant, escrow, ledger, or settlement
 * data. A confirmation of responsibility is blocked until this record exists.
 */
export async function submitTripIncidentRebuttal(input: {
  authorId: string
  incidentId: string
  statement: string
  evidenceRef?: string | null
  idempotencyKey: string
}) {
  const statement = normalizeTripIncidentDescription(input.statement)
  const evidenceRef = normalizeTripIncidentEvidence(input.evidenceRef)

  return inTransaction(async (client) => {
    const replay = await client.query(
      `SELECT incident_id, statement, evidence_ref
       FROM trip_incident_rebuttals
       WHERE author_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.authorId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (
        existing.incident_id !== input.incidentId ||
        existing.statement !== statement ||
        (existing.evidence_ref ?? null) !== evidenceRef
      ) {
        throw new CoreError('이미 다른 반박에 사용한 요청 식별자입니다.')
      }
      return String(existing.incident_id)
    }

    const incident = await client.query(
      `SELECT incident_id, reported_user_id
       FROM trip_incidents
       WHERE incident_id = $1
       FOR UPDATE`,
      [input.incidentId],
    )
    const row = incident.rows[0]
    if (!row || row.reported_user_id !== input.authorId) {
      throw new CoreError('사건 대상자만 자신의 반박을 제출할 수 있습니다.')
    }

    const terminal = await client.query(
      `SELECT 1
       FROM trip_incident_review_commands
       WHERE incident_id = $1
         AND command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
       FOR UPDATE`,
      [input.incidentId],
    )
    if (terminal.rowCount) {
      throw new CoreError('최종 판정이 끝난 사건에는 반박을 추가할 수 없습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO trip_incident_rebuttals (
         incident_id, author_user_id, statement, evidence_ref, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING
       RETURNING rebuttal_id`,
      [
        input.incidentId,
        input.authorId,
        statement,
        evidenceRef,
        input.idempotencyKey,
      ],
    )
    if (inserted.rowCount) return String(inserted.rows[0].rebuttal_id)

    const conflict = await client.query(
      `SELECT incident_id, statement, evidence_ref
       FROM trip_incident_rebuttals
       WHERE author_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.authorId, input.idempotencyKey],
    )
    const existing = conflict.rows[0]
    if (
      existing &&
      existing.incident_id === input.incidentId &&
      existing.statement === statement &&
      (existing.evidence_ref ?? null) === evidenceRef
    ) {
      return String(existing.incident_id)
    }
    throw new CoreError('이미 이 사건에 반박이 제출되었습니다.')
  })
}

/**
 * DEC-015 review command: audit-only operational record. It never changes
 * attendance, escrow, points, settlement, debt, or eligibility. A reviewed
 * MEMBER_NO_SHOW is applied only by executeConfirmedMemberNoShow below.
 */
export async function decideTripIncident(input: {
  adminId: string
  incidentId: string
  commandType: TripIncidentReviewCommandType
  decisionNote: string
  evidenceBasis: string
  idempotencyKey: string
}) {
  if (![
    'START_REVIEW',
    'RESPONSIBILITY_CONFIRMED',
    'NOT_ESTABLISHED',
  ].includes(input.commandType)) {
    throw new CoreError('사건 검토 단계가 올바르지 않습니다.')
  }
  const decisionNote = normalizeTripIncidentReviewText(
    input.decisionNote,
    '판정 사유',
    1000,
  )
  const evidenceBasis = normalizeTripIncidentReviewText(
    input.evidenceBasis,
    '판단 근거',
    2000,
  )

  return inTransaction(async (client) => {
    const replay = await client.query(
      `SELECT command_id, incident_id, command_type, decision_note, evidence_basis
       FROM trip_incident_review_commands
       WHERE admin_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (
        existing.incident_id !== input.incidentId ||
        existing.command_type !== input.commandType ||
        existing.decision_note !== decisionNote ||
        existing.evidence_basis !== evidenceBasis
      ) {
        throw new CoreError('이미 다른 사건 검토에 사용한 요청 식별자입니다.')
      }
      if (existing.command_type === 'START_REVIEW') {
        await publishTripIncidentRebuttalWindowRecord(client, {
          incidentId: input.incidentId,
          reviewCommandId: String(existing.command_id),
          adminId: input.adminId,
          idempotencyKey: input.idempotencyKey,
        })
      }
      return String(existing.incident_id)
    }

    const admin = await client.query(
      `SELECT 1 FROM users
       WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
       FOR SHARE`,
      [input.adminId],
    )
    if (!admin.rowCount) {
      throw new CoreError('활성 관리자만 이동 사건을 검토할 수 있습니다.')
    }

    const incident = await client.query(
      `SELECT i.trip_id, i.reporter_user_id, i.reported_user_id
       FROM trip_incidents i
       WHERE i.incident_id = $1
       FOR UPDATE`,
      [input.incidentId],
    )
    const incidentRow = incident.rows[0]
    if (!incidentRow) throw new CoreError('이동 사건을 찾을 수 없습니다.')
    if (
      incidentRow.reporter_user_id === input.adminId ||
      incidentRow.reported_user_id === input.adminId
    ) {
      throw new CoreError('사건 당사자는 자신의 사건을 판정할 수 없습니다.')
    }
    const participation = await client.query(
      `SELECT 1 FROM trip_participants
       WHERE trip_id = $1 AND user_id = $2
       FOR SHARE`,
      [incidentRow.trip_id, input.adminId],
    )
    if (participation.rowCount) {
      throw new CoreError('해당 이동 참여자는 사건을 판정할 수 없습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO trip_incident_review_commands (
         incident_id, admin_user_id, command_type, decision_note,
         evidence_basis, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING
       RETURNING command_id`,
      [
        input.incidentId,
        input.adminId,
        input.commandType,
        decisionNote,
        evidenceBasis,
        input.idempotencyKey,
      ],
    )
    if (inserted.rowCount) {
      const commandId = String(inserted.rows[0].command_id)
      if (input.commandType === 'START_REVIEW') {
        await publishTripIncidentRebuttalWindowRecord(client, {
          incidentId: input.incidentId,
          reviewCommandId: commandId,
          adminId: input.adminId,
          idempotencyKey: input.idempotencyKey,
        })
      }
      return commandId
    }

    const conflict = await client.query(
      `SELECT command_id, incident_id, command_type, decision_note, evidence_basis
       FROM trip_incident_review_commands
       WHERE admin_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    const existing = conflict.rows[0]
    if (
      existing &&
      existing.incident_id === input.incidentId &&
      existing.command_type === input.commandType &&
      existing.decision_note === decisionNote &&
      existing.evidence_basis === evidenceBasis
    ) {
      if (existing.command_type === 'START_REVIEW') {
        await publishTripIncidentRebuttalWindowRecord(client, {
          incidentId: input.incidentId,
          reviewCommandId: String(existing.command_id),
          adminId: input.adminId,
          idempotencyKey: input.idempotencyKey,
        })
      }
      return String(existing.incident_id)
    }
    throw new CoreError('사건 검토 상태가 다른 요청으로 이미 변경되었습니다.')
  })
}

async function publishTripIncidentRebuttalWindowRecord(
  client: PoolClient,
  input: {
    incidentId: string
    reviewCommandId: string
    adminId: string
    idempotencyKey: string
  },
) {
  const existing = await client.query(
    `SELECT notification_id, review_command_id, exposed_by
     FROM trip_incident_review_notifications
     WHERE incident_id = $1
     FOR UPDATE`,
    [input.incidentId],
  )
  if (existing.rowCount) {
    const notification = existing.rows[0]
    if (notification.review_command_id !== input.reviewCommandId) {
      throw new CoreError('다른 검토 기록의 반박 기회가 이미 게시되어 있습니다.')
    }
    return String(notification.notification_id)
  }

  const inserted = await client.query(
    `INSERT INTO trip_incident_review_notifications (
       incident_id, review_command_id, recipient_user_id, exposed_by,
       idempotency_key, rebuttal_deadline_at
     )
     SELECT i.incident_id, $2, i.reported_user_id, $3, $4, clock_timestamp()
     FROM trip_incidents i
     WHERE i.incident_id = $1
     RETURNING notification_id`,
    [
      input.incidentId,
      input.reviewCommandId,
      input.adminId,
      input.idempotencyKey,
    ],
  )
  if (!inserted.rowCount) {
    throw new CoreError('반박 기회를 게시할 사건을 찾을 수 없습니다.')
  }
  return String(inserted.rows[0].notification_id)
}

/** Publishes the first real in-app rebuttal opportunity for a legacy review. */
export async function publishTripIncidentRebuttalWindow(input: {
  adminId: string
  incidentId: string
  idempotencyKey: string
}) {
  if (!isPointRequestUuid(input.incidentId) || !isPointRequestUuid(input.idempotencyKey)) {
    throw new CoreError('사건과 요청 식별자가 올바르지 않습니다.')
  }

  return inTransaction(async (client) => {
    const review = await client.query(
      `SELECT c.command_id, c.admin_user_id, admin.role, admin.account_status
       FROM trip_incident_review_commands c
       JOIN users admin ON admin.user_id = $2
       WHERE c.incident_id = $1 AND c.command_type = 'START_REVIEW'
       FOR UPDATE OF c`,
      [input.incidentId, input.adminId],
    )
    const row = review.rows[0]
    if (!row) {
      throw new CoreError('검토 시작 기록이 있는 사건만 반박 기회를 게시할 수 있습니다.')
    }
    if (row.role !== 'ADMIN' || row.account_status !== 'ACTIVE') {
      throw new CoreError('활성 관리자만 반박 기회를 게시할 수 있습니다.')
    }
    return publishTripIncidentRebuttalWindowRecord(client, {
      incidentId: input.incidentId,
      reviewCommandId: String(row.command_id),
      adminId: input.adminId,
      idempotencyKey: input.idempotencyKey,
    })
  })
}

/**
 * Executes an already-reviewed MEMBER_NO_SHOW fact. This deliberately changes
 * only the participant state; the fixed escrow cohort, ledger, balances, and
 * settlement amounts are left untouched for the normal fare flow.
 */
export async function executeConfirmedMemberNoShow(input: {
  adminId: string
  incidentId: string
  idempotencyKey: string
}) {
  if (!isPointRequestUuid(input.incidentId) || !isPointRequestUuid(input.idempotencyKey)) {
    throw new CoreError('사건과 요청 식별자가 올바르지 않습니다.')
  }

  return inTransaction(async (client) => {
    const replay = await client.query(
      `SELECT execution_id, incident_id
       FROM trip_incident_no_show_executions
       WHERE executed_by = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (existing.incident_id !== input.incidentId) {
        throw new CoreError('이미 다른 노쇼 확정에 사용한 요청 식별자입니다.')
      }
      return String(existing.execution_id)
    }

    const context = await client.query(
      `SELECT
         i.trip_id,
         i.reporter_user_id,
         i.reported_user_id,
         i.incident_type,
         c.command_id AS review_command_id,
         c.admin_user_id AS review_admin_id,
         p.status AS participant_status,
         p.role AS participant_role,
         g.status AS trip_status,
         admin.role AS admin_role,
         admin.account_status AS admin_status
       FROM trip_incidents i
       JOIN trip_incident_review_commands c
         ON c.incident_id = i.incident_id
        AND c.command_type = 'RESPONSIBILITY_CONFIRMED'
       JOIN trip_groups g ON g.trip_id = i.trip_id
       JOIN trip_participants p
         ON p.trip_id = i.trip_id AND p.user_id = i.reported_user_id
       JOIN users admin ON admin.user_id = $2
       WHERE i.incident_id = $1
       FOR UPDATE OF i, c, g, p`,
      [input.incidentId, input.adminId],
    )
    const row = context.rows[0]
    if (!row) {
      throw new CoreError('귀책 사실이 확정된 노쇼 사건만 처리할 수 있습니다.')
    }
    if (row.admin_role !== 'ADMIN' || row.admin_status !== 'ACTIVE') {
      throw new CoreError('활성 관리자만 노쇼 사실을 확정할 수 있습니다.')
    }
    if (row.review_admin_id !== input.adminId) {
      throw new CoreError('사건 판정을 기록한 관리자만 노쇼 사실을 확정할 수 있습니다.')
    }
    if (row.incident_type !== 'MEMBER_NO_SHOW') {
      throw new CoreError('참여자 노쇼 사건만 처리할 수 있습니다.')
    }
    if (
      row.trip_status !== 'IN_PROGRESS' ||
      row.participant_role !== 'MEMBER' ||
      row.participant_status !== 'DEPOSITED'
    ) {
      throw new CoreError('이동 중인 미체크인 참여자만 노쇼로 확정할 수 있습니다.')
    }

    const adminParticipation = await client.query(
      `SELECT 1 FROM trip_participants
       WHERE trip_id = $1 AND user_id = $2
       FOR SHARE`,
      [row.trip_id, input.adminId],
    )
    if (
      row.reporter_user_id === input.adminId ||
      row.reported_user_id === input.adminId ||
      adminParticipation.rowCount
    ) {
      throw new CoreError('사건 당사자 또는 해당 이동 참여자는 노쇼 사실을 확정할 수 없습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO trip_incident_no_show_executions (
         incident_id, review_command_id, trip_id, reported_user_id,
         executed_by, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING execution_id, executed_at`,
      [
        input.incidentId,
        row.review_command_id,
        row.trip_id,
        row.reported_user_id,
        input.adminId,
        input.idempotencyKey,
      ],
    )
    const execution = inserted.rows[0]
    if (!execution) throw new CoreError('노쇼 확정 기록을 만들지 못했습니다.')

    const transitioned = await client.query(
      `UPDATE trip_participants
       SET status = 'NO_SHOW',
           no_show_at = $4,
           no_show_marked_by = $3,
           no_show_idempotency_key = $5,
           no_show_execution_id = $6
       WHERE trip_id = $1 AND user_id = $2 AND status = 'DEPOSITED'
       RETURNING participant_id`,
      [
        row.trip_id,
        row.reported_user_id,
        input.adminId,
        execution.executed_at,
        input.idempotencyKey,
        execution.execution_id,
      ],
    )
    if (!transitioned.rowCount) {
      throw new CoreError('노쇼 확정 대상의 참여 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.')
    }
    return String(execution.execution_id)
  })
}

/**
 * Executes a reviewed HOST_NO_START outcome. This is intentionally a narrow
 * compensation action: member escrow is returned and the trip is cancelled;
 * host escrow and any host penalty remain untouched pending a separate policy.
 */
export async function executeConfirmedHostNoStartRefund(input: {
  adminId: string
  incidentId: string
  idempotencyKey: string
}) {
  if (!isPointRequestUuid(input.incidentId) || !isPointRequestUuid(input.idempotencyKey)) {
    throw new CoreError('사건과 요청 식별자가 올바르지 않습니다.')
  }

  return inTransaction(async (client) => {
    const replay = await client.query(
      `SELECT execution_id, incident_id
       FROM trip_incident_no_start_refund_executions
       WHERE executed_by = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (existing.incident_id !== input.incidentId) {
        throw new CoreError('다른 사건에 사용한 요청 식별자입니다.')
      }
      return String(existing.execution_id)
    }

    const context = await client.query(
      `SELECT
         i.trip_id,
         i.reporter_user_id,
         i.reported_user_id,
         i.incident_type,
         c.command_id AS review_command_id,
         c.admin_user_id AS review_admin_id,
         g.host_user_id,
         g.status AS trip_status,
         g.departure_at <= clock_timestamp() AS departure_due,
         admin.role AS admin_role,
         admin.account_status AS admin_status
       FROM trip_incidents i
       JOIN trip_incident_review_commands c
         ON c.incident_id = i.incident_id
        AND c.command_type = 'RESPONSIBILITY_CONFIRMED'
       JOIN trip_groups g ON g.trip_id = i.trip_id
       JOIN users admin ON admin.user_id = $2
       WHERE i.incident_id = $1
       FOR UPDATE OF i, c, g`,
      [input.incidentId, input.adminId],
    )
    const row = context.rows[0]
    if (!row) {
      throw new CoreError('귀책이 확정된 사건만 처리할 수 있습니다.')
    }
    if (row.admin_role !== 'ADMIN' || row.admin_status !== 'ACTIVE') {
      throw new CoreError('활성 관리자만 미개시 환불을 실행할 수 있습니다.')
    }
    if (row.review_admin_id !== input.adminId) {
      throw new CoreError('사건 책임을 기록한 관리자만 미개시 환불을 실행할 수 있습니다.')
    }
    if (row.incident_type !== 'HOST_NO_START' || row.reported_user_id !== row.host_user_id) {
      throw new CoreError('모집자 미개시 사건만 처리할 수 있습니다.')
    }
    if (row.trip_status !== 'CONFIRMED' || !row.departure_due) {
      throw new CoreError('출발 시각이 지난 확정 모집만 미개시 환불로 취소할 수 있습니다.')
    }

    const adminParticipation = await client.query(
      `SELECT 1 FROM trip_participants
       WHERE trip_id = $1 AND user_id = $2
       FOR SHARE`,
      [row.trip_id, input.adminId],
    )
    if (
      row.reporter_user_id === input.adminId ||
      row.reported_user_id === input.adminId ||
      adminParticipation.rowCount
    ) {
      throw new CoreError('사건 당사자 또는 해당 모집 참여자는 미개시 환불을 실행할 수 없습니다.')
    }

    const deposits = await client.query(
      `SELECT p.user_id, p.role, p.status, d.amount
       FROM trip_participants p
       JOIN trip_deposits d
         ON d.trip_id = p.trip_id AND d.user_id = p.user_id
       WHERE p.trip_id = $1
       ORDER BY p.role DESC, p.user_id
       FOR UPDATE OF p, d`,
      [row.trip_id],
    )
    const members = deposits.rows.filter(
      (participant) => participant.role === 'MEMBER' && participant.status === 'DEPOSITED',
    )
    const hostDeposits = deposits.rows.filter(
      (participant) => participant.role === 'HOST' && participant.status === 'DEPOSITED',
    )
    const depositCount = deposits.rowCount ?? 0
    if (
      depositCount < 2 ||
      depositCount > 4 ||
      members.length !== depositCount - 1 ||
      hostDeposits.length !== 1
    ) {
      throw new CoreError('예치 확정 인원이 올바르지 않아 미개시 환불을 실행할 수 없습니다.')
    }

    const settlement = await client.query(
      `SELECT 1 FROM trip_settlements WHERE trip_id = $1 FOR SHARE`,
      [row.trip_id],
    )
    if (settlement.rowCount) {
      throw new CoreError('정산이 시작된 모집은 미개시 환불로 처리할 수 없습니다.')
    }

    const inserted = await client.query(
      `INSERT INTO trip_incident_no_start_refund_executions (
         incident_id, review_command_id, trip_id, executed_by, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5)
       RETURNING execution_id, executed_at`,
      [
        input.incidentId,
        row.review_command_id,
        row.trip_id,
        input.adminId,
        input.idempotencyKey,
      ],
    )
    const execution = inserted.rows[0]
    if (!execution) throw new CoreError('미개시 환불 실행 기록을 만들지 못했습니다.')

    for (const participant of members) {
      const memberId = String(participant.user_id)
      const amount = Number(participant.amount)
      if (amount > 0) {
        await client.query(
          `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, no_start_refund_execution_id, reason, idempotency_key
         ) VALUES ($1, 'REFUND', $2, $3, $4, $5, $6, $7, $8)`,
        [
          memberId,
          amount,
          -amount,
          row.trip_id,
          input.adminId,
          execution.execution_id,
          '모집자 미개시: 비귀책 참여자 예치금 전액 반환',
          `host-no-start-refund:${execution.execution_id}:${memberId}`,
        ],
        )
      }
    }

    const escrowShortfalls = await client.query(
      `SELECT s.shortfall_id, s.user_id, s.outstanding_points
       FROM trip_escrow_shortfalls s
       JOIN trip_participants p
         ON p.trip_id = s.trip_id AND p.user_id = s.user_id
       WHERE s.trip_id = $1
         AND s.status = 'OPEN'
         AND p.role = 'MEMBER'
       ORDER BY s.user_id
       FOR UPDATE OF s, p`,
      [row.trip_id],
    )
    for (const shortfall of escrowShortfalls.rows) {
      const outstandingPoints = Number(shortfall.outstanding_points)
      if (!Number.isSafeInteger(outstandingPoints) || outstandingPoints < 1) {
        throw new CoreError('예치 부족 외상 잔액이 올바르지 않습니다.')
      }
      await client.query(
        `INSERT INTO trip_escrow_shortfall_events (
           shortfall_id, user_id, event_type, points_delta,
           no_start_refund_execution_id, reason, idempotency_key
         ) VALUES ($1, $2, 'WAIVE', $3, $4,
           '모집자 미개시로 비귀책 참여자 예치 부족 외상 면제', $5)`,
        [
          shortfall.shortfall_id,
          shortfall.user_id,
          -outstandingPoints,
          execution.execution_id,
          `host-no-start-refund:${execution.execution_id}:escrow-shortfall-waive:${shortfall.user_id}`,
        ],
      )
    }

    const cancelled = await client.query(
      `UPDATE trip_groups
       SET status = 'CANCELLED',
           closed_at = $2,
           closure_type = 'CANCELLED',
           cancelled_at = $2,
           cancellation_idempotency_key = $3
       WHERE trip_id = $1 AND status = 'CONFIRMED'
       RETURNING trip_id`,
      [row.trip_id, execution.executed_at, input.idempotencyKey],
    )
    if (!cancelled.rowCount) {
      throw new CoreError('모집 상태가 변경되어 미개시 환불을 실행할 수 없습니다.')
    }
    return String(execution.execution_id)
  })
}

export async function submitActualFare(input: {
  actorId: string
  tripId: string
  actualFare: number
  idempotencyKey: string
}) {
  positiveInteger(input.actualFare, '실제 요금')
  await inTransaction(async (client) => {
    await requireActiveUserForAction(client, input.actorId)
    const trip = await client.query(
      `SELECT host_user_id, status, fare_submitter_user_id
       FROM trip_groups
       WHERE trip_id = $1
       FOR UPDATE`,
      [input.tripId],
    )
    const row = trip.rows[0]
    if (
      !row ||
      (row.host_user_id !== input.actorId &&
        row.fare_submitter_user_id !== input.actorId)
    ) {
      throw new CoreError('방장 또는 지정된 참여자만 실제 요금을 입력할 수 있습니다.')
    }
    const replay = await client.query(
      `SELECT actual_fare, submitted_by, fare_submission_idempotency_key,
              resubmission_required, allocation_policy
       FROM trip_settlements
       WHERE trip_id = $1
       FOR UPDATE`,
      [input.tripId],
    )
    let isResubmission = false
    if (replay.rowCount) {
      const existing = replay.rows[0]
      if (
        existing.submitted_by === input.actorId &&
        existing.fare_submission_idempotency_key === input.idempotencyKey &&
        Number(existing.actual_fare) === input.actualFare &&
        !existing.resubmission_required
      ) {
        return
      }
      if (!existing.resubmission_required) {
        throw new CoreError('이미 실제 요금이 등록되었습니다.')
      }
      if (existing.allocation_policy === 'HOST_APPROVAL_ORDER') {
        throw new CoreError('정책 v2 실제 요금은 잠정 정산 전에 다시 제출할 수 없습니다.')
      }
      if (row.host_user_id !== input.actorId) {
        throw new CoreError('수정 실제 요금은 방장만 다시 제출할 수 있습니다.')
      }
      isResubmission = true
    }
    if (row.status !== 'IN_PROGRESS') throw new CoreError('이동 시작 후 실제 요금을 입력할 수 있습니다.')
    const cohort = await client.query(
      `SELECT p.user_id, p.role, p.status, p.approved_at, d.amount
       FROM trip_participants p
       JOIN trip_deposits d
         ON d.trip_id = p.trip_id
        AND d.user_id = p.user_id
       WHERE p.trip_id = $1
       ORDER BY p.user_id
       FOR UPDATE OF p, d`,
      [input.tripId],
    )
    const participantCount = Number(cohort.rowCount ?? 0)
    if (participantCount < 2 || participantCount > 4) {
      throw new CoreError('정산 대상 예치 참여자가 2명 이상이어야 합니다.')
    }
    if (
      cohort.rows.some(
        (participant) =>
          participant.role !== 'HOST' &&
          !['CHECKED_IN', 'NO_SHOW'].includes(participant.status as string),
      )
    ) {
      throw new CoreError('모든 참여자를 체크인 또는 노쇼로 확정한 뒤 실제 요금을 제출해 주세요.')
    }
    const legacyFinalShare = calculateDemoFinalShare(input.actualFare, participantCount)
    if (isResubmission) {
      await client.query(
        `DELETE FROM fare_confirmations WHERE trip_id = $1`,
        [input.tripId],
      )
      await client.query(
        `DELETE FROM trip_settlement_participants WHERE trip_id = $1`,
        [input.tripId],
      )
      await client.query(
        `UPDATE trip_settlements
         SET actual_fare = $2::integer,
             final_share = ceil($2::integer::numeric / participant_count)::integer,
             fare_submission_idempotency_key = $3,
             submitted_at = now(),
             confirmation_deadline = now() + interval '24 hours',
             resubmission_required = false,
             fare_revision = fare_revision + 1
         WHERE trip_id = $1`,
        [input.tripId, input.actualFare, input.idempotencyKey],
      )
    } else {
      await client.query(
        `INSERT INTO trip_settlements (
           trip_id, actual_fare, participant_count, final_share, submitted_by,
           fare_submission_idempotency_key, confirmation_deadline, agreement_deadline,
           dispute_deadline, cohort_basis, allocation_policy
         ) VALUES (
           $1, $2::integer, $3::smallint,
           ceil($2::integer::numeric / $3::smallint::numeric)::integer,
           $4, $5, now() + interval '10 minutes', now() + interval '10 minutes',
           now() + interval '24 hours', 'ESCROW_CONFIRMED', 'HOST_APPROVAL_ORDER'
         )`,
        [input.tripId, input.actualFare, participantCount, input.actorId, input.idempotencyKey],
      )
    }
    if (isResubmission) {
      for (const participant of cohort.rows) {
        await client.query(
          `INSERT INTO trip_settlement_participants (
             trip_id, user_id, deposit_amount, final_share
           ) VALUES ($1, $2, $3, $4)`,
          [input.tripId, participant.user_id, participant.amount, legacyFinalShare],
        )
      }
    } else {
      const allocations = allocateHostApprovalOrder(
        input.actualFare,
        cohort.rows.map((participant) => ({
          userId: String(participant.user_id),
          role: participant.role === 'HOST' ? 'HOST' as const : 'PARTICIPANT' as const,
          approvedAt: participant.approved_at as Date | string | null,
        })),
      )
      const allocationByUser = new Map(
        allocations.map((allocation) => [allocation.userId, allocation]),
      )
      for (const participant of cohort.rows) {
        const allocation = allocationByUser.get(String(participant.user_id))
        if (!allocation) throw new CoreError('정산 배분 스냅샷을 만들 수 없습니다.')
        await client.query(
          `INSERT INTO trip_settlement_participants (
             trip_id, user_id, deposit_amount, final_share, allocation_rank, allocated_share
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.tripId,
            participant.user_id,
            participant.amount,
            legacyFinalShare,
            allocation.allocationRank,
            allocation.allocatedShare,
          ],
        )
      }
    }
    await client.query(
      `UPDATE trip_groups SET status = 'SETTLEMENT_PENDING' WHERE trip_id = $1`,
      [input.tripId],
    )
  })
}

export async function arriveAndSettleTrip(
  actorId: string,
  tripId: string,
  actualFareText: string,
  idempotencyKey: string,
) {
  throw new CoreError(
    '즉시 정산은 사용할 수 없습니다. 실제 요금을 제출한 뒤 참여자 확인을 기다려 주세요.',
  )
  if (!/^\d+$/.test(actualFareText)) {
    throw new CoreError('실제 요금은 숫자만 입력해 주세요.')
  }
  const actualFare = Number(actualFareText)
  positiveInteger(actualFare, '실제 요금')

  await inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT host_user_id, status
       FROM trip_groups
       WHERE trip_id = $1
       FOR UPDATE`,
      [tripId],
    )
    const tripRow = trip.rows[0]
    if (!tripRow || tripRow.host_user_id !== actorId) {
      throw new CoreError('방장만 도착 처리와 정산을 실행할 수 있습니다.')
    }

    const existing = await client.query(
      `SELECT actual_fare, submitted_by, fare_submission_idempotency_key,
              settlement_idempotency_key, status
       FROM trip_settlements
       WHERE trip_id = $1
       FOR UPDATE`,
      [tripId],
    )
    if (existing.rowCount) {
      const row = existing.rows[0]
      if (
        tripRow.status === 'COMPLETED' &&
        row.status === 'COMPLETED' &&
        row.submitted_by === actorId &&
        row.fare_submission_idempotency_key === idempotencyKey &&
        row.settlement_idempotency_key === idempotencyKey &&
        Number(row.actual_fare) === actualFare
      ) {
        return
      }
      throw new CoreError('이미 도착 처리 또는 정산이 진행되었습니다.')
    }
    if (tripRow.status !== 'IN_PROGRESS') {
      throw new CoreError('출발한 방만 도착 처리할 수 있습니다.')
    }

    const participants = await client.query(
      `SELECT p.user_id, p.role, p.status, d.amount
       FROM trip_participants p
       JOIN trip_deposits d
         ON d.trip_id = p.trip_id
        AND d.user_id = p.user_id
       WHERE p.trip_id = $1
       ORDER BY p.user_id
       FOR UPDATE OF p, d`,
      [tripId],
    )
    const unresolvedParticipant = participants.rows.some(
      (participant) =>
        participant.role !== 'HOST' &&
        !['CHECKED_IN', 'NO_SHOW'].includes(participant.status as string),
    )
    if (unresolvedParticipant) {
      throw new CoreError(
        '모든 참여자를 탑승 체크인 또는 노쇼로 확정한 뒤 도착 처리해 주세요.',
      )
    }
    const boarded = participants.rows.filter(
      (participant) =>
        participant.role === 'HOST' || participant.status === 'CHECKED_IN',
    )
    if (boarded.length < 2 || boarded.length > 4) {
      throw new CoreError('방장을 포함해 최종 탑승자가 2~4명이어야 합니다.')
    }
    const finalShare = calculateDemoFinalShare(actualFare, boarded.length)
    const boardedIds = new Set(
      boarded.map((participant) => participant.user_id as string),
    )

    await client.query(
      `INSERT INTO trip_settlements (
         trip_id, actual_fare, participant_count, final_share, submitted_by,
         fare_submission_idempotency_key, confirmation_deadline, cohort_basis
       ) VALUES (
         $1, $2, $3, $4, $5, $6, now() + interval '24 hours', 'BOARDED'
       )`,
      [tripId, actualFare, boarded.length, finalShare, actorId, idempotencyKey],
    )
    for (const participant of boarded) {
      await client.query(
        `INSERT INTO trip_settlement_participants (
           trip_id, user_id, deposit_amount, final_share
         ) VALUES ($1, $2, $3, $4)`,
        [tripId, participant.user_id, participant.amount, finalShare],
      )
    }

    const userIds = participants.rows.map(
      (participant) => participant.user_id as string,
    )
    await client.query(
      `SELECT user_id
       FROM users
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    const balances = await client.query(
      `SELECT user_id, available_points, held_points
       FROM point_accounts
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    const availableByUser = new Map(
      balances.rows.map((balance) => [
        balance.user_id as string,
        Number(balance.available_points),
      ]),
    )
    for (const participant of boarded) {
      const shortage = Math.max(0, finalShare - Number(participant.amount))
      if (
        shortage > 0 &&
        (availableByUser.get(participant.user_id as string) ?? 0) < shortage
      ) {
        throw new CoreError(
          `추가 정산을 위해 모든 탑승자에게 최대 ${shortage.toLocaleString()}P가 필요합니다.`,
        )
      }
    }
    const heldByUser = new Map(
      balances.rows.map((balance) => [
        balance.user_id as string,
        Number(balance.held_points),
      ]),
    )
    for (const participant of participants.rows) {
      if (
        (heldByUser.get(participant.user_id as string) ?? 0) <
        Number(participant.amount)
      ) {
        throw new CoreError('예치 잔액이 정산 대상 정보와 일치하지 않습니다.')
      }
    }

    for (const participant of participants.rows) {
      const userId = participant.user_id as string
      const depositAmount = Number(participant.amount)
      if (!boardedIds.has(userId)) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, reason, idempotency_key
           ) VALUES ($1, 'REFUND', $2, $3, $4, $5, '미탑승 예치금 전액 반환', $6)`,
          [
            userId,
            depositAmount,
            -depositAmount,
            tripId,
            actorId,
            `trip:${tripId}:not-boarded-refund:${userId}`,
          ],
        )
        continue
      }

      const chargedFromDeposit = Math.min(depositAmount, finalShare)
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'SETTLEMENT_CHARGE', 0, $2, $3, $4, '예치금 정산', $5)`,
        [
          userId,
          -chargedFromDeposit,
          tripId,
          actorId,
          `trip:${tripId}:charge:${userId}`,
        ],
      )
      if (depositAmount > finalShare) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, reason, idempotency_key
           ) VALUES ($1, 'REFUND', $2, $3, $4, $5, '정산 차액 반환', $6)`,
          [
            userId,
            depositAmount - finalShare,
            -(depositAmount - finalShare),
            tripId,
            actorId,
            `trip:${tripId}:refund:${userId}`,
          ],
        )
      } else if (depositAmount < finalShare) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, reason, idempotency_key
           ) VALUES ($1, 'ADDITIONAL_DEBIT', $2, 0, $3, $4, '정산 추가 차감', $5)`,
          [
            userId,
            -(finalShare - depositAmount),
            tripId,
            actorId,
            `trip:${tripId}:debit:${userId}`,
          ],
        )
      }
    }

    await client.query(
      `UPDATE trip_participants
       SET status = 'COMPLETED', completed_at = now()
       WHERE trip_id = $1
         AND user_id = ANY($2::uuid[])
         AND status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')`,
      [tripId, userIds],
    )
    await client.query(
      `UPDATE trip_settlements
       SET status = 'COMPLETED',
           settlement_idempotency_key = $2,
           settled_at = now()
       WHERE trip_id = $1`,
      [tripId, idempotencyKey],
    )
    await client.query(
      `UPDATE trip_groups
       SET status = 'COMPLETED', updated_at = now()
       WHERE trip_id = $1`,
      [tripId],
    )
  })
}

export async function submitFareDispute(input: {
  actorId: string
  tripId: string
  reason: string
  idempotencyKey: string
}) {
  const reason = input.reason.trim()
  if (!reason || reason.length > 1000) {
    throw new CoreError('이의제기 사유는 1~1,000자로 입력해 주세요.')
  }

  await inTransaction(async (client) => {
    await requireActiveUserForAction(client, input.actorId)
    const participant = await client.query(
      `SELECT s.submitted_by, s.fare_revision, p.status, s.allocation_policy
       FROM trip_groups g
       JOIN trip_settlements s ON s.trip_id = g.trip_id
       JOIN trip_participants p
         ON p.trip_id = g.trip_id
        AND p.user_id = $2
       JOIN trip_deposits d
         ON d.trip_id = p.trip_id
        AND d.user_id = p.user_id
       WHERE g.trip_id = $1
         AND g.status = 'SETTLEMENT_PENDING'
         AND (
           (
             s.allocation_policy = 'HOST_APPROVAL_ORDER'
             AND s.status IN ('PENDING_CONFIRMATION', 'PROVISIONALLY_SETTLED')
             AND s.dispute_deadline > now()
           )
           OR (
             s.allocation_policy = 'LEGACY_CEIL'
             AND s.status = 'PENDING_CONFIRMATION'
             AND s.confirmation_deadline > now()
             AND NOT EXISTS (
               SELECT 1 FROM fare_confirmations c
               WHERE c.trip_id = g.trip_id AND c.user_id = $2
             )
           )
         )
       FOR UPDATE OF g, s, p`,
      [input.tripId, input.actorId],
    )
    const participantRow = participant.rows[0]
    if (!participantRow || participantRow.submitted_by === input.actorId) {
      throw new CoreError('실제 요금을 제출하지 않은 정산 참여자만 이의를 제기할 수 있습니다.')
    }

    const replay = await client.query(
      `SELECT reason
       FROM fare_disputes
       WHERE user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.actorId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      if (replay.rows[0].reason === reason) return
      throw new CoreError('이미 다른 이의제기에 사용한 요청 키입니다.')
    }

    const existingOpen = await client.query(
      `SELECT 1
       FROM fare_disputes
       WHERE trip_id = $1 AND user_id = $2 AND status = 'OPEN'
       FOR UPDATE`,
      [input.tripId, input.actorId],
    )
    if (existingOpen.rowCount) {
      throw new CoreError('이미 처리 대기 중인 실제 요금 이의제기가 있습니다.')
    }

    await client.query(
      `INSERT INTO fare_disputes (
         trip_id, user_id, reason, idempotency_key, fare_revision
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        input.tripId,
        input.actorId,
        reason,
        input.idempotencyKey,
        participantRow.fare_revision,
      ],
    )
  })
}

export async function withdrawFareDispute(input: {
  actorId: string
  tripId: string
  idempotencyKey: string
}) {
  if (
    !isPointRequestUuid(input.actorId) ||
    !isPointRequestUuid(input.tripId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('이의제기 철회 요청 식별자가 올바르지 않습니다.')
  }
  await inTransaction(async (client) => {
    await requireActiveUserForAction(client, input.actorId)
    const dispute = await client.query(
      `SELECT d.status, d.resolved_by_user_id, d.resolution_idempotency_key,
              g.status AS trip_status, s.status AS settlement_status,
              s.confirmation_deadline, s.dispute_deadline, s.allocation_policy
       FROM fare_disputes d
       JOIN trip_groups g ON g.trip_id = d.trip_id
       JOIN trip_settlements s ON s.trip_id = d.trip_id
       WHERE d.trip_id = $1 AND d.user_id = $2
       FOR UPDATE OF d, g, s`,
      [input.tripId, input.actorId],
    )
    const row = dispute.rows[0]
    if (
      row?.status === 'WITHDRAWN' &&
      row.resolved_by_user_id === input.actorId &&
      row.resolution_idempotency_key === input.idempotencyKey
    ) {
      return
    }
    const policyV2Window =
      row?.allocation_policy === 'HOST_APPROVAL_ORDER' &&
      ['PENDING_CONFIRMATION', 'PROVISIONALLY_SETTLED'].includes(row.settlement_status) &&
      new Date(row.dispute_deadline).getTime() > Date.now()
    const legacyWindow =
      row?.allocation_policy === 'LEGACY_CEIL' &&
      row.settlement_status === 'PENDING_CONFIRMATION' &&
      new Date(row.confirmation_deadline).getTime() > Date.now()
    if (!row || row.status !== 'OPEN' || row.trip_status !== 'SETTLEMENT_PENDING' ||
      (!policyV2Window && !legacyWindow)) {
      throw new CoreError('확인 기한 안의 열린 이의제기만 철회할 수 있습니다.')
    }
    await client.query(
      `UPDATE fare_disputes
       SET status = 'WITHDRAWN',
           resolved_at = now(),
           resolution_note = '참여자가 이의제기를 철회했습니다.',
           resolved_by_user_id = $2,
           resolution_idempotency_key = $3
       WHERE trip_id = $1 AND user_id = $2`,
      [input.tripId, input.actorId, input.idempotencyKey],
    )
  })
}

export async function resolveFareDispute(input: {
  adminId: string
  tripId: string
  disputeId: string
  outcome: 'REJECTED' | 'RESOLVED'
  resolutionNote: string
  idempotencyKey: string
}) {
  const note = input.resolutionNote.trim()
  if (!note || note.length > 1000) {
    throw new CoreError('검토 메모는 1~1,000자로 입력해 주세요.')
  }
  if (
    !isPointRequestUuid(input.adminId) ||
    !isPointRequestUuid(input.tripId) ||
    !isPointRequestUuid(input.disputeId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('이의제기 처리 요청 식별자가 올바르지 않습니다.')
  }

  await inTransaction(async (client) => {
    const admin = await client.query(
      `SELECT 1
       FROM users
       WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
       FOR UPDATE`,
      [input.adminId],
    )
    if (!admin.rowCount) throw new CoreError('활성 관리자만 이의제기를 처리할 수 있습니다.')

    const dispute = await client.query(
      `SELECT d.status, d.resolved_by_user_id, d.resolution_idempotency_key,
              g.status AS trip_status, s.status AS settlement_status,
              s.allocation_policy, s.actual_fare
       FROM fare_disputes d
       JOIN trip_groups g ON g.trip_id = d.trip_id
       JOIN trip_settlements s ON s.trip_id = d.trip_id
       WHERE d.dispute_id = $1 AND d.trip_id = $2
       FOR UPDATE OF d, g, s`,
      [input.disputeId, input.tripId],
    )
    const row = dispute.rows[0]
    if (
      row?.status === input.outcome &&
      row.resolved_by_user_id === input.adminId &&
      row.resolution_idempotency_key === input.idempotencyKey
    ) {
      return
    }
    if (
      !row ||
      row.status !== 'OPEN' ||
      row.trip_status !== 'SETTLEMENT_PENDING' ||
      row.settlement_status !== 'PENDING_CONFIRMATION' &&
      !(row.allocation_policy === 'HOST_APPROVAL_ORDER' && row.settlement_status === 'PROVISIONALLY_SETTLED')
    ) {
      throw new CoreError('열린 정산 대기 이의제기만 처리할 수 있습니다.')
    }

    if (input.outcome === 'RESOLVED') {
      const otherOpenDisputes = await client.query(
        `SELECT 1
         FROM fare_disputes
         WHERE trip_id = $1 AND status = 'OPEN' AND dispute_id <> $2
         FOR UPDATE`,
        [input.tripId, input.disputeId],
      )
      if (otherOpenDisputes.rowCount) {
        throw new CoreError('수정 요금을 요청하려면 같은 이동의 열린 이의제기를 모두 처리해 주세요.')
      }
    }

    const resolutionNote =
      input.outcome === 'RESOLVED'
        ? `${note}\n기존 제출 요금: ${Number(row.actual_fare).toLocaleString('ko-KR')}P. 수정 요금 재제출 필요.`
        : note
    if (resolutionNote.length > 1000) {
      throw new CoreError('수정 요금 요청의 검토 메모는 950자 이하로 입력해 주세요.')
    }
    await client.query(
      `UPDATE fare_disputes
       SET status = $2,
           resolved_at = now(),
           resolution_note = $3,
           resolved_by_user_id = $4,
           resolution_idempotency_key = $5
       WHERE dispute_id = $1`,
      [
        input.disputeId,
        input.outcome,
        resolutionNote,
        input.adminId,
        input.idempotencyKey,
      ],
    )

    if (input.outcome === 'RESOLVED') {
      await client.query(
        `UPDATE trip_settlements
         SET resubmission_required = true
         WHERE trip_id = $1`,
        [input.tripId],
      )
      await client.query(
        `UPDATE trip_groups
         SET status = 'IN_PROGRESS', updated_at = now()
         WHERE trip_id = $1`,
        [input.tripId],
      )
    }
  })
}

export async function adjustFareDisputeByAdmin(input: {
  adminId: string
  tripId: string
  disputeId: string
  actualFare: number
  resolutionNote: string
  idempotencyKey: string
}) {
  positiveInteger(input.actualFare, '수정 실제 요금')
  const note = input.resolutionNote.trim()
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const policy = await sql`
    SELECT s.allocation_policy AS "allocationPolicy", s.status AS "settlementStatus"
    FROM trip_settlements s
    WHERE s.trip_id = ${input.tripId}
  `
  if (
    policy[0]?.allocationPolicy === 'HOST_APPROVAL_ORDER' &&
    policy[0]?.settlementStatus === 'PROVISIONALLY_SETTLED'
  ) {
    return adjustProvisionallySettledFareDisputeByAdmin(input, note)
  }
  if (!note || note.length > 1000) {
    throw new CoreError('검토 메모는 1~1,000자로 입력해 주세요.')
  }
  if (
    !isPointRequestUuid(input.adminId) ||
    !isPointRequestUuid(input.tripId) ||
    !isPointRequestUuid(input.disputeId) ||
    !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('관리자 요금 수정 요청 식별자가 올바르지 않습니다.')
  }

  await inTransaction(async (client) => {
    const admin = await client.query(
      `SELECT 1 FROM users
       WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
       FOR UPDATE`,
      [input.adminId],
    )
    if (!admin.rowCount) throw new CoreError('활성 관리자만 실제 요금을 수정할 수 있습니다.')

    const settlement = await client.query(
      `SELECT g.status AS trip_status, s.status AS settlement_status,
              s.actual_fare, s.participant_count, s.final_share,
              s.fare_revision, s.confirmation_deadline, s.submitted_by,
              s.resubmission_required
       FROM trip_groups g JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1 FOR UPDATE OF g, s`,
      [input.tripId],
    )
    const row = settlement.rows[0]
    if (!row || row.trip_status !== 'SETTLEMENT_PENDING' ||
      row.settlement_status !== 'PENDING_CONFIRMATION' || row.resubmission_required) {
      throw new CoreError('현재 확인 대기 중인 실제 요금만 수정할 수 있습니다.')
    }
    const existingCommand = await client.query(
      `SELECT command_id, trip_id, dispute_id, fare_revision,
              previous_actual_fare, revised_actual_fare, reason
       FROM admin_dispute_commands
       WHERE admin_user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (existingCommand.rowCount) {
      const command = existingCommand.rows[0]
      if (
        command.trip_id === input.tripId && command.dispute_id === input.disputeId &&
        Number(command.revised_actual_fare) === input.actualFare && command.reason === note &&
        Number(row.actual_fare) === input.actualFare &&
        Number(row.fare_revision) === Number(command.fare_revision) + 1
      ) return
      throw new CoreError('이미 다른 관리자 처리 요청에 사용한 식별자입니다.')
    }
    if (Number(row.actual_fare) === input.actualFare) {
      throw new CoreError('수정 요금은 현재 제출된 실제 요금과 달라야 합니다.')
    }

    const dispute = await client.query(
      `SELECT status, fare_revision FROM fare_disputes
       WHERE dispute_id = $1 AND trip_id = $2 FOR UPDATE`,
      [input.disputeId, input.tripId],
    )
    if (!dispute.rowCount || dispute.rows[0].status !== 'OPEN' ||
      Number(dispute.rows[0].fare_revision) !== Number(row.fare_revision)) {
      throw new CoreError('현재 요금 제안에 대해 열려 있는 이의만 수정할 수 있습니다.')
    }
    const otherOpenDisputes = await client.query(
      `SELECT dispute_id FROM fare_disputes
       WHERE trip_id = $1 AND status = 'OPEN' AND dispute_id <> $2 FOR UPDATE`,
      [input.tripId, input.disputeId],
    )
    if (otherOpenDisputes.rowCount) {
      throw new CoreError('요금을 수정하려면 같은 이동의 다른 열린 이의도 먼저 처리해 주세요.')
    }
    const snapshot = await client.query(
      `SELECT user_id, deposit_amount AS amount
       FROM trip_settlement_participants
       WHERE trip_id = $1 ORDER BY user_id FOR UPDATE`,
      [input.tripId],
    )
    if (snapshot.rowCount !== Number(row.participant_count)) {
      throw new CoreError('정산 대상 인원 스냅샷이 현재 정산 정보와 일치하지 않습니다.')
    }
    const confirmations = await client.query(
      `SELECT count(*)::int AS count FROM fare_confirmations WHERE trip_id = $1`,
      [input.tripId],
    )
    const revisedShare = calculateDemoFinalShare(input.actualFare, Number(row.participant_count))

    await client.query(
      `UPDATE fare_disputes
       SET status = 'RESOLVED', resolved_at = now(), resolution_note = $2,
           resolved_by_user_id = $3, resolution_idempotency_key = $4
       WHERE dispute_id = $1`,
      [input.disputeId, note, input.adminId, input.idempotencyKey],
    )
    await client.query(
      `INSERT INTO admin_dispute_commands (
         trip_id, dispute_id, fare_revision, command_type,
         previous_actual_fare, revised_actual_fare, participant_count,
         final_share, confirmation_count, confirmation_deadline, reason,
         admin_user_id, idempotency_key
       ) VALUES ($1, $2, $3, 'ADJUST_FARE', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.tripId, input.disputeId, row.fare_revision, row.actual_fare,
        input.actualFare, row.participant_count, revisedShare,
        confirmations.rows[0].count, row.confirmation_deadline, note,
        input.adminId, input.idempotencyKey,
      ],
    )
    await client.query(
      `UPDATE trip_settlements SET resubmission_required = true WHERE trip_id = $1`,
      [input.tripId],
    )
    await client.query(`UPDATE trip_groups SET status = 'IN_PROGRESS' WHERE trip_id = $1`, [input.tripId])
    await client.query(`DELETE FROM fare_confirmations WHERE trip_id = $1`, [input.tripId])
    await client.query(`DELETE FROM trip_settlement_participants WHERE trip_id = $1`, [input.tripId])
    await client.query(
      `UPDATE trip_settlements
       SET actual_fare = $2, final_share = $3,
           fare_submission_idempotency_key = $4, submitted_at = now(),
           confirmation_deadline = now() + interval '24 hours',
           resubmission_required = false, fare_revision = fare_revision + 1
       WHERE trip_id = $1`,
      [input.tripId, input.actualFare, revisedShare, input.idempotencyKey],
    )
    for (const participant of snapshot.rows) {
      await client.query(
        `INSERT INTO trip_settlement_participants (trip_id, user_id, deposit_amount, final_share)
         VALUES ($1, $2, $3, $4)`,
        [input.tripId, participant.user_id, participant.amount, revisedShare],
      )
    }
    await client.query(`UPDATE trip_groups SET status = 'SETTLEMENT_PENDING' WHERE trip_id = $1`, [input.tripId])
  })
}

async function adjustProvisionallySettledFareDisputeByAdmin(
  input: {
    adminId: string
    tripId: string
    disputeId: string
    actualFare: number
    resolutionNote: string
    idempotencyKey: string
  },
  note: string,
) {
  return inTransaction(async (client) => {
    const admin = await client.query(
      `SELECT 1 FROM users
       WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
       FOR UPDATE`,
      [input.adminId],
    )
    if (!admin.rowCount) throw new CoreError('활성 관리자만 실제 요금을 조정할 수 있습니다.')

    const settlement = await client.query(
      `SELECT g.status AS trip_status, s.status AS settlement_status,
              s.allocation_policy, s.actual_fare, s.participant_count, s.fare_revision
       FROM trip_groups g
       JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g, s`,
      [input.tripId],
    )
    const row = settlement.rows[0]
    if (!row || row.trip_status !== 'SETTLEMENT_PENDING' ||
      row.allocation_policy !== 'HOST_APPROVAL_ORDER' ||
      row.settlement_status !== 'PROVISIONALLY_SETTLED') {
      throw new CoreError('잠정 정산된 정책 v2 이동만 보정할 수 있습니다.')
    }
    if (Number(row.actual_fare) === input.actualFare) {
      throw new CoreError('수정 요금은 기존 실제 요금과 달라야 합니다.')
    }

    const replay = await client.query(
      `SELECT command_id, trip_id, dispute_id, revised_actual_fare, reason
       FROM policy_v2_adjustment_commands
       WHERE admin_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const command = replay.rows[0]
      if (command.trip_id === input.tripId && command.dispute_id === input.disputeId &&
        Number(command.revised_actual_fare) === input.actualFare && command.reason === note) {
        return
      }
      throw new CoreError('이미 다른 관리자 보정 요청에 사용한 식별자입니다.')
    }

    const dispute = await client.query(
      `SELECT status, fare_revision
       FROM fare_disputes
       WHERE dispute_id = $1 AND trip_id = $2
       FOR UPDATE`,
      [input.disputeId, input.tripId],
    )
    if (!dispute.rowCount || dispute.rows[0].status !== 'OPEN' ||
      Number(dispute.rows[0].fare_revision) !== Number(row.fare_revision)) {
      throw new CoreError('현재 열린 실제 요금 이의만 보정할 수 있습니다.')
    }
    const otherOpenDisputes = await client.query(
      `SELECT 1 FROM fare_disputes
       WHERE trip_id = $1 AND fare_revision = $2
         AND status = 'OPEN' AND dispute_id <> $3
       FOR UPDATE`,
      [input.tripId, row.fare_revision, input.disputeId],
    )
    if (otherOpenDisputes.rowCount) {
      throw new CoreError('요금을 조정하기 전에 같은 이동의 다른 열린 이의를 모두 처리해야 합니다.')
    }

    const snapshots = await client.query(
      `SELECT user_id, allocated_share, allocation_rank
       FROM trip_settlement_participants
       WHERE trip_id = $1
       ORDER BY user_id
       FOR UPDATE`,
      [input.tripId],
    )
    if (snapshots.rowCount !== Number(row.participant_count)) {
      throw new CoreError('정산 참여자 스냅샷이 실제 정산 인원과 일치하지 않습니다.')
    }
    const balances = await client.query(
      `SELECT user_id, available_points
       FROM point_accounts
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [snapshots.rows.map((snapshot) => snapshot.user_id)],
    )
    if (balances.rowCount !== snapshots.rowCount) {
      throw new CoreError('보정 대상 포인트 계정을 찾을 수 없습니다.')
    }
    const debts = await client.query(
      `SELECT debt_id, user_id, outstanding_points
       FROM point_debt_obligations
       WHERE trip_id = $1 AND fare_revision = $2
         AND user_id = ANY($3::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [input.tripId, row.fare_revision, snapshots.rows.map((snapshot) => snapshot.user_id)],
    )
    const availableByUser = new Map(
      balances.rows.map((balance) => [String(balance.user_id), Number(balance.available_points)]),
    )
    const debtByUser = new Map(
      debts.rows.map((debt) => [
        String(debt.user_id),
        { debtId: String(debt.debt_id), outstandingPoints: Number(debt.outstanding_points) },
      ]),
    )
    const baseShare = Math.floor(input.actualFare / Number(row.participant_count))
    const higherShareStartsAt = Number(row.participant_count) -
      (input.actualFare % Number(row.participant_count))
    const allocations = snapshots.rows.map((snapshot) => {
      const allocationRank = Number(snapshot.allocation_rank)
      const revisedShare = baseShare + (allocationRank > higherShareStartsAt ? 1 : 0)
      return {
        userId: String(snapshot.user_id),
        previousShare: Number(snapshot.allocated_share),
        revisedShare,
      }
    })

    await client.query(
      `UPDATE fare_disputes
       SET status = 'RESOLVED', resolved_at = now(), resolution_note = $2,
           resolved_by_user_id = $3, resolution_idempotency_key = $4
       WHERE dispute_id = $1`,
      [input.disputeId, note, input.adminId, input.idempotencyKey],
    )
    const command = await client.query(
      `INSERT INTO policy_v2_adjustment_commands (
         trip_id, dispute_id, fare_revision, previous_actual_fare,
         revised_actual_fare, admin_user_id, reason, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING command_id`,
      [
        input.tripId, input.disputeId, row.fare_revision, row.actual_fare,
        input.actualFare, input.adminId, note, input.idempotencyKey,
      ],
    )
    const commandId = String(command.rows[0]?.command_id ?? '')
    if (!commandId) throw new CoreError('보정 정산 명령을 만들지 못했습니다.')

    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO policy_v2_adjustment_allocations (
           command_id, user_id, previous_share, revised_share
         ) VALUES ($1, $2, $3, $4)`,
        [commandId, allocation.userId, allocation.previousShare, allocation.revisedShare],
      )
    }

    for (const allocation of allocations) {
      const existingDebt = debtByUser.get(allocation.userId)
      const amounts = calculatePolicyV2AdjustmentAmounts({
        previousShare: allocation.previousShare,
        revisedShare: allocation.revisedShare,
        availablePoints: availableByUser.get(allocation.userId) ?? 0,
        outstandingDebt: existingDebt?.outstandingPoints ?? 0,
      })
      if (amounts.availableDebit > 0) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, policy_v2_adjustment_command_id, reason, idempotency_key
           ) VALUES ($1, 'FARE_ADJUSTMENT_DEBIT', $2, 0, $3, $4, $5,
             'policy-v2 fare adjustment debit', $6)`,
          [allocation.userId, -amounts.availableDebit, input.tripId, input.adminId, commandId,
            `adjustment:${commandId}:debit:${allocation.userId}`],
        )
      }

      if (amounts.debtIncrease > 0 || amounts.debtReduction > 0) {
        let debtId = existingDebt?.debtId
        if (!debtId) {
          const createdDebt = await client.query(
            `INSERT INTO point_debt_obligations (user_id, trip_id, fare_revision)
             VALUES ($1, $2, $3)
             ON CONFLICT (trip_id, user_id, fare_revision) DO NOTHING
             RETURNING debt_id`,
            [allocation.userId, input.tripId, row.fare_revision],
          )
          debtId = createdDebt.rows[0]?.debt_id as string | undefined
        }
        if (!debtId) {
          throw new CoreError('외상 보정 의무를 안전하게 만들지 못했습니다.')
        }
        const debtDelta = amounts.debtIncrease || -amounts.debtReduction
        await client.query(
          `INSERT INTO point_debt_events (
             debt_id, user_id, event_type, debt_delta, actor_user_id, reason,
             idempotency_key, policy_v2_adjustment_command_id
           ) VALUES ($1, $2, 'DISPUTE_ADJUSTMENT', $3, $4,
             'policy-v2 fare adjustment debt', $5, $6)`,
          [debtId, allocation.userId, debtDelta, input.adminId,
            `adjustment:${commandId}:debt:${allocation.userId}`, commandId],
        )
      }
      if (amounts.availableRefund > 0) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, policy_v2_adjustment_command_id, reason, idempotency_key
           ) VALUES ($1, 'FARE_ADJUSTMENT_REFUND', $2, 0, $3, $4, $5,
             'policy-v2 fare adjustment refund', $6)`,
          [allocation.userId, amounts.availableRefund, input.tripId, input.adminId, commandId,
            `adjustment:${commandId}:refund:${allocation.userId}`],
        )
      }
    }
  })
}

export async function confirmFare(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    await requireActiveUserForAction(client, actorId)
    const participant = await client.query(
      `SELECT 1 FROM trip_groups g
       JOIN trip_participants p ON p.trip_id = g.trip_id
       JOIN trip_deposits d
         ON d.trip_id = p.trip_id
        AND d.user_id = p.user_id
       WHERE g.trip_id = $1 AND g.status = 'SETTLEMENT_PENDING'
         AND p.user_id = $2
         AND p.status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')
         AND NOT EXISTS (
           SELECT 1
           FROM fare_disputes d
           WHERE d.trip_id = g.trip_id
             AND d.user_id = $2
             AND d.status = 'OPEN'
         )
       FOR UPDATE OF g`,
      [tripId, actorId],
    )
    if (!participant.rowCount) throw new CoreError('정산 대상 참여자만 요금을 확인할 수 있습니다.')
    const existingConfirmation = await client.query(
      `SELECT 1
       FROM fare_confirmations
       WHERE trip_id = $1 AND user_id = $2
       FOR UPDATE`,
      [tripId, actorId],
    )
    if (existingConfirmation.rowCount) return
    await client.query(
      `INSERT INTO fare_confirmations (trip_id, user_id, idempotency_key)
       VALUES ($1, $2, $3)`,
      [tripId, actorId, idempotencyKey],
    )
  })
}

export async function settleTrip(
  actorId: string,
  tripId: string,
  idempotencyKey: string,
) {
  await inTransaction(async (client) => {
    await requireActiveUserForAction(client, actorId)
    const trip = await client.query(
      `SELECT g.host_user_id, g.status, s.actual_fare, s.final_share,
              s.participant_count, s.status AS settlement_status,
              s.settlement_idempotency_key, s.confirmation_deadline
       FROM trip_groups g JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1 FOR UPDATE OF g, s`,
      [tripId],
    )
    const row = trip.rows[0]
    if (!row || row.host_user_id !== actorId) throw new CoreError('방장만 최종 정산할 수 있습니다.')
    if (row.settlement_status === 'COMPLETED' && row.settlement_idempotency_key === idempotencyKey) return
    if (row.status !== 'SETTLEMENT_PENDING' || row.settlement_status !== 'PENDING_CONFIRMATION') {
      throw new CoreError('정산 대기 상태가 아닙니다.')
    }
    const confirmations = await client.query(
      `SELECT count(*)::int AS count FROM fare_confirmations WHERE trip_id = $1`,
      [tripId],
    )
    const openDisputes = await client.query(
      `SELECT count(*)::int AS count
       FROM fare_disputes
       WHERE trip_id = $1 AND status = 'OPEN'`,
      [tripId],
    )
    if (Number(openDisputes.rows[0].count) > 0) {
      throw new CoreError('실제 요금 이의제기가 처리되기 전에는 최종 정산할 수 없습니다.')
    }
    const allConfirmed = confirmations.rows[0].count === row.participant_count
    const confirmationExpired = new Date(row.confirmation_deadline).getTime() <= Date.now()
    if (!allConfirmed && !confirmationExpired) {
      throw new CoreError('모든 확정 참여자가 실제 요금을 확인해야 합니다.')
    }
    const deposits = await client.query(
      `SELECT user_id, deposit_amount AS amount
       FROM trip_settlement_participants
       WHERE trip_id = $1
       ORDER BY user_id
       FOR UPDATE`,
      [tripId],
    )
    if (deposits.rowCount !== row.participant_count) {
      throw new CoreError('확정 당시 예치 참여자 정보가 정산 정보와 일치하지 않습니다.')
    }
    const userIds = deposits.rows.map((item) => item.user_id as string)
    await client.query(
      `SELECT user_id FROM users WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE`,
      [userIds],
    )
    const balances = await client.query(
      `SELECT user_id, available_points
       FROM point_accounts
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    const availableByUser = new Map(
      balances.rows.map((balance) => [
        balance.user_id as string,
        Number(balance.available_points),
      ]),
    )
    for (const deposit of deposits.rows) {
      const additionalDebit = Math.max(
        0,
        Number(row.final_share) - Number(deposit.amount),
      )
      if (
        (availableByUser.get(deposit.user_id as string) ?? 0) <
        additionalDebit
      ) {
        throw new CoreError('정산 참여자 중 추가 차감에 필요한 사용 가능 포인트가 부족합니다.')
      }
    }
    for (const deposit of deposits.rows) {
      const depositAmount = Number(deposit.amount)
      const finalShare = Number(row.final_share)
      const chargedFromDeposit = Math.min(depositAmount, finalShare)
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, reason, idempotency_key
         ) VALUES ($1, 'SETTLEMENT_CHARGE', 0, $2, $3, $4, '예치금 정산', $5)`,
        [deposit.user_id, -chargedFromDeposit, tripId, actorId, `trip:${tripId}:charge:${deposit.user_id}`],
      )
      if (depositAmount > finalShare) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, reason, idempotency_key
           ) VALUES ($1, 'REFUND', $2, $3, $4, $5, '정산 차액 반환', $6)`,
          [
            deposit.user_id,
            depositAmount - finalShare,
            -(depositAmount - finalShare),
            tripId,
            actorId,
            `trip:${tripId}:refund:${deposit.user_id}`,
          ],
        )
      } else if (depositAmount < finalShare) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, reason, idempotency_key
           ) VALUES ($1, 'ADDITIONAL_DEBIT', $2, 0, $3, $4, '정산 추가 차감', $5)`,
          [deposit.user_id, -(finalShare - depositAmount), tripId, actorId, `trip:${tripId}:debit:${deposit.user_id}`],
        )
      }
    }
    await client.query(
      `UPDATE trip_participants SET status = 'COMPLETED', completed_at = now()
       WHERE trip_id = $1
         AND user_id = ANY($2::uuid[])
         AND status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')`,
      [tripId, userIds],
    )
    await client.query(
      `UPDATE trip_settlements
       SET status = 'COMPLETED', settlement_idempotency_key = $2, settled_at = now(),
           settled_by_user_id = $3, settlement_mode = 'HOST'
       WHERE trip_id = $1`,
      [tripId, idempotencyKey, actorId],
    )
    await client.query(
      `UPDATE trip_groups SET status = 'COMPLETED' WHERE trip_id = $1`,
      [tripId],
    )
  })
}

type DeadlineSettlementResult = 'SETTLED' | 'SKIPPED'

async function settleTripAtDeadline(
  tripId: string,
): Promise<DeadlineSettlementResult> {
  return inTransaction(async (client) => {
    const trip = await client.query(
      `SELECT g.status, s.actual_fare, s.final_share, s.participant_count,
              s.status AS settlement_status, s.fare_revision,
              s.resubmission_required, s.confirmation_deadline,
              s.confirmation_deadline <= now() AS deadline_due
       FROM trip_groups g
       JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1
       FOR UPDATE OF g, s`,
      [tripId],
    )
    const row = trip.rows[0]
    if (
      !row ||
      row.status !== 'SETTLEMENT_PENDING' ||
      row.settlement_status !== 'PENDING_CONFIRMATION' ||
      row.resubmission_required ||
      !row.deadline_due
    ) {
      return 'SKIPPED'
    }

    const disputes = await client.query(
      `SELECT 1 FROM fare_disputes
       WHERE trip_id = $1 AND status = 'OPEN'
       LIMIT 1
       FOR UPDATE`,
      [tripId],
    )
    if (disputes.rowCount) return 'SKIPPED'

    const deposits = await client.query(
      `SELECT user_id, deposit_amount AS amount
       FROM trip_settlement_participants
       WHERE trip_id = $1
       ORDER BY user_id
       FOR UPDATE`,
      [tripId],
    )
    if (deposits.rowCount !== Number(row.participant_count)) return 'SKIPPED'

    const userIds = deposits.rows.map((item) => item.user_id as string)
    const participants = await client.query(
      `SELECT user_id, status
       FROM trip_participants
       WHERE trip_id = $1 AND user_id = ANY($2::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [tripId, userIds],
    )
    if (
      participants.rowCount !== Number(row.participant_count) ||
      participants.rows.some(
        (participant) =>
          !['DEPOSITED', 'CHECKED_IN', 'NO_SHOW'].includes(participant.status),
      )
    ) {
      return 'SKIPPED'
    }

    const balances = await client.query(
      `SELECT user_id, available_points, held_points
       FROM point_accounts
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR UPDATE`,
      [userIds],
    )
    if (balances.rowCount !== Number(row.participant_count)) return 'SKIPPED'
    const balanceByUser = new Map(
      balances.rows.map((balance) => [
        balance.user_id as string,
        {
          available: Number(balance.available_points),
          held: Number(balance.held_points),
        },
      ]),
    )
    for (const deposit of deposits.rows) {
      const amount = Number(deposit.amount)
      const balance = balanceByUser.get(deposit.user_id as string)
      const additionalDebit = Math.max(0, Number(row.final_share) - amount)
      if (!balance || balance.held < amount || balance.available < additionalDebit) {
        return 'SKIPPED'
      }
    }

    const executionKey = `deadline:${tripId}:revision:${row.fare_revision}`
    const command = await client.query(
      `INSERT INTO system_deadline_commands (
         trip_id, fare_revision, command_type, execution_key
       ) VALUES ($1, $2, 'SETTLE_DEADLINE', $3)
       ON CONFLICT (trip_id, fare_revision, command_type) DO NOTHING
       RETURNING command_id`,
      [tripId, row.fare_revision, executionKey],
    )
    const commandId = command.rows[0]?.command_id as string | undefined
    if (!commandId) return 'SKIPPED'

    for (const deposit of deposits.rows) {
      const userId = deposit.user_id as string
      const depositAmount = Number(deposit.amount)
      const finalShare = Number(row.final_share)
      const chargedFromDeposit = Math.min(depositAmount, finalShare)
      await client.query(
        `INSERT INTO point_ledger (
           user_id, entry_type, available_delta, held_delta, trip_id,
           actor_user_id, system_deadline_command_id, reason, idempotency_key
         ) VALUES ($1, 'SETTLEMENT_CHARGE', 0, $2, $3, NULL, $4, 'system deadline settlement charge', $5)`,
        [
          userId,
          -chargedFromDeposit,
          tripId,
          commandId,
          `system-deadline:${tripId}:revision:${row.fare_revision}:charge:${userId}`,
        ],
      )
      if (depositAmount > finalShare) {
        const refund = depositAmount - finalShare
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, system_deadline_command_id, reason, idempotency_key
           ) VALUES ($1, 'REFUND', $2, $3, $4, NULL, $5, 'system deadline settlement refund', $6)`,
          [
            userId,
            refund,
            -refund,
            tripId,
            commandId,
            `system-deadline:${tripId}:revision:${row.fare_revision}:refund:${userId}`,
          ],
        )
      } else if (depositAmount < finalShare) {
        await client.query(
          `INSERT INTO point_ledger (
             user_id, entry_type, available_delta, held_delta, trip_id,
             actor_user_id, system_deadline_command_id, reason, idempotency_key
           ) VALUES ($1, 'ADDITIONAL_DEBIT', $2, 0, $3, NULL, $4, 'system deadline settlement additional debit', $5)`,
          [
            userId,
            -(finalShare - depositAmount),
            tripId,
            commandId,
            `system-deadline:${tripId}:revision:${row.fare_revision}:debit:${userId}`,
          ],
        )
      }
    }

    await client.query(
      `UPDATE trip_participants SET status = 'COMPLETED', completed_at = now()
       WHERE trip_id = $1 AND user_id = ANY($2::uuid[])
         AND status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')`,
      [tripId, userIds],
    )
    await client.query(
      `UPDATE trip_settlements
       SET status = 'COMPLETED', settlement_idempotency_key = $2, settled_at = now(),
           settled_by_user_id = NULL, settlement_mode = 'SYSTEM_DEADLINE',
           system_deadline_command_id = $3
       WHERE trip_id = $1`,
      [tripId, randomUUID(), commandId],
    )
    await client.query(
      `UPDATE trip_groups SET status = 'COMPLETED' WHERE trip_id = $1`,
      [tripId],
    )
    return 'SETTLED'
  })
}

export async function processDueTransitions() {
  await ensureDatabaseIdentity()
  const closed = await closeDueTrips()
  const sql = getDatabase()
  const dueSettlements = await sql`
    SELECT s.trip_id AS "tripId", s.allocation_policy AS "allocationPolicy",
           s.status AS "settlementStatus"
    FROM trip_settlements s
    JOIN trip_groups g ON g.trip_id = s.trip_id
    WHERE g.status = 'SETTLEMENT_PENDING'
      AND s.resubmission_required = false
      AND (
        (
          s.allocation_policy = 'LEGACY_CEIL'
          AND s.status = 'PENDING_CONFIRMATION'
          AND s.confirmation_deadline <= now()
        )
        OR (
          s.allocation_policy = 'HOST_APPROVAL_ORDER'
          AND s.status = 'PENDING_CONFIRMATION'
          AND (
            s.agreement_deadline <= now()
            OR NOT EXISTS (
              SELECT 1
              FROM trip_settlement_participants sp
              LEFT JOIN fare_confirmations c
                ON c.trip_id = sp.trip_id AND c.user_id = sp.user_id
              WHERE sp.trip_id = s.trip_id AND c.user_id IS NULL
            )
          )
        )
        OR (
          s.allocation_policy = 'HOST_APPROVAL_ORDER'
          AND s.status = 'PROVISIONALLY_SETTLED'
          AND s.dispute_deadline <= now()
        )
      )
    ORDER BY s.agreement_deadline NULLS LAST, s.confirmation_deadline, s.trip_id
    LIMIT 100
  `
  let settled = 0
  let skipped = 0
  for (const due of dueSettlements as {
    tripId: string
    allocationPolicy: string
    settlementStatus: string
  }[]) {
    const result = due.allocationPolicy === 'HOST_APPROVAL_ORDER'
      ? due.settlementStatus === 'PENDING_CONFIRMATION'
        ? await provisionallySettleTripV2({ tripId: due.tripId, idempotencyKey: randomUUID() })
        : await finalizePolicyV2Settlement({ tripId: due.tripId, idempotencyKey: randomUUID() })
      : await settleTripAtDeadline(due.tripId)
    if (result === 'SETTLED') settled += 1
    else skipped += 1
  }
  const effectedSuspensions = await inTransaction((client) =>
    effectDueAccountSuspensions(client),
  )
  return {
    closed,
    scannedSettlements: dueSettlements.length,
    settled,
    skipped,
    effectedSuspensions,
  }
}

export async function forceSettleFareDisputeByAdmin(input: {
  adminId: string
  tripId: string
  disputeId: string
  resolutionNote: string
  idempotencyKey: string
}) {
  const note = input.resolutionNote.trim()
  if (!note || note.length > 1000) {
    throw new CoreError('강제 정산 사유는 1~1,000자로 입력해 주세요.')
  }
  if (
    !isPointRequestUuid(input.adminId) || !isPointRequestUuid(input.tripId) ||
    !isPointRequestUuid(input.disputeId) || !isPointRequestUuid(input.idempotencyKey)
  ) {
    throw new CoreError('강제 정산 요청 식별자가 올바르지 않습니다.')
  }
  await inTransaction(async (client) => {
    const admin = await client.query(
      `SELECT 1 FROM users
       WHERE user_id = $1 AND role = 'ADMIN' AND account_status = 'ACTIVE'
       FOR UPDATE`,
      [input.adminId],
    )
    if (!admin.rowCount) throw new CoreError('활성 관리자만 강제 정산할 수 있습니다.')
    const trip = await client.query(
      `SELECT g.status, s.actual_fare, s.final_share, s.participant_count,
              s.status AS settlement_status, s.settlement_idempotency_key,
              s.fare_revision, s.resubmission_required, s.settlement_mode,
              s.admin_dispute_command_id
       FROM trip_groups g JOIN trip_settlements s ON s.trip_id = g.trip_id
       WHERE g.trip_id = $1 FOR UPDATE OF g, s`,
      [input.tripId],
    )
    const row = trip.rows[0]
    if (!row) throw new CoreError('정산 정보를 찾을 수 없습니다.')
    const replay = await client.query(
      `SELECT command_id, trip_id, dispute_id, reason, fare_revision
       FROM admin_dispute_commands
       WHERE admin_user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [input.adminId, input.idempotencyKey],
    )
    if (replay.rowCount) {
      const command = replay.rows[0]
      if (
        command.trip_id === input.tripId && command.dispute_id === input.disputeId &&
        command.reason === note && Number(command.fare_revision) === Number(row.fare_revision) &&
        row.settlement_mode === 'ADMIN_FORCE' && row.admin_dispute_command_id === command.command_id
      ) return
      throw new CoreError('이미 다른 관리자 처리 요청에 사용한 식별자입니다.')
    }
    if (
      row.status !== 'SETTLEMENT_PENDING' || row.settlement_status !== 'PENDING_CONFIRMATION' ||
      row.resubmission_required
    ) {
      throw new CoreError('현재 확인 대기 중인 요금만 강제 정산할 수 있습니다.')
    }
    const disputes = await client.query(
      `SELECT dispute_id, status, fare_revision FROM fare_disputes
       WHERE trip_id = $1 AND status = 'OPEN' ORDER BY dispute_id FOR UPDATE`,
      [input.tripId],
    )
    if (
      disputes.rowCount !== 1 || disputes.rows[0].dispute_id !== input.disputeId ||
      Number(disputes.rows[0].fare_revision) !== Number(row.fare_revision)
    ) {
      throw new CoreError('강제 정산은 현재 요금에 대한 마지막 열린 이의를 처리할 때만 가능합니다.')
    }
    const confirmations = await client.query(
      `SELECT count(*)::int AS count FROM fare_confirmations WHERE trip_id = $1`,
      [input.tripId],
    )
    const command = await client.query(
      `INSERT INTO admin_dispute_commands (
         trip_id, dispute_id, fare_revision, command_type, previous_actual_fare,
         revised_actual_fare, participant_count, final_share, confirmation_count,
         confirmation_deadline, reason, admin_user_id, idempotency_key
       )
       SELECT $1, $2, s.fare_revision, 'FORCE_SETTLE', s.actual_fare,
              s.actual_fare, s.participant_count, s.final_share, $3,
              s.confirmation_deadline, $4, $5, $6
       FROM trip_settlements s WHERE s.trip_id = $1
       RETURNING command_id`,
      [input.tripId, input.disputeId, confirmations.rows[0].count, note, input.adminId, input.idempotencyKey],
    )
    const commandId = command.rows[0]?.command_id as string | undefined
    if (!commandId) throw new CoreError('강제 정산 감사 기록을 만들지 못했습니다.')
    await client.query(
      `UPDATE fare_disputes
       SET status = 'REJECTED', resolved_at = now(), resolution_note = $2,
           resolved_by_user_id = $3, resolution_idempotency_key = $4
       WHERE dispute_id = $1`,
      [input.disputeId, note, input.adminId, input.idempotencyKey],
    )
    const deposits = await client.query(
      `SELECT user_id, deposit_amount AS amount
       FROM trip_settlement_participants WHERE trip_id = $1
       ORDER BY user_id FOR UPDATE`,
      [input.tripId],
    )
    if (deposits.rowCount !== Number(row.participant_count)) {
      throw new CoreError('정산 대상 인원 스냅샷이 현재 정산 정보와 일치하지 않습니다.')
    }
    const userIds = deposits.rows.map((item) => item.user_id as string)
    await client.query(
      `SELECT user_id FROM users WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE`,
      [userIds],
    )
    const balances = await client.query(
      `SELECT user_id, available_points FROM point_accounts
       WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE`,
      [userIds],
    )
    const availableByUser = new Map(
      balances.rows.map((balance) => [balance.user_id as string, Number(balance.available_points)]),
    )
    for (const deposit of deposits.rows) {
      const additionalDebit = Math.max(0, Number(row.final_share) - Number(deposit.amount))
      if ((availableByUser.get(deposit.user_id as string) ?? 0) < additionalDebit) {
        throw new CoreError('추가 차감에 필요한 사용 가능 포인트가 부족합니다. 포인트 지급 후 다시 시도해 주세요.')
      }
    }
    for (const deposit of deposits.rows) {
      const depositAmount = Number(deposit.amount)
      const finalShare = Number(row.final_share)
      const chargedFromDeposit = Math.min(depositAmount, finalShare)
      await client.query(
        `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
         VALUES ($1, 'SETTLEMENT_CHARGE', 0, $2, $3, $4, '관리자 강제 정산 예치금 차감', $5)`,
        [deposit.user_id, -chargedFromDeposit, input.tripId, input.adminId, `trip:${input.tripId}:charge:${deposit.user_id}`],
      )
      if (depositAmount > finalShare) {
        const refund = depositAmount - finalShare
        await client.query(
          `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
           VALUES ($1, 'REFUND', $2, $3, $4, $5, '관리자 강제 정산 차액 반환', $6)`,
          [deposit.user_id, refund, -refund, input.tripId, input.adminId, `trip:${input.tripId}:refund:${deposit.user_id}`],
        )
      } else if (depositAmount < finalShare) {
        await client.query(
          `INSERT INTO point_ledger (user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id, reason, idempotency_key)
           VALUES ($1, 'ADDITIONAL_DEBIT', $2, 0, $3, $4, '관리자 강제 정산 추가 차감', $5)`,
          [deposit.user_id, -(finalShare - depositAmount), input.tripId, input.adminId, `trip:${input.tripId}:debit:${deposit.user_id}`],
        )
      }
    }
    await client.query(
      `UPDATE trip_participants SET status = 'COMPLETED', completed_at = now()
       WHERE trip_id = $1 AND user_id = ANY($2::uuid[])
         AND status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')`,
      [input.tripId, userIds],
    )
    await client.query(
      `UPDATE trip_settlements
       SET status = 'COMPLETED', settlement_idempotency_key = $2, settled_at = now(),
           settled_by_user_id = $3, settlement_mode = 'ADMIN_FORCE',
           admin_dispute_command_id = $4
       WHERE trip_id = $1`,
      [input.tripId, input.idempotencyKey, input.adminId, commandId],
    )
    await client.query(`UPDATE trip_groups SET status = 'COMPLETED' WHERE trip_id = $1`, [input.tripId])
  })
}
