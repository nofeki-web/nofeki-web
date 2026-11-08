# NOFEKI Auth and Storage configuration capture — follow-up
Date: 2026-11-08
Project: bxjgodhqseoxrnshqtfr

## Status
The connected Supabase tool catalog does not expose a read action for project Auth or Storage service configuration. The official Supabase Management API documents these read-only endpoints:

- Auth: GET /v1/projects/{ref}/config/auth
- Storage: GET /v1/projects/{ref}/config/storage
- Combined effective configuration (Alpha): GET /v2/projects/{ref}/config

Documentation references:
- https://supabase.com/docs/reference/api/v1-get-auth-service-config
- https://supabase.com/docs/reference/api/v1-get-storage-config
- https://supabase.com/docs/reference/api/v2-get-project-config

No Management API token, secret, password, SMTP credential, JWT secret, or HMAC value is requested or recorded here. If an authorized operator performs the capture, retain only non-secret effective settings needed for recovery. Redact secret values and any HMAC representations; never commit raw API responses.

## Capture checklist — Auth
Record (without secrets): site URL; enabled signup modes; email/phone confirmation requirements; secure password change setting; minimum password length and complexity; session timeouts; refresh-token rotation/reuse settings; rate limits; CAPTCHA enablement/provider (not secret keys); email templates' configuration shape; redirect allow-list domains; enabled OAuth providers (names and non-secret status only); MFA factor policy; anonymous sign-in status; hook configuration names/status (not credentials).

Verify actual login, signup, confirmation, password recovery, refresh, logout, and redirect behavior in an isolated environment before considering any production change.

## Capture checklist — Storage
Record bucket names, public/private status, file-size limits, allowed MIME types, and any non-secret policy/config metadata. For NOFEKI the known bucket snapshot is pqr-attachments: private, 5 MiB maximum, PDF/JPEG/PNG. Reconfirm through the read-only endpoint before restoration. Do not copy object contents or user PII into this inventory.

## Current known bucket evidence
The existing recovery snapshot recorded pqr-attachments as private, 5 MiB, PDF/JPEG/PNG. This is a previously captured database/storage metadata observation, not a fresh Management API verification on this date.

## Compatibility check — upcoming platform change
Supabase's changelog lists removal of a subset of TLS 1.2 cipher suites from project HTTP APIs beginning 2026-11-10. Add a client compatibility check for the NOFEKI web app, iOS Shortcuts and any integrations that call Auth, Storage, Data API, Realtime, or Edge Functions. This is a compatibility verification item, not evidence that current clients are affected.

## Safe next action
An authorized operator with Management API access can run the two GET requests above, redact secrets locally, and add only the sanitized settings to the recovery inventory. No production settings should be changed as part of this capture.
