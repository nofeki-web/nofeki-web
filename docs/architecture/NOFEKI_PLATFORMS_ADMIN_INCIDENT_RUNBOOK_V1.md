# NOFEKI Platforms — Administrative Incident Runbook v1

**Status:** Proposed operating procedure; not active.  
**Purpose:** Contain and investigate suspected misuse or compromise of the internal Admin Console.

## 1. Trigger conditions

Use this runbook for suspected compromised operator accounts, unexpected role changes, unauthorized license or entitlement changes, cross-tenant data exposure, suspicious bulk actions, or audit gaps.

## 2. Immediate response

1. Open an incident record with UTC start time, reporter, affected systems, and known symptoms.
2. Preserve relevant audit events, request IDs, deployment references, and timestamps.
3. Identify the affected operator, role, target resources, and scope. Do not delete evidence.
4. If an active threat is confirmed, an authorized platform owner/security lead may suspend the affected operator's admin access using an approved, tested procedure.
5. Revoke compromised sessions/credentials only through supported identity-provider procedures after impact assessment.
6. Pause the affected administrative workflow or feature flag if a safe, reversible control exists. Do not make unreviewed database edits.

## 3. Containment boundaries

- Do not disable all customer authentication as a first response.
- Do not modify production RLS, database schema, Edge Functions, secrets, or Vercel settings ad hoc.
- Do not inspect customer financial content unless separately authorized and strictly necessary.
- Do not use impersonation or shared operator credentials.
- Keep NOFEKI Gastos direct access available where safe.

## 4. Recovery and review

1. Confirm the attack path and affected records.
2. Restore known-good configuration through reviewed, versioned changes.
3. Verify role assignments, memberships, licenses, and entitlement state.
4. Run tenant-isolation and authorization regression tests.
5. Notify affected parties according to the approved legal/privacy incident process.
6. Record root cause, timeline, scope, remediation, and follow-up owners.
7. Review all privileged access and close temporary elevation.

## 5. Future break-glass requirements

Break-glass is not enabled by this document. Any future implementation requires time-limited elevation, strongest available authentication, explicit incident ID and reason, narrow scope, real-time alerting, immutable audit events, automatic expiry, and independent post-incident review. No standing emergency superuser account.
