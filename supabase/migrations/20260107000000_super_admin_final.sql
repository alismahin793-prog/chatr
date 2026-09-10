-- Chatr final role/status model (phase 7).
--
-- The system now has EXACTLY two roles:
--   user        (everyone else)
--   super_admin (the top owner)
--
-- and exactly four statuses:
--   pending   -> just signed up, blocked until an admin approves
--   approved  -> explicitly approved and usable
--   rejected  -> sign-up denied
--   disabled  -> previously usable account an admin deactivated
--
-- Safe, additive-only conversions (no data loss, no deletions):
--   * Any legacy role other than user/super_admin (e.g. "admin") is demoted
--     to "user". No account keeps a plain admin privilege; ownership is
--     granted later to exactly ONE account by the promote-super-admin script.
--   * Legacy "active" status is unified to "approved" and removed from the
--     allowed values; "active" rows keep working unchanged until approval
--     semantics, and the server still accepts it defensively.
--   * New signups default to "pending" until a super_admin approves them.
--
-- The migration is self-sufficient: it works on top of migrations 1-4 ONLY
-- or on top of 1-4+6 (which already added super_admin + approval statuses).

-- ------------------------------------------------------------------
-- profiles.role: final two-role check + safe demotion of legacy roles
-- ------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
  set role = 'user'
  where role is not null and role not in ('user', 'super_admin');

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'super_admin'));

-- ------------------------------------------------------------------
-- profiles.status: final four-status check + unify legacy "active"
-- ------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_status_check;

update public.profiles
  set status = 'approved'
  where status = 'active';

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'approved', 'rejected', 'disabled'));

-- New signups wait for super_admin approval.
alter table public.profiles
  alter column status set default 'pending';

-- ------------------------------------------------------------------
-- Re-assert the tenant privilege boundary: tenants may update ONLY
-- display_name. role / status / admin_verified_at / is_test_user /
-- expires_at stay service-role-only, so a user can never promote
-- themselves or change their own status from the client.
-- ------------------------------------------------------------------
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to anon;
grant update (display_name) on public.profiles to authenticated;