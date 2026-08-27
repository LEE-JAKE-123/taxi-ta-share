import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from '@neondatabase/serverless'

const databaseUrl =
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL
const expectedDatabaseName = process.env.DATABASE_EXPECTED_NAME
const expectedFingerprint = process.env.DATABASE_FINGERPRINT
const expectedEnvironment = process.env.APP_ENVIRONMENT
const expectedRole =
  process.env.DATABASE_EXPECTED_MIGRATION_ROLE ??
  process.env.DATABASE_EXPECTED_RUNTIME_ROLE
const domainMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0003_mvp_domain_completion.sql'))
  .digest('hex')
const lifecycleMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0004_sprint2_trip_lifecycle.sql'))
  .digest('hex')
const fareEvidenceMigrationChecksum = createHash('sha256')
  .update(
    await readFile('db/migrations/0005_provider_neutral_fare_evidence.sql'),
  )
  .digest('hex')
const confirmationGuardMigrationChecksum = createHash('sha256')
  .update(
    await readFile(
      'db/migrations/0006_require_fare_evidence_for_confirmation.sql',
    ),
  )
  .digest('hex')
const participationGuardMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0007_participation_state_guards.sql'))
  .digest('hex')
const recommendationEvidenceMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0008_recommendation_evidence_v2.sql'))
  .digest('hex')
const recommendationCapacityMigrationChecksum = createHash('sha256')
  .update(
    await readFile(
      'db/migrations/0009_recommendation_capacity_snapshot_guard.sql',
    ),
  )
  .digest('hex')
const sprint6PointEscrowMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0010_sprint6_point_escrow.sql'))
  .digest('hex')
const demoTripJourneyMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0012_demo_trip_journey.sql'))
  .digest('hex')
const hostArrivalSettlementMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0013_host_arrival_equal_split.sql'))
  .digest('hex')
const confirmedCohortSettlementMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0014_confirmed_cohort_settlement.sql'))
  .digest('hex')
const fareDisputeResolutionMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0015_fare_dispute_resolution.sql'))
  .digest('hex')
const designatedFareSubmitterMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0016_designated_fare_submitter.sql'))
  .digest('hex')
const adminDisputeCommandsMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0017_admin_dispute_commands.sql'))
  .digest('hex')
const systemDeadlineSettlementMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0018_system_deadline_settlement.sql'))
  .digest('hex')
const safetyReportsMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0019_safety_reports_blocks_support.sql'))
  .digest('hex')
const designatedFareSubmissionGuardMigrationChecksum = createHash('sha256')
  .update(
    await readFile('db/migrations/0020_designated_fare_submission_guard.sql'),
  )
  .digest('hex')
const tripGroupHostMemoMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0021_trip_group_host_memo.sql'))
  .digest('hex')
const provisionalSettlementDebtMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0022_provisional_settlement_debt.sql'))
  .digest('hex')
const policyV2SettlementGuardsMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0023_policy_v2_settlement_guards.sql'))
  .digest('hex')
const policyV2ProvisionalAtomicityMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0024_policy_v2_provisional_atomicity.sql'))
  .digest('hex')
const policyV2OpenDebtTimestampMigrationChecksum = createHash('sha256')
  .update(
    await readFile(
      'db/migrations/0025_policy_v2_open_debt_settlement_timestamp.sql',
    ),
  )
  .digest('hex')
const policyV2DisputeAdjustmentsMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0026_policy_v2_dispute_adjustments.sql'))
  .digest('hex')
const policyV2AdjustmentTriggerDispatchMigrationChecksum = createHash('sha256')
  .update(
    await readFile('db/migrations/0027_policy_v2_adjustment_trigger_dispatch.sql'),
  )
  .digest('hex')
const policyV2DebtRepaymentMigrationChecksum = createHash('sha256')
  .update(
    await readFile('db/migrations/0028_policy_v2_debt_repayment_and_eligibility.sql'),
  )
  .digest('hex')
const debtRepaymentLedgerTypeMigrationChecksum = createHash('sha256')
  .update(
    await readFile('db/migrations/0029_debt_repayment_ledger_type_guard.sql'),
  )
  .digest('hex')
const predepartureEscrowGuardMigrationChecksum = createHash('sha256')
  .update(
    await readFile('db/migrations/0030_predeparture_escrow_guard.sql'),
  )
  .digest('hex')
const tripIncidentIntakeMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0031_trip_incident_intake.sql'))
  .digest('hex')
const tripIncidentReviewWorkflowMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0032_trip_incident_review_workflow.sql'))
  .digest('hex')
const memberNoShowExecutionMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0033_member_no_show_execution.sql'))
  .digest('hex')
const hostNoStartRefundExecutionMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0034_host_no_start_refund_execution.sql'))
  .digest('hex')
const tripIncidentRebuttalWindowMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0035_trip_incident_rebuttal_window.sql'))
  .digest('hex')
const adminPointGrantDualControlMigrationChecksum = createHash('sha256')
  .update(await readFile('db/migrations/0036_admin_point_grant_dual_control.sql'))
  .digest('hex')
const incidentAndPointSafetyVerificationFiles = [
  'db/verify/0030_predeparture_escrow_guard.sql',
  'db/verify/0031_trip_incident_intake.sql',
  'db/verify/0032_trip_incident_review_workflow.sql',
  'db/verify/0033_member_no_show_execution.sql',
  'db/verify/0034_host_no_start_refund_execution.sql',
  'db/verify/0035_trip_incident_rebuttal_window.sql',
  'db/verify/0036_admin_point_grant_dual_control.sql',
]

if (
  !databaseUrl ||
  !expectedDatabaseName ||
  !expectedFingerprint ||
  !expectedEnvironment ||
  !expectedRole
) {
  throw new Error(
    'Database URL, name, fingerprint, environment, and expected role are required.',
  )
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()

try {
  const identity = await client.query(
    'SELECT current_database() AS database_name, current_user AS database_user',
  )
  const actualDatabaseName = identity.rows[0]?.database_name

  if (
    actualDatabaseName !== expectedDatabaseName ||
    identity.rows[0]?.database_user !== expectedRole
  ) {
    throw new Error(
      `Database guard failed: expected ${expectedDatabaseName}, received ${actualDatabaseName}.`,
    )
  }

  const result = await client.query(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS users_exists,
      to_regclass('public.auth_sessions') IS NOT NULL AS sessions_exists,
      to_regclass('public.schema_migrations') IS NOT NULL AS migrations_exists,
      to_regclass('public.trip_groups') IS NOT NULL AS trips_exists,
      to_regclass('public.trip_participants') IS NOT NULL AS participants_exists,
      to_regclass('public.trip_settlements') IS NOT NULL AS settlements_exists,
      to_regclass('public.point_accounts') IS NOT NULL AS point_accounts_exists,
      to_regclass('public.point_ledger') IS NOT NULL AS point_ledger_exists,
      to_regclass('public.fare_disputes') IS NOT NULL AS fare_disputes_exists,
      to_regclass('public.trip_recommendation_evidence') IS NOT NULL
        AS recommendation_evidence_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0003_mvp_domain_completion'
          AND checksum = $3
          AND environment = $1
      ) AS domain_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0004_sprint2_trip_lifecycle'
          AND checksum = $4
          AND environment = $1
      ) AS lifecycle_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0005_provider_neutral_fare_evidence'
          AND checksum = $5
          AND environment = $1
      ) AS fare_evidence_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0006_require_fare_evidence_for_confirmation'
          AND checksum = $6
          AND environment = $1
      ) AS confirmation_guard_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0007_participation_state_guards'
          AND checksum = $7
          AND environment = $1
      ) AS participation_guard_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0008_recommendation_evidence_v2'
          AND checksum = $8
          AND environment = $1
      ) AS recommendation_evidence_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0009_recommendation_capacity_snapshot_guard'
          AND checksum = $9
          AND environment = $1
      ) AS recommendation_capacity_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0010_sprint6_point_escrow'
          AND checksum = $10
          AND environment = $1
      ) AS sprint6_point_escrow_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0012_demo_trip_journey'
          AND checksum = $11
          AND environment = $1
      ) AS demo_trip_journey_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0013_host_arrival_equal_split'
          AND checksum = $12
          AND environment = $1
      ) AS host_arrival_settlement_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0014_confirmed_cohort_settlement'
          AND checksum = $13
          AND environment = $1
      ) AS confirmed_cohort_settlement_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0015_fare_dispute_resolution'
          AND checksum = $14
          AND environment = $1
      ) AS fare_dispute_resolution_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0016_designated_fare_submitter'
          AND checksum = $15
          AND environment = $1
      ) AS designated_fare_submitter_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0017_admin_dispute_commands'
          AND checksum = $16
          AND environment = $1
      ) AS admin_dispute_commands_migration_valid,
      to_regclass('public.admin_dispute_commands') IS NOT NULL
        AS admin_dispute_commands_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0018_system_deadline_settlement'
          AND checksum = $17
          AND environment = $1
      ) AS system_deadline_settlement_migration_valid,
      to_regclass('public.system_deadline_commands') IS NOT NULL
        AS system_deadline_commands_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'trip_settlements'
          AND indexname = 'trip_settlements_pending_deadline_idx'
      ) AS due_settlement_index_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0019_safety_reports_blocks_support'
          AND checksum = $18
          AND environment = $1
      ) AS safety_reports_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0020_designated_fare_submission_guard'
          AND checksum = $19
          AND environment = $1
      ) AS designated_fare_submission_guard_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0021_trip_group_host_memo'
          AND checksum = $20
          AND environment = $1
      ) AS trip_group_host_memo_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0022_provisional_settlement_debt'
          AND checksum = $21
          AND environment = $1
      ) AS provisional_settlement_debt_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0023_policy_v2_settlement_guards'
          AND checksum = $22
          AND environment = $1
      ) AS policy_v2_settlement_guards_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0024_policy_v2_provisional_atomicity'
          AND checksum = $23
          AND environment = $1
      ) AS policy_v2_provisional_atomicity_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0025_policy_v2_open_debt_settlement_timestamp'
          AND checksum = $24
          AND environment = $1
      ) AS policy_v2_open_debt_timestamp_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0026_policy_v2_dispute_adjustments'
          AND checksum = $25
          AND environment = $1
      ) AS policy_v2_dispute_adjustments_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0027_policy_v2_adjustment_trigger_dispatch'
          AND checksum = $26
          AND environment = $1
      ) AS policy_v2_adjustment_trigger_dispatch_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0028_policy_v2_debt_repayment_and_eligibility'
          AND checksum = $27
          AND environment = $1
      ) AS policy_v2_debt_repayment_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0029_debt_repayment_ledger_type_guard'
          AND checksum = $28
          AND environment = $1
      ) AS debt_repayment_ledger_type_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0030_predeparture_escrow_guard'
          AND checksum = $29
          AND environment = $1
      ) AS predeparture_escrow_guard_migration_valid,
      to_regprocedure('assert_predeparture_closed_escrow(uuid)') IS NOT NULL
        AS predeparture_escrow_function_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_deposits'::regclass
          AND tgname = 'trip_deposits_validate_predeparture'
          AND NOT tgisinternal
      ) AS predeparture_deposit_insert_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_validate_confirmation_predeparture'
          AND tgdeferrable
          AND tginitdeferred
          AND NOT tgisinternal
      ) AS predeparture_confirmation_guard_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0031_trip_incident_intake'
          AND checksum = $30
          AND environment = $1
      ) AS trip_incident_intake_migration_valid,
      to_regclass('public.trip_incidents') IS NOT NULL
        AS trip_incidents_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incidents'::regclass
          AND tgname = 'trip_incidents_prevent_mutation'
          AND NOT tgisinternal
      ) AS trip_incident_immutability_guard_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0032_trip_incident_review_workflow'
          AND checksum = $31
          AND environment = $1
      ) AS trip_incident_review_workflow_migration_valid,
      to_regclass('public.trip_incident_rebuttals') IS NOT NULL
        AS trip_incident_rebuttals_exists,
      to_regclass('public.trip_incident_review_commands') IS NOT NULL
        AS trip_incident_review_commands_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_rebuttals'::regclass
          AND tgname = 'trip_incident_rebuttals_prevent_mutation'
          AND NOT tgisinternal
      ) AS trip_incident_rebuttal_immutability_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_review_commands'::regclass
          AND tgname = 'trip_incident_review_commands_validate_insert'
          AND NOT tgisinternal
      ) AS trip_incident_review_admin_guard_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0033_member_no_show_execution'
          AND checksum = $32
          AND environment = $1
      ) AS member_no_show_execution_migration_valid,
      to_regclass('public.trip_incident_no_show_executions') IS NOT NULL
        AS member_no_show_executions_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_no_show_executions'::regclass
          AND tgname = 'trip_incident_no_show_executions_validate_insert'
          AND NOT tgisinternal
      ) AS member_no_show_execution_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_no_show_executions'::regclass
          AND tgname = 'trip_incident_no_show_executions_require_participant'
          AND tgdeferrable
          AND tginitdeferred
          AND NOT tgisinternal
      ) AS member_no_show_execution_atomicity_guard_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0034_host_no_start_refund_execution'
          AND checksum = $33
          AND environment = $1
      ) AS host_no_start_refund_execution_migration_valid,
      to_regclass('public.trip_incident_no_start_refund_executions') IS NOT NULL
        AS host_no_start_refund_executions_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_no_start_refund_executions'::regclass
          AND tgname = 'trip_incident_no_start_refund_executions_validate_insert'
          AND NOT tgisinternal
      ) AS host_no_start_refund_execution_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_no_start_refund_executions'::regclass
          AND tgname = 'trip_incident_no_start_refund_executions_require_refunds'
          AND tgdeferrable
          AND tginitdeferred
          AND NOT tgisinternal
      ) AS host_no_start_refund_execution_atomicity_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'point_ledger_one_no_start_refund_per_execution_user_idx'
      ) AS host_no_start_refund_execution_ledger_unique_exists,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0035_trip_incident_rebuttal_window'
          AND checksum = $34
          AND environment = $1
      ) AS trip_incident_rebuttal_window_migration_valid,
      (
        SELECT count(*) = 1
        FROM schema_migrations
        WHERE version = '0036_admin_point_grant_dual_control'
          AND checksum = $35
          AND environment = $1
      ) AS admin_point_grant_dual_control_migration_valid,
      to_regclass('public.point_grant_execution_requests') IS NOT NULL
        AS point_grant_execution_requests_exists,
      to_regclass('public.point_grant_approval_commands') IS NOT NULL
        AS point_grant_approval_commands_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_grant_execution_requests'::regclass
          AND tgname = 'point_grant_execution_requests_validate_insert'
          AND NOT tgisinternal
      ) AS point_grant_execution_request_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_grant_approval_commands'::regclass
          AND tgname = 'point_grant_approval_commands_validate_insert'
          AND NOT tgisinternal
      ) AS point_grant_approval_guard_exists,
      (
        SELECT count(*) = 0
        FROM point_ledger l
        LEFT JOIN point_grant_execution_requests e
          ON e.execution_request_id = l.grant_execution_request_id
        LEFT JOIN point_grant_approval_commands a
          ON a.approval_command_id = l.grant_approval_command_id
        WHERE l.entry_type = 'ADMIN_GRANT'
          AND (
            (l.grant_execution_request_id IS NULL)
              <> (l.grant_approval_command_id IS NULL)
            OR (
              l.grant_execution_request_id IS NOT NULL
              AND (
                e.execution_request_id IS NULL
                OR a.approval_command_id IS NULL
                OR a.execution_request_id IS DISTINCT FROM e.execution_request_id
                OR l.user_id IS DISTINCT FROM e.target_user_id
                OR l.actor_user_id IS DISTINCT FROM e.requested_by_admin_id
                OR l.actor_user_id = a.approved_by_admin_id
                OR l.available_delta IS DISTINCT FROM e.amount
                OR l.reason IS DISTINCT FROM e.reason
                OR l.point_request_id IS DISTINCT FROM e.source_point_request_id
              )
            )
          )
      ) AS admin_point_grant_provenance_valid,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_ledger'::regclass
          AND tgname = 'point_ledger_require_linked_point_request_fulfillment'
          AND tgdeferrable
          AND tginitdeferred
          AND NOT tgisinternal
      ) AS linked_point_request_fulfillment_atomicity_guard_exists,
      (
        SELECT count(*) = 0
        FROM point_grant_execution_requests e
        JOIN point_ledger l
          ON l.grant_execution_request_id = e.execution_request_id
        LEFT JOIN point_grant_requests r
          ON r.request_id = e.source_point_request_id
        WHERE e.source_point_request_id IS NOT NULL
          AND (
            r.status IS DISTINCT FROM 'FULFILLED'
            OR r.fulfilled_ledger_id IS DISTINCT FROM l.ledger_id
            OR r.fulfilled_by IS DISTINCT FROM l.actor_user_id
          )
      ) AS linked_point_request_fulfillments_valid,
      to_regclass('public.trip_incident_review_notifications') IS NOT NULL
        AS trip_incident_review_notifications_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_review_notifications'::regclass
          AND tgname = 'trip_incident_review_notifications_validate_insert'
          AND NOT tgisinternal
      ) AS trip_incident_notification_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_incident_review_commands'::regclass
          AND tgname = 'trip_incident_review_commands_require_notification'
          AND tgdeferrable
          AND tginitdeferred
          AND NOT tgisinternal
      ) AS trip_incident_notification_atomicity_guard_exists,
      position(
        $$has_valid_notification IS DISTINCT FROM true$$
        IN pg_get_functiondef('validate_trip_incident_review_command()'::regprocedure)
      ) > 0 AS responsibility_confirmation_notification_guard_exists,
      position(
        $$OR ledger_entry_type <> 'DEBT_REPAYMENT'$$
        IN pg_get_functiondef('validate_point_debt_repayment()'::regprocedure)
      ) > 0 AS debt_repayment_ledger_type_guard_valid,
      (
        SELECT count(*) = 0
        FROM point_debt_events e
        LEFT JOIN point_ledger l ON l.ledger_id = e.repayment_ledger_id
        WHERE e.event_type = 'REPAYMENT'
          AND l.entry_type IS DISTINCT FROM 'DEBT_REPAYMENT'
      ) AS debt_repayment_links_valid,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'system_deadline_commands'::regclass
          AND tgname = 'system_deadline_commands_validate_policy_v2_linkage'
          AND NOT tgisinternal
      ) AS policy_v2_command_linkage_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_ledger'::regclass
          AND tgname = 'point_ledger_guard_policy_v2_provisional_state'
          AND NOT tgisinternal
      ) AS policy_v2_ledger_state_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_settlements'::regclass
          AND tgname = 'trip_settlements_validate_policy_v2_financials'
          AND NOT tgisinternal
      ) AS policy_v2_financial_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_debt_events'::regclass
          AND tgname = 'point_debt_events_validate_policy_v2'
          AND NOT tgisinternal
      ) AS policy_v2_debt_guard_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trip_settlements'
          AND column_name = 'agreement_deadline'
      ) AS agreement_deadline_column_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trip_settlements'
          AND column_name = 'dispute_deadline'
      ) AS dispute_deadline_column_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trip_settlement_participants'
          AND column_name = 'allocated_share'
      ) AS allocated_share_column_exists,
      to_regclass('public.point_debt_obligations') IS NOT NULL
        AS debt_obligations_exists,
      to_regclass('public.point_debt_events') IS NOT NULL AS debt_events_exists,
      to_regclass('public.policy_v2_adjustment_commands') IS NOT NULL
        AS adjustment_commands_exists,
      to_regclass('public.policy_v2_adjustment_allocations') IS NOT NULL
        AS adjustment_allocations_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'fare_disputes'::regclass
          AND tgname = 'fare_disputes_validate_policy_v2_resolved_command'
          AND NOT tgisinternal
      ) AS resolved_dispute_command_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_settlements'::regclass
          AND tgname = 'trip_settlements_validate_policy_v2_finalization_adjustments'
          AND NOT tgisinternal
      ) AS finalization_adjustment_guard_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'point_debt_obligations'
          AND column_name = 'settled_at'
          AND is_nullable = 'YES'
      ) AS debt_open_timestamp_nullable,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'trip_settlement_participants_allocation_rank_unique_idx'
      ) AS allocation_rank_index_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'point_debt_obligations_user_open_idx'
      ) AS debt_open_index_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_accounts'::regclass
          AND tgname = 'point_accounts_prevent_direct_debt_mutation'
          AND NOT tgisinternal
      ) AS direct_debt_projection_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_debt_events'::regclass
          AND tgname = 'point_debt_events_prevent_mutation'
          AND NOT tgisinternal
      ) AS debt_events_append_only,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'point_debt_events'::regclass
          AND tgname = 'point_debt_events_validate_repayment'
          AND NOT tgisinternal
      ) AS debt_repayment_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_guard_policy_v2_usage_eligibility'
          AND NOT tgisinternal
      ) AS debt_usage_eligibility_guard_exists,
      (
        SELECT count(*) = 0
        FROM trip_settlements s
        WHERE (s.allocation_policy = 'LEGACY_CEIL' AND (
            s.agreement_deadline IS NOT NULL
            OR s.dispute_deadline IS NOT NULL
            OR s.provisionally_settled_at IS NOT NULL
          ))
          OR (s.allocation_policy = 'HOST_APPROVAL_ORDER' AND (
            s.confirmation_deadline <> s.submitted_at + interval '10 minutes'
            OR s.agreement_deadline <> s.submitted_at + interval '10 minutes'
            OR s.dispute_deadline <> s.submitted_at + interval '24 hours'
            OR (s.status = 'PENDING_CONFIRMATION' AND s.provisionally_settled_at IS NOT NULL)
            OR (s.status IN ('PROVISIONALLY_SETTLED', 'COMPLETED')
              AND (s.provisionally_settled_at IS NULL
                OR s.provisionally_settled_at < s.submitted_at))
          ))
      ) AS policy_v2_deadlines_valid,
      (
        SELECT count(*) = 0
        FROM point_accounts a
        LEFT JOIN (
          SELECT user_id, coalesce(sum(outstanding_points), 0)::bigint AS outstanding_points
          FROM point_debt_obligations
          GROUP BY user_id
        ) d ON d.user_id = a.user_id
        WHERE a.debt_points < 0
          OR a.debt_points <> coalesce(d.outstanding_points, 0)
      ) AS debt_projection_valid,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trip_groups'
          AND column_name = 'host_memo'
          AND is_nullable = 'YES'
      ) AS trip_group_host_memo_column_exists,
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'trip_groups'::regclass
          AND conname = 'trip_groups_host_memo_valid'
          AND convalidated
      ) AS trip_group_host_memo_constraint_exists,
      (
        SELECT count(*) = 0
        FROM trip_groups
        WHERE host_memo IS NOT NULL
          AND (host_memo ~ E'^\\s*$' OR char_length(host_memo) > 60)
      ) AS trip_group_host_memos_valid,
      to_regclass('public.user_blocks') IS NOT NULL AS user_blocks_exists,
      to_regclass('public.user_reports') IS NOT NULL AS user_reports_exists,
      to_regclass('public.report_review_actions') IS NOT NULL
        AS report_review_actions_exists,
      to_regclass('public.support_tickets') IS NOT NULL AS support_tickets_exists,
      to_regclass('public.support_ticket_actions') IS NOT NULL
        AS support_ticket_actions_exists,
      to_regclass('public.user_enforcement_actions') IS NOT NULL
        AS user_enforcement_actions_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'user_blocks'
          AND indexname = 'user_blocks_blocked_lookup_idx'
      ) AS user_blocks_reverse_index_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'report_review_actions'::regclass
          AND tgname = 'report_review_actions_prevent_mutation'
          AND NOT tgisinternal
      ) AS report_actions_append_only,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'support_ticket_actions'::regclass
          AND tgname = 'support_ticket_actions_prevent_mutation'
          AND NOT tgisinternal
      ) AS support_actions_append_only,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'user_enforcement_actions'::regclass
          AND tgname = 'user_enforcement_actions_prevent_mutation'
          AND NOT tgisinternal
      ) AS enforcement_actions_append_only,
      (
        SELECT count(*) = 0
        FROM user_reports
        WHERE (reported_user_id IS NULL) = (trip_id IS NULL)
           OR reporter_user_id = reported_user_id
      ) AS reports_target_shape_valid,
      (
        SELECT count(*) = 1
        FROM application_environment
        WHERE singleton = true
          AND environment = $1
          AND fingerprint = $2
      ) AS environment_valid,
      (
        SELECT count(*) = 0
        FROM users
        WHERE nullif(btrim(student_id), '') IS NULL
           OR student_id <> btrim(student_id)
           OR nullif(btrim(name), '') IS NULL
           OR nullif(btrim(school_email), '') IS NULL
      ) AS users_valid,
      (
        SELECT count(*) = 0
        FROM auth_sessions s
        LEFT JOIN users u ON u.user_id = s.user_id
        WHERE u.user_id IS NULL
           OR s.expires_at <= s.created_at
           OR s.revoked_at < s.created_at
      ) AS sessions_valid,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'auth_sessions'
          AND indexname = 'auth_sessions_expires_at_idx'
      ) AS expiry_index_exists,
      (
        SELECT count(*) = 0
        FROM point_accounts
        WHERE available_points < 0 OR held_points < 0
      ) AS balances_nonnegative,
      (
        SELECT count(*) = 0
        FROM point_accounts a
        LEFT JOIN (
          SELECT
            user_id,
            sum(available_delta) AS available_points,
            sum(held_delta) AS held_points
          FROM point_ledger
          GROUP BY user_id
        ) l ON l.user_id = a.user_id
        WHERE a.available_points <> COALESCE(l.available_points, 0)
           OR a.held_points <> COALESCE(l.held_points, 0)
      ) AS ledger_balances_match,
      (
        SELECT count(*) = 0
        FROM trip_settlements
        WHERE confirmation_deadline IS NULL
           OR confirmation_deadline <= submitted_at
      ) AS settlement_deadlines_valid,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'point_ledger'::regclass
          AND tgname = 'point_ledger_prevent_mutation'
          AND NOT tgisinternal
      ) AS ledger_append_only,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'point_ledger'::regclass
          AND tgname = 'point_ledger_apply_to_account'
          AND NOT tgisinternal
          AND (tgtype & 2) = 0
      ) AS ledger_balance_trigger_is_after_insert,
      to_regclass('public.point_grant_requests') IS NOT NULL
        AS point_grant_requests_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'point_ledger'::regclass
          AND tgname = 'point_ledger_validate_sprint6'
          AND NOT tgisinternal
      ) AS point_ledger_sprint6_guard_exists,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'point_ledger'
          AND indexname = 'point_ledger_one_deposit_per_participant_idx'
      ) AS one_deposit_ledger_index_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_validate_escrow_confirmation'
          AND NOT tgisinternal
      ) AS trip_escrow_confirmation_guard_exists,
      (
        SELECT count(*) = 0
        FROM point_grant_requests r
        LEFT JOIN point_ledger l ON l.ledger_id = r.fulfilled_ledger_id
        WHERE r.status = 'FULFILLED'
          AND (
            l.ledger_id IS NULL
            OR l.entry_type <> 'ADMIN_GRANT'
            OR l.point_request_id <> r.request_id
            OR l.user_id <> r.requester_user_id
            OR l.actor_user_id <> r.fulfilled_by
            OR l.available_delta <> r.requested_amount
            OR l.held_delta <> 0
          )
      ) AS point_request_fulfillments_valid,
      (
        SELECT count(*) = 0
        FROM trip_groups
        WHERE NOT (
          (
            status = 'OPEN'
            AND closed_at IS NULL
            AND closure_type IS NULL
            AND cancelled_at IS NULL
          )
          OR (
            status = 'CANCELLED'
            AND closed_at IS NOT NULL
            AND closure_type = 'CANCELLED'
            AND cancelled_at IS NOT NULL
          )
          OR (
            status IN (
              'CLOSED', 'CONFIRMED', 'IN_PROGRESS',
              'SETTLEMENT_PENDING', 'COMPLETED', 'EXPIRED'
            )
            AND closed_at IS NOT NULL
            AND closure_type IN ('AUTO', 'HOST')
            AND cancelled_at IS NULL
          )
        )
      ) AS trip_lifecycle_valid,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_participants'::regclass
          AND tgname = 'trip_participants_enforce_capacity'
          AND NOT tgisinternal
      ) AS participant_capacity_trigger_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_enforce_closure_count'
          AND NOT tgisinternal
      ) AS closure_count_trigger_exists,
      (
        SELECT count(*) = 0
        FROM trip_groups g
        LEFT JOIN trip_participants p
          ON p.trip_id = g.trip_id
         AND p.role = 'HOST'
         AND p.user_id = g.host_user_id
        WHERE p.user_id IS NULL
      ) AS trip_hosts_valid,
      to_regclass('public.fare_estimates') IS NOT NULL
        AS fare_estimates_exists,
      (
        SELECT count(*) = 0
        FROM fare_estimates
        WHERE route_distance_m < 0
           OR duration_seconds < 0
           OR estimated_fare_won NOT BETWEEN 1 AND 1000000
           OR deposit_points_total NOT BETWEEN 1 AND 1000000
           OR expires_at <= calculated_at
           OR jsonb_typeof(calculation_basis) <> 'object'
           OR calculation_basis = '{}'::jsonb
      ) AS fare_estimates_valid,
      (
        SELECT count(*) = 0
        FROM trip_groups g
        JOIN fare_estimates f
          ON f.fare_estimate_id = g.current_fare_estimate_id
        WHERE f.trip_id <> g.trip_id
           OR f.trip_location_revision <> g.location_revision
           OR f.deposit_points_total IS DISTINCT FROM g.estimated_fare
      ) AS active_fare_estimates_valid,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_require_fare_evidence'
          AND NOT tgisinternal
      ) AS confirmation_guard_exists,
      (
        SELECT count(*) = 0
        FROM trip_groups g
        LEFT JOIN fare_estimates f
          ON f.trip_id = g.trip_id
         AND f.fare_estimate_id = g.current_fare_estimate_id
        WHERE g.status = 'CONFIRMED'
          AND (
            f.fare_estimate_id IS NULL
            OR f.trip_location_revision <> g.location_revision
            OR f.deposit_points_total IS DISTINCT FROM g.estimated_fare
            OR f.expires_at <= now()
          )
      ) AS confirmed_fare_evidence_valid,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_participants'::regclass
          AND tgname = 'trip_participants_require_open_trip'
          AND NOT tgisinternal
      ) AS participation_open_guard_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_guard_capacity_change'
          AND NOT tgisinternal
      ) AS capacity_change_guard_exists,
      (
        SELECT count(*) = 0
        FROM trip_participants p
        JOIN users u ON u.user_id = p.user_id
        WHERE p.status IN ('APPLIED', 'APPROVED')
          AND (
            u.account_status <> 'ACTIVE'
            OR nullif(btrim(u.student_id), '') IS NULL
            OR nullif(btrim(u.name), '') IS NULL
            OR nullif(btrim(u.school_email), '') IS NULL
          )
      ) AS active_participant_users_valid,
      (
        SELECT count(*) = 0
        FROM trip_recommendation_evidence e
        LEFT JOIN fare_estimates f
          ON f.trip_id = e.candidate_trip_id
         AND f.fare_estimate_id = e.fare_estimate_id
        WHERE e.evidence_version = 2
          AND (
            f.fare_estimate_id IS NULL
            OR e.evidence_expires_at <= e.calculated_at
            OR jsonb_typeof(e.rank_key) <> 'array'
            OR jsonb_typeof(e.reason_data) <> 'object'
            OR e.rank_position NOT BETWEEN 1 AND 50
            OR e.target_participants NOT BETWEEN 2 AND 4
            OR e.expected_share_points NOT BETWEEN 1 AND 1000000
          )
      ) AS recommendation_evidence_v2_valid,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_recommendation_evidence'::regclass
        AND tgname = 'trip_recommendation_evidence_validate_v2'
        AND NOT tgisinternal
      ) AS recommendation_evidence_v2_trigger_exists,
      (
        SELECT count(*) = 0
        FROM trip_participants p
        WHERE
          (p.status = 'CHECKED_IN' AND p.checked_in_at IS NULL)
          OR (
            p.status = 'NO_SHOW'
            AND (p.no_show_at IS NULL OR p.no_show_marked_by IS NULL)
          )
          OR (p.no_show_at IS NULL) <> (p.no_show_marked_by IS NULL)
      ) AS demo_journey_participants_valid,
      to_regclass('public.trip_settlement_participants') IS NOT NULL
        AS settlement_participants_exists,
      (
        SELECT count(*) = 0
        FROM trip_settlements s
        WHERE s.status = 'COMPLETED'
          AND EXISTS (
            SELECT 1 FROM trip_settlement_participants sp
            WHERE sp.trip_id = s.trip_id
          )
          AND s.participant_count <> (
            SELECT count(*)
            FROM trip_settlement_participants sp
            WHERE sp.trip_id = s.trip_id
          )
      ) AS settlement_boarded_cohort_valid,
      (
        SELECT count(*) = 0
        FROM trip_settlement_participants sp
        LEFT JOIN trip_participants p
          ON (p.trip_id, p.user_id) = (sp.trip_id, sp.user_id)
        LEFT JOIN trip_deposits d
          ON (d.trip_id, d.user_id) = (sp.trip_id, sp.user_id)
        JOIN trip_settlements s ON s.trip_id = sp.trip_id
        WHERE p.user_id IS NULL
           OR d.amount IS DISTINCT FROM sp.deposit_amount
           OR s.final_share IS DISTINCT FROM sp.final_share
           OR s.cohort_basis NOT IN ('BOARDED', 'ESCROW_CONFIRMED')
      ) AS settlement_participant_snapshots_valid,
      (
        SELECT count(*) = 0
        FROM trip_settlements s
        WHERE s.cohort_basis = 'ESCROW_CONFIRMED'
          AND s.status IN ('PENDING_CONFIRMATION', 'COMPLETED')
          AND s.participant_count <> (
            SELECT count(*)
            FROM trip_settlement_participants sp
            WHERE sp.trip_id = s.trip_id
          )
      ) AS confirmed_cohort_snapshot_count_valid,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'fare_disputes'::regclass
          AND tgname = 'fare_disputes_validate_submission'
          AND NOT tgisinternal
      ) AS fare_dispute_submission_guard_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'fare_confirmations'::regclass
          AND tgname = 'fare_confirmations_validate_submission'
          AND NOT tgisinternal
      ) AS fare_confirmation_submission_guard_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'fare_disputes'::regclass
          AND tgname = 'fare_disputes_validate_resolution'
          AND NOT tgisinternal
      ) AS fare_dispute_resolution_guard_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_groups'::regclass
          AND tgname = 'trip_groups_validate_designated_fare_submitter'
          AND NOT tgisinternal
      ) AS designated_fare_submitter_guard_exists,
      (
        SELECT count(*) = 0
        FROM trip_groups g
        LEFT JOIN trip_participants p
          ON p.trip_id = g.trip_id
         AND p.user_id = g.fare_submitter_user_id
        WHERE g.fare_submitter_user_id IS NOT NULL
          AND (
            p.user_id IS NULL
            OR p.role <> 'MEMBER'
          )
      ) AS designated_fare_submitter_valid,
      (
        SELECT count(*) = 0
        FROM fare_disputes d
        WHERE (d.status = 'OPEN') <> (
          d.resolved_at IS NULL
          AND d.resolution_note IS NULL
          AND d.resolved_by_user_id IS NULL
          AND d.resolution_idempotency_key IS NULL
        )
        OR (d.resolved_by_user_id IS NULL) <> (d.resolution_idempotency_key IS NULL)
      ) AS fare_dispute_resolution_shape_valid,
      (
        SELECT count(*) = 0
        FROM (
          SELECT d.trip_id, d.user_id
          FROM trip_deposits d
          JOIN trip_settlements s ON s.trip_id = d.trip_id
          JOIN point_ledger l
            ON l.trip_id = d.trip_id
           AND l.user_id = d.user_id
          WHERE s.status = 'COMPLETED'
          GROUP BY d.trip_id, d.user_id
          HAVING sum(l.held_delta) <> 0
        ) remaining
      ) AS completed_trip_holds_released,
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'trip_settlements'::regclass
          AND tgname = 'trip_settlements_validate_demo_cohort'
          AND NOT tgisinternal
      ) AS demo_settlement_cohort_trigger_exists,
      position(
        'fare_submitter_user_id'
        IN pg_get_functiondef('validate_demo_settlement_cohort()'::regprocedure)
      ) > 0 AS designated_fare_submission_guard_exists
  `, [
    expectedEnvironment,
    expectedFingerprint,
    domainMigrationChecksum,
    lifecycleMigrationChecksum,
    fareEvidenceMigrationChecksum,
    confirmationGuardMigrationChecksum,
    participationGuardMigrationChecksum,
    recommendationEvidenceMigrationChecksum,
    recommendationCapacityMigrationChecksum,
    sprint6PointEscrowMigrationChecksum,
    demoTripJourneyMigrationChecksum,
    hostArrivalSettlementMigrationChecksum,
    confirmedCohortSettlementMigrationChecksum,
    fareDisputeResolutionMigrationChecksum,
    designatedFareSubmitterMigrationChecksum,
    adminDisputeCommandsMigrationChecksum,
    systemDeadlineSettlementMigrationChecksum,
    safetyReportsMigrationChecksum,
    designatedFareSubmissionGuardMigrationChecksum,
    tripGroupHostMemoMigrationChecksum,
    provisionalSettlementDebtMigrationChecksum,
    policyV2SettlementGuardsMigrationChecksum,
    policyV2ProvisionalAtomicityMigrationChecksum,
    policyV2OpenDebtTimestampMigrationChecksum,
    policyV2DisputeAdjustmentsMigrationChecksum,
    policyV2AdjustmentTriggerDispatchMigrationChecksum,
    policyV2DebtRepaymentMigrationChecksum,
    debtRepaymentLedgerTypeMigrationChecksum,
    predepartureEscrowGuardMigrationChecksum,
    tripIncidentIntakeMigrationChecksum,
    tripIncidentReviewWorkflowMigrationChecksum,
    memberNoShowExecutionMigrationChecksum,
    hostNoStartRefundExecutionMigrationChecksum,
    tripIncidentRebuttalWindowMigrationChecksum,
    adminPointGrantDualControlMigrationChecksum,
  ])

  const verification = result.rows[0]
  const failedChecks = Object.entries(verification ?? {})
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name)

  if (failedChecks.length) {
    throw new Error(`Database verification failed: ${failedChecks.join(', ')}.`)
  }

  for (const verificationFile of incidentAndPointSafetyVerificationFiles) {
    const sql = await readFile(verificationFile, 'utf8')
    const focusedResult = await client.query(sql)
    if (focusedResult.rowCount !== 1) {
      throw new Error(`Database verification returned no result for ${verificationFile}.`)
    }

    const focusedFailures = Object.entries(focusedResult.rows[0] ?? {})
      .filter(([, passed]) => passed !== true)
      .map(([name]) => name)
    if (focusedFailures.length) {
      throw new Error(
        `Database verification failed for ${verificationFile}: ${focusedFailures.join(', ')}.`,
      )
    }
  }

  console.log(
    `Verified ${actualDatabaseName} as ${identity.rows[0]?.database_user}.`,
  )
} finally {
  client.release()
  await pool.end()
}
