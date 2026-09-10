#!/usr/bin/env node
// One-off super_admin promotion for the primary Chatr account.
//
// Security rules:
//   * Runs with the SERVICE ROLE ONLY (never a tenant client).
//   * The target account is matched by email against Supabase Auth and must
//     be UNIQUE — no guesswork, no overwriting another account.
//   * Sets profiles.role = 'super_admin' and profiles.status = 'approved'.
//     It never touches passwords, sessions, or the /api/* routes.
//   * Prints nothing sensitive: no API keys, no tokens, no passwords.
//
// Usage (from the repo root, with the service key available in the shell):
//   set "NEXT_PUBLIC_SUPABASE_URL=https://qkvgwojfvpztjjniyrsf.supabase.co"
//   set "SUPABASE_SERVICE_ROLE_KEY=your_service_key"
//   node scripts/promote-super-admin.mjs you@example.com
//
// Add --dry-run to only resolve + report the account without writing anything.

import { createClient } from "@supabase/supabase-js";

async function main() {
  const emailArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const isDryRun = process.argv.includes("--dry-run");
  if (!emailArg) {
    console.error("Usage: node scripts/promote-super-admin.mjs [--dry-run] <email>");
    process.exit(2);
  }
  const email = emailArg.trim().toLowerCase();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing environment. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(2);
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the exact account by email (unique match required).
  let match = null;
  let page = 0;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if ((u.email ?? "").trim().toLowerCase() === email) {
        if (match) throw new Error(`Multiple accounts match ${email}; aborting.`);
        match = u;
      }
    }
    if (users.length < 1000 || page > 50) break;
    page += 1;
  }

  if (!match) {
    console.error(`No account found for "${email}". Nothing changed.`);
    process.exit(1);
  }

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, role, status")
    .eq("id", match.id)
    .maybeSingle();
  if (profileError) throw new Error(`profile read failed: ${profileError.message}`);

  console.log(`Target: ${email}`);
  console.log(`  user id : ${match.id}`);
  console.log(`  current : role=${profile?.role ?? "(no profile)"} status=${profile?.status ?? "(none)"}`);

  if (!profile) {
    console.error("The account has no profile row; nothing changed.");
    process.exit(1);
  }
  if (profile.role === "super_admin") {
    console.log("This account is already super_admin. Nothing to do.");
    return;
  }

  if (isDryRun) {
    console.log("Dry run: no write was performed.");
    return;
  }

  const { error: updateError } = await service
    .from("profiles")
    .update({ role: "super_admin", status: "approved" })
    .eq("id", match.id);
  if (updateError) {
    console.error(
      `Promotion failed: ${updateError.message}` +
        (String(updateError.message).toLowerCase().includes("check constraint")
          ? " (confirm the super_admin migration was applied to this project first)"
          : "")
    );
    process.exit(1);
  }

  const { data: after } = await service
    .from("profiles")
    .select("role, status")
    .eq("id", match.id)
    .maybeSingle();
  console.log(`Promoted: role=${after?.role} status=${after?.status}.`);
  console.log(
    "Verify in the app: open /admin (should work), sign out and sign back in to confirm."
  );
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});