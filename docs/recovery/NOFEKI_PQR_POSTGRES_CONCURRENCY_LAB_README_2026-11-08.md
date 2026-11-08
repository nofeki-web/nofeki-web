# NOFEKI PQR — PostgreSQL concurrency lab

**Purpose:** validate that a database unique constraint serializes simultaneous requests using the same idempotency key. This is a disposable test model, not production code and not a migration.

## Safety boundary

- Use a dedicated local PostgreSQL database whose name ends in `_test`, for example `nofeki_local_test`.
- Do not use the production Supabase connection string, a production branch, or a database containing real user data.
- The SQL guard rejects database names that do not end in `_test`.
- The script creates schema `pqr_idempotency_test`; it does not touch `public`, Auth, Storage, Edge Functions, or production tables.
- Do not copy this function into production as-is. It is a minimal concurrency experiment, not the final PQR workflow.

## Files

1. `pqr-postgres-concurrency-lab.sql` — creates an isolated test table/function and runs sequential baseline assertions by expected result.
2. `pqr-postgres-concurrency.pgbench.sql` — one request per pgbench client, all using the same key.
3. This guide — execution and acceptance criteria.

## 1. Run the baseline

On a local test PostgreSQL instance, connect to a database ending in `_test` and execute:

```sh
psql "$PQR_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/recovery/pqr-postgres-concurrency-lab.sql
```

The first call should return `claimed`; the second should return `already_processing`; the third, using a different fingerprint, should return `payload_mismatch`. The final inspection should show exactly one row for the fixed test key and `attempt_count = 1`.

## 2. Run a real concurrent race

The lab SQL resets the fixed key and leaves it reserved with fingerprint-A during its baseline checks. Before the race, reset only that test key and then run pgbench:

```sh
psql "$PQR_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM pqr_idempotency_test.operations WHERE idempotency_key = 'nofeki-pqr-concurrency-lab-20261108';"

pgbench "$PQR_TEST_DATABASE_URL" \
  -n -c 20 -j 4 -t 1 \
  -f docs/recovery/pqr-postgres-concurrency.pgbench.sql
```

Expected database result after the run:

```sql
SELECT count(*) AS rows_for_key,
       min(attempt_count) AS min_attempts,
       max(attempt_count) AS max_attempts
FROM pqr_idempotency_test.operations
WHERE idempotency_key = 'nofeki-pqr-concurrency-lab-20261108';
```

Acceptance criteria: exactly one row, `min_attempts = 1`, and `max_attempts = 1`. In the pgbench output, one request should claim the key; the remaining requests should see it as already processing. Depending on pgbench output settings, inspect returned rows or query the table for the authoritative invariant.

## 3. Manual two-session alternative

1. Delete the fixed key using the reset statement above.
2. In two separate psql sessions, execute the same `SELECT reserve_operation(...)` call at nearly the same time.
3. Confirm the table contains exactly one row for the key and `attempt_count = 1`.

This is the key distinction from the earlier Node in-memory replica: PostgreSQL itself, not a JavaScript mutex, arbitrates the unique-key race.

## What this test does not prove

- It does not test the actual NOFEKI Edge Functions, email provider, network retries, or Supabase Auth.
- It does not prove end-to-end exactly-once email delivery. Email providers and database commits are separate systems; production design needs an outbox/claim-and-deliver pattern and retry-safe delivery semantics.
- It does not test response-history persistence or status/event atomicity.
- It does not replace an isolated restore/backup test.
- It has not been executed in this environment: PostgreSQL, psql, and pgbench are not installed here. No result should be reported as a PostgreSQL pass until this lab is run on a real isolated PostgreSQL instance.

## Current status (2026-11-08)

**Prepared, not executed.** This package is committed for later execution when a personal/local development environment is available. No production database or Supabase project was changed.
