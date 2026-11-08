# NOFEKI PQR — Outbox fault model test report (2026-11-08)

## Executed check

A Node.js in-memory state-machine model was replayed locally against nine cases matching the committed test file `supabase/functions/tests/pqr-outbox-fault-model.node.test.mjs`.

Result: **9 passed, 0 failed**.

Cases:
1. Duplicate event key suppression.
2. Competing workers cannot claim an unexpired lease.
3. Expired lease can be reclaimed.
4. Stale worker cannot finalize after a new lease is issued.
5. Transient provider failure schedules a retry.
6. Permanent provider failure moves event to dead letter.
7. Delivered event is not claimable again.
8. Provider-accepted / worker-crash ambiguity is represented explicitly.
9. Invalid lock token cannot mutate the row.

## Important limitation

The local replay was an equivalent manually reconstructed Node.js test script, not an execution of the committed file itself. The model is in-memory and single-process; it does not prove PostgreSQL row-locking, `SKIP LOCKED`, transaction rollback, actual multi-process worker races, Supabase RLS, or email-provider behavior.

No PostgreSQL, psql, pgbench, Edge Function, email provider, or production project was exercised or modified.

## Next verification gate

Run the committed test file directly with Node, then run the PostgreSQL concurrency lab using two or more real database sessions and perform provider failure injection in an isolated test environment. Only those tests can establish database-level concurrency behavior.
