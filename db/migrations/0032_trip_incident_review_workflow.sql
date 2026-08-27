-- DEC-015: incident review records are deliberately separate from money,
-- attendance, settlement, eligibility, and enforcement.  A later policy-bound
-- execution command may cite a terminal command, but this workflow cannot act.

CREATE TABLE trip_incident_rebuttals (
  rebuttal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES trip_incidents(incident_id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  statement text NOT NULL,
  evidence_ref text,
  idempotency_key uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_incident_rebuttals_statement_valid CHECK (
    btrim(statement) <> '' AND char_length(statement) BETWEEN 10 AND 2000
  ),
  CONSTRAINT trip_incident_rebuttals_evidence_valid CHECK (
    evidence_ref IS NULL
    OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 2000)
  ),
  CONSTRAINT trip_incident_rebuttals_one_per_incident UNIQUE (incident_id),
  CONSTRAINT trip_incident_rebuttals_idempotent UNIQUE (author_user_id, idempotency_key)
);

CREATE INDEX trip_incident_rebuttals_author_submitted_idx
  ON trip_incident_rebuttals (author_user_id, submitted_at DESC, rebuttal_id);

CREATE TABLE trip_incident_review_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES trip_incidents(incident_id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  command_type text NOT NULL,
  decision_note text NOT NULL,
  evidence_basis text NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_incident_review_commands_type_valid CHECK (
    command_type IN ('START_REVIEW', 'RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
  ),
  CONSTRAINT trip_incident_review_commands_note_valid CHECK (
    btrim(decision_note) <> '' AND char_length(decision_note) BETWEEN 10 AND 1000
  ),
  CONSTRAINT trip_incident_review_commands_evidence_basis_valid CHECK (
    btrim(evidence_basis) <> '' AND char_length(evidence_basis) BETWEEN 10 AND 2000
  ),
  CONSTRAINT trip_incident_review_commands_idempotent UNIQUE (admin_user_id, idempotency_key)
);

CREATE UNIQUE INDEX trip_incident_review_commands_one_start_idx
  ON trip_incident_review_commands (incident_id)
  WHERE command_type = 'START_REVIEW';

CREATE UNIQUE INDEX trip_incident_review_commands_one_terminal_idx
  ON trip_incident_review_commands (incident_id)
  WHERE command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED');

CREATE INDEX trip_incident_review_commands_admin_created_idx
  ON trip_incident_review_commands (admin_user_id, created_at DESC, command_id);

-- Harden the 0031 intake trigger against direct SQL writes.  The service
-- already applies these rules; keeping them here makes the evidence source
-- trustworthy for later review without changing any existing incident rows.
CREATE OR REPLACE FUNCTION validate_trip_incident_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_host_user_id uuid;
  trip_status text;
  departure_due boolean;
  reporter_role text;
  reporter_status text;
  reported_role text;
  reported_status text;
BEGIN
  SELECT
    g.host_user_id,
    g.status,
    g.departure_at <= clock_timestamp(),
    reporter.role,
    reporter.status,
    reported.role,
    reported.status
  INTO
    trip_host_user_id,
    trip_status,
    departure_due,
    reporter_role,
    reporter_status,
    reported_role,
    reported_status
  FROM trip_groups g
  JOIN trip_participants reporter
    ON reporter.trip_id = g.trip_id AND reporter.user_id = NEW.reporter_user_id
  JOIN trip_participants reported
    ON reported.trip_id = g.trip_id AND reported.user_id = NEW.reported_user_id
  JOIN trip_deposits reporter_deposit
    ON reporter_deposit.trip_id = reporter.trip_id
   AND reporter_deposit.user_id = reporter.user_id
  JOIN trip_deposits reported_deposit
    ON reported_deposit.trip_id = reported.trip_id
   AND reported_deposit.user_id = reported.user_id
  WHERE g.trip_id = NEW.trip_id
  FOR SHARE OF g, reporter, reported;

  IF NOT FOUND
    OR reporter_status NOT IN ('DEPOSITED', 'CHECKED_IN')
    OR (NEW.incident_type = 'HOST_NO_START' AND (
      NEW.reported_user_id <> trip_host_user_id
      OR trip_status <> 'CONFIRMED'
      OR departure_due IS DISTINCT FROM true
      OR reporter_role = 'HOST'
      OR reported_role <> 'HOST'
    ))
    OR (NEW.incident_type = 'MEMBER_NO_SHOW' AND (
      NEW.reported_user_id = trip_host_user_id
      OR trip_status <> 'IN_PROGRESS'
      OR reported_role = 'HOST'
      OR reported_status <> 'DEPOSITED'
    ))
  THEN
    RAISE EXCEPTION 'trip incident does not satisfy its intake state requirements'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_trip_incident_rebuttal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_user_id uuid;
  terminal_exists boolean;
BEGIN
  SELECT reported_user_id
  INTO subject_user_id
  FROM trip_incidents
  WHERE incident_id = NEW.incident_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id
      AND command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
  ) INTO terminal_exists;

  IF NOT FOUND OR subject_user_id <> NEW.author_user_id OR terminal_exists THEN
    RAISE EXCEPTION 'only the incident subject may submit one rebuttal before a decision'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_incident_rebuttals_validate_insert
BEFORE INSERT ON trip_incident_rebuttals
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_rebuttal();

CREATE OR REPLACE FUNCTION prevent_trip_incident_rebuttal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip incident rebuttals are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_incident_rebuttals_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_incident_rebuttals
FOR EACH ROW EXECUTE FUNCTION prevent_trip_incident_rebuttal_mutation();

CREATE OR REPLACE FUNCTION validate_trip_incident_review_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reporter_user_id uuid;
  reported_user_id uuid;
  incident_trip_id uuid;
  admin_role text;
  admin_status text;
  has_started boolean;
  has_terminal boolean;
  has_rebuttal boolean;
BEGIN
  SELECT trip_id, reporter_user_id, reported_user_id
  INTO incident_trip_id, reporter_user_id, reported_user_id
  FROM trip_incidents
  WHERE incident_id = NEW.incident_id
  FOR UPDATE;

  SELECT role, account_status
  INTO admin_role, admin_status
  FROM users
  WHERE user_id = NEW.admin_user_id
  FOR SHARE;

  IF NOT FOUND OR admin_role <> 'ADMIN' OR admin_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'trip incident review requires an active administrator'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.admin_user_id IN (reporter_user_id, reported_user_id)
    OR EXISTS (
      SELECT 1 FROM trip_participants
      WHERE trip_id = incident_trip_id AND user_id = NEW.admin_user_id
    )
  THEN
    RAISE EXCEPTION 'a trip participant or incident party cannot review this incident'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id AND command_type = 'START_REVIEW'
  ) INTO has_started;
  SELECT EXISTS (
    SELECT 1 FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id
      AND command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
  ) INTO has_terminal;
  SELECT EXISTS (
    SELECT 1 FROM trip_incident_rebuttals
    WHERE incident_id = NEW.incident_id
  ) INTO has_rebuttal;

  IF has_terminal
    OR (NEW.command_type = 'START_REVIEW' AND has_started)
    OR (NEW.command_type <> 'START_REVIEW' AND NOT has_started)
    OR (NEW.command_type = 'RESPONSIBILITY_CONFIRMED' AND NOT has_rebuttal)
  THEN
    RAISE EXCEPTION 'invalid trip incident review command transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_incident_review_commands_validate_insert
BEFORE INSERT ON trip_incident_review_commands
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_review_command();

CREATE OR REPLACE FUNCTION prevent_trip_incident_review_command_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip incident review commands are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_incident_review_commands_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_incident_review_commands
FOR EACH ROW EXECUTE FUNCTION prevent_trip_incident_review_command_mutation();
