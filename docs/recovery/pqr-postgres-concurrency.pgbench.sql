-- Run only after pqr-postgres-concurrency-lab.sql in a dedicated *_test database.
-- All concurrent clients intentionally submit the same key and fingerprint.
SELECT *
FROM pqr_idempotency_test.reserve_operation(
  'nofeki-pqr-concurrency-lab-20261108',
  'fingerprint-concurrent-A'
);
