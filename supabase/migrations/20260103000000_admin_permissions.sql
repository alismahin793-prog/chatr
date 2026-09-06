-- Chatr admin permissions (phase 2): granular permission system for the
-- Admin Panel. Each admin must be explicitly granted specific permissions
-- to access particular functionality groups.
--
-- Security model:
--   * Permissions are assigned per-user via the admin_permissions table.
--   * Only service-role code can write to admin_permissions (no tenant RLS).
--   * Tenants can read their own permissions (to render the sidebar).
--   * Each permission is validated against a CHECK constraint of known values.
--   * Sensitive permissions require a 30-second re-authentication window.

-- ------------------------------------------------------------------
-- Valid permission values
-- ------------------------------------------------------------------
-- USER_MANAGEMENT
--   view_users, disable_users, manage_user_roles, view_user_activity
-- AI_PROVIDERS
--   view_providers, view_model_config, manage_provider_availability, manage_usage_limits
-- SYSTEM
--   view_system_health, view_system_errors, view_usage_stats, manage_app_settings
-- SECURITY
--   view_audit_logs, view_active_sessions, revoke_user_sessions, view_failed_auth
-- SELF_DEVELOPMENT
--   create_dev_requests, approve_dev_plans, approve_deployments

-- ------------------------------------------------------------------
-- admin_permissions: granular per-user permission grants
-- ------------------------------------------------------------------
create table public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  unique (user_id, permission),
  check (permission in (
    -- USER_MANAGEMENT
    'view_users',
    'disable_users',
    'manage_user_roles',
    'view_user_activity',
    -- AI_PROVIDERS
    'view_providers',
    'view_model_config',
    'manage_provider_availability',
    'manage_usage_limits',
    -- SYSTEM
    'view_system_health',
    'view_system_errors',
    'view_usage_stats',
    'manage_app_settings',
    -- SECURITY
    'view_audit_logs',
    'view_active_sessions',
    'revoke_user_sessions',
    'view_failed_auth',
    -- SELF_DEVELOPMENT
    'create_dev_requests',
    'approve_dev_plans',
    'approve_deployments'
  ))
);

create index admin_permissions_user_idx
  on public.admin_permissions (user_id);

alter table public.admin_permissions enable row level security;

-- Tenants may read only their own permissions (for sidebar rendering).
create policy "Admin permissions: users can read own"
  on public.admin_permissions
  for select
  using (auth.uid() = user_id);

-- No tenant INSERT/UPDATE/DELETE policies: all writes go through the service
-- role which bypasses RLS. At the privilege level we hard-deny tenant writes
-- (they would otherwise be caught by Supabase's default ALL grants) while
-- leaving SELECT available for the read-own policy above.
revoke insert, update, delete on public.admin_permissions from anon;
revoke insert, update, delete on public.admin_permissions from authenticated;
grant select on public.admin_permissions to anon;
grant select on public.admin_permissions to authenticated;
