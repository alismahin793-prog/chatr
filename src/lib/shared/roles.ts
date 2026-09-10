/**
 * Chatr role literals — the ONLY roles that exist in the system.
 *
 *   user        — everyone else: must be approved before using the app
 *   super_admin — the top owner: bypasses the lifecycle gate, uses /chat and
 *                 /admin, and every admin route/mutation requires this role
 *
 * This module must stay 100% dependency-free: it is imported by both server
 * code and client components (via /server/auth/capabilities), so it can never
 * pull anything server-only (next/headers, supabase) into a client bundle.
 */
export const USER_ROLE = "user";
export const SUPER_ADMIN_ROLE = "super_admin";