/*
NOFEKI PLATFORMS — SQL DESIGN DRAFT v0.1
STATUS: NOT EXECUTABLE / NOT APPROVED / DO NOT RUN
LOCATION: docs/architecture/drafts/ (intentionally outside supabase/migrations)

This is a review artifact only. It has NOT been tested against the live project.
Do not paste into Supabase SQL Editor or run through CLI.
Before any implementation:
  1. Confirm isolated database availability and cost.
  2. Reconcile every object name against live schema and migrations.
  3. Review Supabase schema exposure, grants, RLS, function ownership.
  4. Test on disposable local/isolated database with current PostgreSQL version.
  5. Obtain explicit approval.
*/

-- Proposed private namespace. Do not execute in production.
CREATE SCHEMA IF NOT EXISTS platform;

-- Identity extension. Deliberately minimal; no financial profile duplication.
CREATE TABLE platform.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name text,
  locale text NOT NULL DEFAULT 'es-CO',
  timezone text NOT NULL DEFAULT 'America/Bogota',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending_deletion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.personal_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL DEFAULT 'Personal',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'archived')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role_key text NOT NULL
    CHECK (role_key IN ('owner', 'admin', 'billing_admin', 'member')),
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  joined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE platform.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.product_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES platform.products(id) ON DELETE RESTRICT,
  key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired')),
  UNIQUE (product_id, key)
);

CREATE TABLE platform.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES platform.products(id) ON DELETE RESTRICT,
  key text NOT NULL,
  name text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('personal', 'organization', 'both')),
  is_system boolean NOT NULL DEFAULT false,
  UNIQUE (product_id, key)
);

CREATE TABLE platform.role_permissions (
  role_id uuid NOT NULL REFERENCES platform.roles(id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES platform.permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

-- A commercial license describes purchased/granted capacity, not effective access.
CREATE TABLE platform.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES platform.products(id) ON DELETE RESTRICT,
  license_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked', 'expired')),
  seat_limit integer CHECK (seat_limit IS NULL OR seat_limit >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  source_type text NOT NULL
    CHECK (source_type IN ('subscription', 'manual_grant', 'trial', 'promotion', 'free')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- v0.1 deliberately models organization assignments only.
-- Personal OPS purchases can be represented through a personal organization in v1;
-- direct user assignments require a separate reviewed extension.
CREATE TABLE platform.license_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES platform.licenses(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (license_id, organization_id)
);

-- Entitlements are effective grants. Polymorphic subject is guarded by a CHECK;
-- server-side procedures MUST verify subject existence and membership.
CREATE TABLE platform.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'organization')),
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_organization_id uuid REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES platform.products(id) ON DELETE RESTRICT,
  module_id uuid REFERENCES platform.product_modules(id) ON DELETE RESTRICT,
  capability_key text,
  source_type text NOT NULL
    CHECK (source_type IN ('free', 'license', 'subscription', 'manual_grant', 'trial', 'promotion')),
  source_reference text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(limits) = 'object'),
  granted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    (subject_type = 'user' AND subject_user_id IS NOT NULL AND subject_organization_id IS NULL)
    OR
    (subject_type = 'organization' AND subject_organization_id IS NOT NULL AND subject_user_id IS NULL)
  )
);

CREATE TABLE platform.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES platform.products(id) ON DELETE RESTRICT,
  plan_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, plan_key, version)
);

CREATE TABLE platform.plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES platform.plans(id) ON DELETE RESTRICT,
  module_id uuid REFERENCES platform.product_modules(id) ON DELETE RESTRICT,
  capability_key text,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(limits) = 'object'),
  UNIQUE NULLS NOT DISTINCT (plan_id, module_id, capability_key)
);

CREATE TABLE platform.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES platform.plans(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  customer_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_key text,
  provider_subscription_id text,
  status text NOT NULL
    CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'canceled', 'expired', 'complimentary')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(organization_id, customer_user_id) = 1),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);

CREATE TABLE platform.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  payload_digest text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_key, provider_event_id)
);

CREATE TABLE platform.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  action_key text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'changed', 'failed')),
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);



-- Product-specific role assignments. Organizational membership alone does not
-- imply a product role; the target membership must be active at authorization time.
CREATE TABLE platform.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES platform.roles(id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'organization')),
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_organization_id uuid REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    (subject_type = 'user' AND subject_user_id IS NOT NULL AND subject_organization_id IS NULL)
    OR
    (subject_type = 'organization' AND subject_organization_id IS NOT NULL AND subject_user_id IS NULL)
  )
);

CREATE INDEX platform_role_assignments_user_idx
  ON platform.role_assignments(subject_user_id, role_id, status)
  WHERE subject_type = 'user';
CREATE INDEX platform_role_assignments_org_idx
  ON platform.role_assignments(subject_organization_id, role_id, status)
  WHERE subject_type = 'organization';

-- Candidate indexes only; review query plans before adoption.
CREATE INDEX platform_memberships_user_status_idx
  ON platform.organization_memberships(user_id, status);
CREATE INDEX platform_memberships_org_status_idx
  ON platform.organization_memberships(organization_id, status);
CREATE INDEX platform_entitlements_user_lookup_idx
  ON platform.entitlements(subject_user_id, product_id, status, valid_from, valid_until)
  WHERE subject_type = 'user';
CREATE INDEX platform_entitlements_org_lookup_idx
  ON platform.entitlements(subject_organization_id, product_id, status, valid_from, valid_until)
  WHERE subject_type = 'organization';
CREATE INDEX platform_license_assignments_org_status_idx
  ON platform.license_assignments(organization_id, status);
CREATE INDEX platform_audit_events_created_idx
  ON platform.audit_events(created_at DESC);
CREATE INDEX platform_audit_events_org_created_idx
  ON platform.audit_events(organization_id, created_at DESC);

-- Intentionally absent from this draft:
-- * GRANT/REVOKE statements and RLS policies (must be designed against actual Supabase roles).
-- * SECURITY DEFINER functions, triggers, updated_at functions and API/RPC surface.
-- * Seed data and backfill of existing Gastos users.
-- * Any alteration to public tables, Auth configuration, Edge Functions or existing policies.
-- These are separate security-reviewed deliverables, not omissions to fill ad hoc.
