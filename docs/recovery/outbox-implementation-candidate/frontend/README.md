# PQR form candidate — idempotency key
Branch: `recovery/pqr-outbox-implementation-20261108`

This is a candidate copy of root `pqr.html`. It adds an `Idempotency-Key` UUID stored in sessionStorage and reused after network failures/page reloads. It is removed only after a successful radication response. It does not alter the published page.

The candidate still needs browser validation, especially behavior across tabs, private browsing, expired session storage, and attachment retries. The key is per-tab/session; a new deliberate submission after success gets a new key.
