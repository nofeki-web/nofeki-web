-- NOFEKI PQR idempotency/concurrency lab.
-- TEST-ONLY. Never run against production or a database containing real user data.
-- Guard: database name must end in "test" (e.g. nofeki_local_test).
-- This creates only the pqr_idempotency_test schema and its isolated test table/function.

DO $guard$
BEGIN
  IF current_database() !~* '(^|_)test$' THEN
    RAISE EXCEPTION
      'SAFETY STOP: database "%" does not end in _test/test. Use a dedicated test database.',
      current_database();
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS pqr_idempotency_test;

CREATE TABLE IF NOT EXISTS pqr_idempotency_test.operations (
  idempotency_key text PRIMARY KEY,
  request_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION pqr_idempotency_test.reserve_operation(
  p_idempotency_key text,
  p_request_fingerprint text
)
RETURNS TABLE(decision text, current_state text, attempts integer)
LANGUAGE plpgsql
SET search_path = pg_catalog, pqr_idempotency_test
AS $function$
DECLARE
  inserted_key text;
  existing pqr_idempotency_test.operations%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF p_request_fingerprint IS NULL OR btrim(p_request_fingerprint) = '' THEN
    RAISE EXCEPTION 'request fingerprint is required';
  END IF;

  INSERT INTO pqr_idempotency_test.operations (
    idempotency_key, request_fingerprint
  )
  VALUES (p_idempotency_key, p_request_fingerprint)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO inserted_key;

  IF inserted_key IS NOT NULL THEN
    RETURN QUERY SELECT 'claimed'::text, 'processing'::text, 1;
    RETURN;
  END IF;

  -- A concurrent INSERT for this key is serialized by the unique constraint.
  SELECT * INTO STRICT existing
  FROM pqr_idempotency_test.operations
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF existing.request_fingerprint <> p_request_fingerprint THEN
    RETURN QUERY SELECT
      'payload_mismatch'::text, existing.state, existing.attempt_count;
  ELSIF existing.state = 'completed' THEN
    RETURN QUERY SELECT
      'duplicate_completed'::text, existing.state, existing.attempt_count;
  ELSE
    RETURN QUERY SELECT
      'already_processing'::text, existing.state, existing.attempt_count;
  END IF;
END
$function$;

-- Reset only the fixed lab key before each test run.
DELETE FROM pqr_idempotency_test.operations
WHERE idempotency_key = 'nofeki-pqr-concurrency-lab-20261108';

-- Baseline sequential checks:
SELECT * FROM pqr_idempotency_test.reserve_operation(
  'nofeki-pqr-concurrency-lab-20261108', 'fingerprint-A'
);
-- Expected: claimed | processing | 1

SELECT * FROM pqr_idempotency_test.reserve_operation(
  'nofeki-pqr-concurrency-lab-20261108', 'fingerprint-A'
);
-- Expected: already_processing | processing | 1

SELECT * FROM pqr_idempotency_test.reserve_operation(
  'nofeki-pqr-concurrency-lab-20261108', 'fingerprint-B'
);
-- Expected: payload_mismatch | processing | 1

-- Inspect exactly one row for the fixed key:
SELECT idempotency_key, request_fingerprint, state, attempt_count
FROM pqr_idempotency_test.operations
WHERE idempotency_key = 'nofeki-pqr-concurrency-lab-20261108';

-- Cleanup is intentionally manual and limited to this test key:
-- DELETE FROM pqr_idempotency_test.operations
-- WHERE idempotency_key = 'nofeki-pqr-concurrency-lab-20261108';
