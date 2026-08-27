import { randomUUID } from 'node:crypto'

type Queryable = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

/**
 * E2E fixtures must follow the same append-only grant provenance as production
 * writes.  This is intentionally a direct fixture helper: it seeds an already
 * approved direct grant without bypassing the database guards.
 */
export async function seedApprovedDirectGrant(input: {
  client: Queryable
  targetUserId: string
  amount: number
  requestedByAdminId: string
  approvedByAdminId: string
  reason: string
}) {
  const executionRequestId = randomUUID()
  const approvalCommandId = randomUUID()

  await input.client.query(
    `INSERT INTO point_grant_execution_requests (
       execution_request_id, target_user_id, amount, reason,
       requested_by_admin_id, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      executionRequestId,
      input.targetUserId,
      input.amount,
      input.reason,
      input.requestedByAdminId,
      randomUUID(),
    ],
  )
  await input.client.query(
    `INSERT INTO point_grant_approval_commands (
       approval_command_id, execution_request_id, approved_by_admin_id, idempotency_key
     ) VALUES ($1, $2, $3, $4)`,
    [approvalCommandId, executionRequestId, input.approvedByAdminId, randomUUID()],
  )
  await input.client.query(
    `INSERT INTO point_ledger (
       user_id, entry_type, available_delta, held_delta, trip_id, actor_user_id,
       grant_execution_request_id, grant_approval_command_id, reason, idempotency_key
     ) VALUES ($1, 'ADMIN_GRANT', $2, 0, NULL, $3, $4, $5, $6, $7)`,
    [
      input.targetUserId,
      input.amount,
      input.requestedByAdminId,
      executionRequestId,
      approvalCommandId,
      input.reason,
      randomUUID(),
    ],
  )
}

/** Creates the complete reviewed no-show fact used by settlement fixtures. */
export async function seedExecutedMemberNoShow(input: {
  client: Queryable
  tripId: string
  reporterUserId: string
  reportedUserId: string
  adminId: string
}) {
  const incidentId = randomUUID()
  const startCommandId = randomUUID()
  const decisionCommandId = randomUUID()
  const executionId = randomUUID()
  const executionKey = randomUUID()

  await input.client.query(
    `INSERT INTO trip_incidents (
       incident_id, trip_id, reporter_user_id, reported_user_id, incident_type,
       description, evidence_ref, idempotency_key
     ) VALUES ($1, $2, $3, $4, 'MEMBER_NO_SHOW',
       'E2E fixture establishes a reviewed member no-show fact.', NULL, $5)`,
    [incidentId, input.tripId, input.reporterUserId, input.reportedUserId, randomUUID()],
  )
  await input.client.query(
    `INSERT INTO trip_incident_review_commands (
       command_id, incident_id, admin_user_id, command_type, decision_note,
       evidence_basis, idempotency_key
     ) VALUES ($1, $2, $3, 'START_REVIEW', 'E2E review started.',
       'E2E fixture evidence is sufficient to open review.', $4)`,
    [startCommandId, incidentId, input.adminId, randomUUID()],
  )
  await input.client.query(
    `INSERT INTO trip_incident_review_notifications (
       incident_id, review_command_id, recipient_user_id, exposed_by,
       idempotency_key, rebuttal_deadline_at
     ) VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
    [incidentId, startCommandId, input.reportedUserId, input.adminId, randomUUID()],
  )
  await input.client.query(
    `INSERT INTO trip_incident_rebuttals (
       incident_id, author_user_id, statement, evidence_ref, idempotency_key
     ) VALUES ($1, $2, 'E2E fixture rebuttal closes the response precondition.', NULL, $3)`,
    [incidentId, input.reportedUserId, randomUUID()],
  )
  await input.client.query(
    `INSERT INTO trip_incident_review_commands (
       command_id, incident_id, admin_user_id, command_type, decision_note,
       evidence_basis, idempotency_key
     ) VALUES ($1, $2, $3, 'RESPONSIBILITY_CONFIRMED', 'E2E responsibility confirmed.',
       'E2E fixture review evidence and rebuttal were considered.', $4)`,
    [decisionCommandId, incidentId, input.adminId, randomUUID()],
  )
  await input.client.query(
    `INSERT INTO trip_incident_no_show_executions (
       execution_id, incident_id, review_command_id, trip_id, reported_user_id,
       executed_by, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      executionId,
      incidentId,
      decisionCommandId,
      input.tripId,
      input.reportedUserId,
      input.adminId,
      executionKey,
    ],
  )
  await input.client.query(
    `UPDATE trip_participants
     SET status = 'NO_SHOW', no_show_at = clock_timestamp(), no_show_marked_by = $3,
         no_show_idempotency_key = $4, no_show_execution_id = $5
     WHERE trip_id = $1 AND user_id = $2 AND status = 'DEPOSITED'`,
    [input.tripId, input.reportedUserId, input.adminId, executionKey, executionId],
  )

  return { incidentId, executionId, executionKey }
}
