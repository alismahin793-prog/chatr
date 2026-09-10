-- Chatr test users (phase 3): account lifecycle + app capability permissions.
--
-- Security model:
--   * Test users are real authenticated users. Their Supabase Auth account
--     authenticates normally; their profile role stays "user" (the default).
--     is_test_user simply flags accounts that the Admin Panel manages, and
--     their application capabilities are granted in app_permissions.
--   * Admin status is NOT a capability. profiles.role remains the only source
--     of truth for admin access and only service-role code can write it.
--   * app_permissions mirrors the admin_permissions design: tenants may read
--     only their own rows; every write happens through the service role.
--   * Account status (active/disabled) and expiration are enforced by the
--     application server-side on every protected operation.

-- ------------------------------------------------------------------
-- profiles: account lifecycle fields (service-role managed)
-- ------------------------------------------------------------------
alter table public.profiles
  add column status text not null default 'active'
    check (status in ('active', 'disabled')),
  add column is_test_user boolean not null default false,
  add column expires_at timestamptz;

-- Re-assert the tenant privilege boundary for profiles: tenants may update
-- ONLY display_name. status / expires_at / is_test_user are written
-- exclusively by service-role code (which bypasses RLS and keeps the default
-- service_role table grants).
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to anon;
grant update (display_name) on public.profiles to authenticated;

-- ------------------------------------------------------------------
-- app_permissions: per-user application capabilities
-- ------------------------------------------------------------------
-- Only capabilities that map to real, enforced features of the app exist:
--   chat   -> send messages / manage conversations
--   models -> choose and use configured AI providers/models
create table public.app_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  unique (user_id, permission),
  check (permission in ('chat', 'models'))
);

create index app_permissions_user_idx
  on public.app_permissions (user_id);

alter table public.app_permissions enable row level security;

-- Tenants may read only their own capabilities (so the UI can hide features).
create policy "app_permissions_select_own"
  on public.app_permissions
  for select
  using (auth.uid() = user_id);

-- No tenant INSERT/UPDATE/DELETE policies: all capability writes flow through
-- the service role. Hard-deny tenant writes while leaving SELECT for the
-- read-own policy above.
revoke insert, update, delete on public.app_permissions from anon;
revoke insert, update, delete on public.app_permissions from authenticated;
grant select on public.app_permissions to anon;
grant select on public.app_permissions to authenticated;