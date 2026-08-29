import 'server-only'

import type { PoolClient } from '@neondatabase/serverless'

type SuspensionRequestRow = {
  request_id: string
  target_user_id: string
  requested_by_admin_id: string
  source_type: 'REPORT' | 'ADMIN_DIRECT'
  report_id: string | null
  reason: string
  idempotency_key: string
}

/**
 * Applies already-approved suspension requests only after every trip that
 * involves the user has reached a terminal state. Debt is deliberately not a
 * blocker: final settlement can create an append-only debt which is repaid by
 * the post-suspension, dual-admin assistance flow.
 */
export async function effectDueAccountSuspensions(
  client: PoolClient,
  targetUserId?: string,
) {
  const requests = await client.query<SuspensionRequestRow>(
    `SELECT request_id, target_user_id, requested_by_admin_id, source_type,
            report_id, reason, idempotency_key
     FROM account_suspension_requests
     WHERE effective_at IS NULL
       AND ($1::uuid IS NULL OR target_user_id = $1)
     ORDER BY requested_at, request_id
     FOR UPDATE`,
    [targetUserId ?? null],
  )

  let effected = 0
  for (const request of requests.rows) {
    const user = await client.query(
      `SELECT user_id, role, account_status
       FROM users WHERE user_id = $1 FOR UPDATE`,
      [request.target_user_id],
    )
    if (
      !user.rowCount ||
      user.rows[0].role !== 'USER' ||
      user.rows[0].account_status !== 'ACTIVE'
    ) {
      continue
    }

    const pending = await client.query(
      `SELECT
         EXISTS (
           SELECT 1
           FROM trip_groups g
           WHERE g.host_user_id = $1
             AND g.status IN (
               'OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS', 'SETTLEMENT_PENDING'
             )
         )
         OR EXISTS (
           SELECT 1
           FROM trip_participants p
           JOIN trip_groups g ON g.trip_id = p.trip_id
           WHERE p.user_id = $1
             AND p.status IN (
               'APPLIED', 'APPROVED', 'DEPOSITED', 'CHECKED_IN', 'NO_SHOW', 'DISPUTED'
             )
             AND g.status IN (
               'OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS', 'SETTLEMENT_PENDING'
             )
         )
         OR EXISTS (
           SELECT 1 FROM fare_disputes d
           WHERE d.user_id = $1 AND d.status = 'OPEN'
         )
         OR EXISTS (
           SELECT 1 FROM point_accounts a
           WHERE a.user_id = $1 AND a.held_points <> 0
         ) AS has_pending_obligation`,
      [request.target_user_id],
    )
    if (pending.rows[0]?.has_pending_obligation) continue

    const effect = await client.query(
      `UPDATE account_suspension_requests
       SET effective_at = now()
       WHERE request_id = $1 AND effective_at IS NULL
       RETURNING request_id`,
      [request.request_id],
    )
    if (!effect.rowCount) continue

    if (request.source_type === 'REPORT') {
      await client.query(
        `INSERT INTO user_enforcement_actions (
           user_id, report_id, admin_user_id, action_type, reason, idempotency_key
         ) VALUES ($1, $2, $3, 'SUSPEND', $4, $5)`,
        [
          request.target_user_id,
          request.report_id,
          request.requested_by_admin_id,
          request.reason,
          request.idempotency_key,
        ],
      )
    } else {
      await client.query(
        `INSERT INTO admin_account_actions (
           target_user_id, admin_user_id, action_type, reason, idempotency_key
         ) VALUES ($1, $2, 'SUSPEND', $3, $4)`,
        [
          request.target_user_id,
          request.requested_by_admin_id,
          request.reason,
          request.idempotency_key,
        ],
      )
    }

    await client.query(
      `UPDATE users SET account_status = 'SUSPENDED'
       WHERE user_id = $1 AND account_status = 'ACTIVE'`,
      [request.target_user_id],
    )
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1`,
      [request.target_user_id],
    )
    effected += 1
  }

  return effected
}

export async function assertNoPendingSuspensionForNewUse(
  client: PoolClient,
  userId: string,
) {
  const pending = await client.query(
    `SELECT 1 FROM account_suspension_requests
     WHERE target_user_id = $1 AND effective_at IS NULL
     FOR SHARE`,
    [userId],
  )
  if (pending.rowCount) {
    throw new Error(
      '정지 예정 계정은 진행 중인 이용의 정산만 마칠 수 있으며 새 이용을 시작할 수 없습니다.',
    )
  }
}
