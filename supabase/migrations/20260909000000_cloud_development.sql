-- ------------------------------------------------------------------
-- Cloud Development (Super Admin) — additive-only migration.
--
-- NOTE: This migration is additive and safe. It must be applied
-- out-of-band against the linked production database with:
--   supabase db query --linked --file supabase/migrations/20260909000000_cloud_development.sql
-- The local schema_migrations table is NOT modified (migrations 4 & 7
-- were applied via the same out-of-band path; `db push` would replay
-- 5/6 and is forbidden).
--
-- All five tables are service-role only for writes. Tenants cannot
-- insert/update/delete, and reads are gated by RLS to super_admin
-- profiles (see cloud_dev_allowed() policy helper). Hard-deny anon.
-- ------------------------------------------------------------------

-- ------------------------------------------------------------------
-- Helper: is the authenticated user allowed to read cloud data?
-- Only an approved/active super_admin. SECURITY DEFINER so the check
-- is not blocked by RLS recursion on profiles.
-- ------------------------------------------------------------------
create or replace function public.cloud_dev_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
      and p.status in ('approved', 'active')
  );
$$;

-- ------------------------------------------------------------------
-- cloud_projects: a workspace + repo a super_admin is developing.
-- ------------------------------------------------------------------
create table public.cloud_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  description text not null default '',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  repo_url text,
  default_branch text not null default 'main',
  base_env text not null default 'development',
  last_build_status text not null default 'never'
    check (last_build_status in ('passed', 'failed', 'never')),
  last_deployment_status text not null default 'never'
    check (last_deployment_status in ('queued', 'building', 'ready', 'failed', 'cancelled', 'rolled_back', 'never')),
  -- Non-secret metadata only: [{ name, configured, updatedAt }]. Actual
  -- secret values are pushed to the deployment/secrets provider and are
  -- never persisted here.
  env_vars jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index cloud_projects_status_idx on public.cloud_projects (status, updated_at desc);

-- ------------------------------------------------------------------
-- cloud_operations: audited record of every command/process/build and
-- high-level cloud action. Live output lives in the execution provider;
-- only a truncated head is stored.
-- ------------------------------------------------------------------
create table public.cloud_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cloud_projects (id) on delete cascade,
  kind text not null
    check (kind in ('command', 'install', 'lint', 'typecheck', 'test', 'build', 'git', 'snapshot', 'deployment', 'rollback', 'environment', 'file', 'process')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out')),
  program text not null,
  args jsonb not null default '[]',
  working_dir text,
  exit_code int,
  duration_ms bigint,
  output_head text not null default '',
  output_truncated boolean not null default false,
  admin_id uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index cloud_operations_project_created_idx
  on public.cloud_operations (project_id, created_at desc);
create index cloud_operations_status_idx on public.cloud_operations (status);

-- ------------------------------------------------------------------
-- cloud_snapshots: a git point-in-time snapshot, restorable after
-- confirmation. High-risk changes begin from a snapshot.
-- ------------------------------------------------------------------
create table public.cloud_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cloud_projects (id) on delete cascade,
  reason text not null,
  ref text not null,
  status text not null default 'created'
    check (status in ('created', 'restoring', 'restored', 'failed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

create index cloud_snapshots_project_created_idx
  on public.cloud_snapshots (project_id, created_at desc);

-- ------------------------------------------------------------------
-- cloud_deployments: only created from a real provider confirmation.
-- ------------------------------------------------------------------
create table public.cloud_deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cloud_projects (id) on delete cascade,
  kind text not null check (kind in ('preview', 'production')),
  ref text not null,
  branch text,
  status text not null default 'queued'
    check (status in ('queued', 'building', 'ready', 'failed', 'cancelled', 'rolled_back')),
  url text,
  request_id text,
  build_logs_head text not null default '',
  initiated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz
);

create index cloud_deployments_project_created_idx
  on public.cloud_deployments (project_id, created_at desc);
create index cloud_deployments_status_idx on public.cloud_deployments (status);

-- ------------------------------------------------------------------
-- cloud_previews: ephemeral PR-style preview deployments.
-- ------------------------------------------------------------------
create table public.cloud_previews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cloud_projects (id) on delete cascade,
  deployment_id uuid references public.cloud_deployments (id) on delete cascade,
  commit text,
  status text not null default 'building'
    check (status in ('building', 'ready', 'expired', 'failed')),
  url text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index cloud_previews_project_created_idx
  on public.cloud_previews (project_id, created_at desc);

-- ------------------------------------------------------------------
-- updated_at maintenance
-- ------------------------------------------------------------------
create or replace function public.cloud_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger cloud_projects_set_updated_at
  before update on public.cloud_projects
  for each row execute function public.cloud_set_updated_at();

-- ------------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------------
alter table public.cloud_projects enable row level security;
alter table public.cloud_operations enable row level security;
alter table public.cloud_snapshots enable row level security;
alter table public.cloud_deployments enable row level security;
alter table public.cloud_previews enable row level security;

-- Reads are restricted to approved/active super_admins via the policy
-- helper. There are deliberately NO tenant insert/update/delete
-- policies: all writes come from the server service role.
-- ------------------------------------------------------------------
create policy cloud_projects_select on public.cloud_projects
  for select using (public.cloud_dev_allowed());

create policy cloud_operations_select on public.cloud_operations
  for select using (public.cloud_dev_allowed());

create policy cloud_snapshots_select on public.cloud_snapshots
  for select using (public.cloud_dev_allowed());

create policy cloud_deployments_select on public.cloud_deployments
  for select using (public.cloud_dev_allowed());

create policy cloud_previews_select on public.cloud_previews
  for select using (public.cloud_dev_allowed());

-- ------------------------------------------------------------------
-- Hard-deny anon; the only tenant role that can read anything is
-- authenticated (and only rows the policies above allow). The helper
-- is a function, so its privileges are EXECUTE, not SELECT.
-- ------------------------------------------------------------------
revoke all on function public.cloud_dev_allowed() from anon, authenticated, public;

revoke all on public.cloud_projects from anon;
revoke all on public.cloud_operations from anon;
revoke all on public.cloud_snapshots from anon;
revoke all on public.cloud_deployments from anon;
revoke all on public.cloud_previews from anon;

-- Authenticated may select cloud tables (row-gated above) and run the
-- RLS helper. Writes stay service-role only: no insert/update/delete
-- granted to any tenant.
-- ------------------------------------------------------------------
grant execute on function public.cloud_dev_allowed() to authenticated;
grant select on public.cloud_projects to authenticated;
grant select on public.cloud_operations to authenticated;
grant select on public.cloud_snapshots to authenticated;
grant select on public.cloud_deployments to authenticated;
grant select on public.cloud_previews to authenticated;