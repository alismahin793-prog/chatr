-- Chatr super_admin role + registration approval (phase 6).
--
-- Security model:
--   * Adds super_admin as the top owner role. It is accepted by
--     requireAdminIdentity() and, through the permission helpers, implicitly
--     holds EVERY admin_permissions value (no rows required).
--   * Extends profiles.status with the registration-approval lifecycle:
--       pending   -> just signed up, blocked until an admin approves
--       approved  -> explicitly approved by an admin (interactive user)
--       rejected  -> sign-up was denied
--       disabled  -> previously usable account that an admin deactivated
--   * Keeps 'active' as a legacy status value: pre-existing accounts keep
--     their rows untouched and are treated exactly like 'approved' by the
--     server (no destructive data rewrite, additive migration only).
--   * New self-signups default to 'pending' until an admin approves them.
--   * All ownership semantics are enforced in server code (service role only):
--     a super_admin can never be rejected, disabled, deleted, or demoted by
--     anyone else (or accidental UI actions).

-- ------------------------------------------------------------------
-- profiles.role: accept the top owner role
-- ------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'admin', 'super_admin'));

-- ------------------------------------------------------------------
-- profiles.status: registration-approval lifecycle
-- ------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('active', 'approved', 'pending', 'rejected', 'disabled'));

-- New signups wait for admin approval; existing rows are untouched.
alter table public.profiles
  alter column status set default 'pending';

-- ------------------------------------------------------------------
-- Re-assert the tenant privilege boundary (status/role are service-role only).
-- This mirrors migration 4: tenants may update ONLY display_name, so the new
-- status values remain un-writable by anon/authenticated, exactly like
-- role / status / expires_at / is_test_user before them.
-- ------------------------------------------------------------------
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to anon;
grant update (display_name) on public.profiles to authenticated;