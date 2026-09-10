-- ------------------------------------------------------------------
-- Self-Development Engine (Super Admin).
--
-- Additive-only migration. Must be applied out-of-band against the
-- linked production database with:
--   supabase db query --linked --file supabase/migrations/20260910000000_self_development.sql
-- Local schema_migrations is NOT modified (same policy as the cloud
-- development migration). There are no new functions here: RLS reuses
-- the existing public.cloud_dev_allowed() helper and the updated_at
-- trigger reuses public.cloud_set_updated_at().
--
-- Writes are service-role only. Tenants cannot insert/update/delete;
-- reads are gated by RLS to approved/active super_admin profiles.
-- Plan/review documents are stored as jsonb on the request (no
-- duplicate tables are created — the spec forbids rebuilding systems
-- that already exist).
-- ------------------------------------------------------------------

-- ------------------------------------------------------------------
-- self_development_requests: one row per development request. Status is
-- a strict lifecycle; risk can force an extra human approval; plan and
-- review are the AI-authored documents that get human approval before
-- any workspace modification or deployment.
-- ------------------------------------------------------------------
create table public.self_development_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cloud_projects (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  prompt text not null,
  status text not null default 'draft'
    check (status in (
      'draft', 'planning', 'awaiting_plan_approval', 'snapshotting',
      'workspace_preparing', 'analyzing', 'modifying', 'testing',
      'typechecking', 'linting', 'building', 'reviewing',
      'awaiting_deploy_approval', 'deploying', 'verifying', 'completed',
      'failed', 'rolled_back', 'cancelled', 'rejected'
    )),
  risk_level text not null default 'low'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  plan jsonb,
  review jsonb,
  branch text,
  snapshot_id uuid references public.cloud_snapshots (id) on delete set null,
  deployment_id uuid references public.cloud_deployments (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  plan_approved_by uuid references auth.users (id) on delete set null,
  plan_approved_at timestamptz,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index self_development_requests_status_idx
  on public.self_development_requests (status, created_at desc);
create index self_development_requests_project_idx
  on public.self_development_requests (project_id, created_at desc);

-- ------------------------------------------------------------------
-- self_development_steps: audited timeline for a request. Each phase
-- (planning, snapshot, workspace, analyze, per-validation-command,
-- repair, review, deploy, verify, rollback) is a row. Output heads are
-- the same sanitized truncation used by cloud_operations — never raw
-- logs containing secrets.
-- ------------------------------------------------------------------
create table public.self_development_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.self_development_requests (id) on delete cascade,
  stage text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'passed', 'failed', 'cancelled')),
  operation_id uuid,
  exit_code int,
  duration_ms bigint,
  output_head text not null default '',
  output_truncated boolean not null default false,
  error text,
  step_order int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index self_development_steps_request_order_idx
  on public.self_development_steps (request_id, step_order);

-- ------------------------------------------------------------------
-- self_development_changes: every structured file modification applied
-- to the isolated workspace, with before/after sha256 and a diff whose
-- secret-like content is always redacted before storage.
-- ------------------------------------------------------------------
create table public.self_development_changes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.self_development_requests (id) on delete cascade,
  file text not null,
  operation text not null
    check (operation in ('create', 'edit', 'rename', 'delete')),
  path_from text,
  path_to text,
  diff text not null default '',
  before_sha256 text,
  after_sha256 text,
  created_at timestamptz not null default now()
);

create index self_development_changes_request_idx
  on public.self_development_changes (request_id, created_at);

--                                                                  --
-- updated_at maintenance (reuses the existing helper function)
--                                                                  --
create trigger self_development_requests_set_updated_at
  before update on public.self_development_requests
  for each row execute function public.cloud_set_updated_at();

-- ------------------------------------------------------------------
-- Row level security: same posture as the cloud tables.
-- Reads only for approved/active super_admins; writes are service-role.
-- ------------------------------------------------------------------
alter table public.self_development_requests enable row level security;
alter table public.self_development_steps enable row level security;
alter table public.self_development_changes enable row level security;

create policy self_development_requests_select on public.self_development_requests
  for select using (public.cloud_dev_allowed());

create policy self_development_steps_select on public.self_development_steps
  for select using (public.cloud_dev_allowed());

create policy self_development_changes_select on public.self_development_changes
  for select using (public.cloud_dev_allowed());

revoke all on public.self_development_requests from anon;
revoke all on public.self_development_steps from anon;
revoke all on public.self_development_changes from anon;

grant select on public.self_development_requests to authenticated;
grant select on public.self_development_steps to authenticated;
grant select on public.self_development_changes to authenticated;