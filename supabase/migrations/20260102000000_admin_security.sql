-- Chatr admin security (phase 1): server-enforced admin role, a 30-second
-- re-authentication window, and the audit-log foundation.
--
-- Security model:
--   * Every account is a plain "user" by default. Admin status must be
--     granted explicitly (via the service role).
--   * The "role" and "admin_verified_at" columns are NOT updatable by
--     tenants (anon/authenticated). Admin elevation can only be created by
--     server-side code using the service role after a successful password
--     re-verification against Supabase Auth.
--   * The audit_log table is readable/writable only via the service role.
--     No tenant policies exist; future admin reads must add their own
--     role-gated policies.

-- ------------------------------------------------------------------
-- profiles: role + re-authentication window
-- ------------------------------------------------------------------
alter table public.profiles
  add column role text not null default 'user'
    check (role in ('user', 'admin')),
  add column admin_verified_at timestamptz;

-- Tenants may update only their display_name. The role and admin_verified_at
-- columns are managed exclusively by server-side code through the service
-- role (which bypasses column grants), so tenants can never promote
-- themselves or forge an elevation timestamp. Tenant profile INSERTs are
-- also revoked: profiles are created by the owner-owned SECURITY DEFINER
-- signup trigger, not by client code.
revoke insert on public.profiles from anon;
revoke insert on public.profiles from authenticated;
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to anon;
grant update (display_name) on public.profiles to authenticated;

-- ------------------------------------------------------------------
-- audit_log: foundation for recording admin actions
-- ------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  success boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_created_idx
  on public.audit_log (actor_id, created_at desc);

create index audit_log_action_created_idx
  on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

-- No tenant policies are created on purpose: default-deny for all tenants.
-- Server-side code writes audit entries with the service role, and any future
-- admin read path must be granted explicit, role-gated access.
revoke all on public.audit_log from anon;
revoke all on public.audit_log from authenticated;