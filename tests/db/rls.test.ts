import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Runs the real Supabase migration against PGlite (PostgreSQL compiled to
 * WASM) and verifies that the schema is created and that Row Level Security
 * actually isolates one user's data from another.
 *
 * Supabase's `auth.uid()` is backed by PostgREST request JWT claims. We
 * install an equivalent `auth` schema shim so the policies are exercised
 * exactly as they would be on a cloud project.
 */

const INIT_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260101000000_init.sql"
);

const ADMIN_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260102000000_admin_security.sql"
);

const PERMISSIONS_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260103000000_admin_permissions.sql"
);

const TEST_USERS_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260104000000_test_users.sql"
);

const PLATFORM_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260105000000_admin_platform.sql"
);

const SUPER_ADMIN_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260106000000_super_admin_approval.sql"
);

const FINAL_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260107000000_super_admin_final.sql"
);

/** Reads a migration and neutralizes the pgcrypto prelude for PGlite. */
function readMigration(path: string) {
  return readFileSync(path, "utf8").replace(
    // Supabase's managed Postgres ships pgcrypto; PGlite does not, but it
    // runs PostgreSQL 17 where gen_random_uuid() lives in core anyway.
    "create extension if not exists pgcrypto;",
    "-- pgcrypto: preinstalled on Supabase; gen_random_uuid() is core on PG13+"
  );
}

async function rowCount(db: PGlite, sql: string, params: unknown[]) {
  const result = await db.query<{ count: string }>(sql, params);
  return Number(result.rows[0].count);
}

async function expectPolicyViolation(promise: Promise<unknown>) {
  let threw = false;
  try {
    await promise;
  } catch (err) {
    threw = true;
    expect(String(err)).toMatch(/row-level security policy|violates row-level/i);
  }
  expect(threw).toBe(true);
}

async function expectPermissionDenied(promise: Promise<unknown>) {
  let threw = false;
  try {
    await promise;
  } catch (err) {
    threw = true;
    expect(String(err)).toMatch(/permission denied/i);
  }
  expect(threw).toBe(true);
}

describe("supabase migration + RLS data isolation", () => {
  let db: PGlite;
  let userIdA: string;
  let userIdB: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create schema auth;");

    // Roles must exist before the admin migration runs: it revokes column-level
    // privileges from 'anon' and 'authenticated'.
    await db.exec("create role anon;");
    await db.exec("create role authenticated;");

    // --- auth schema shim (mirrors Supabase GoTrue layout) -------------
    await db.exec(`
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create or replace function auth.uid()
      returns uuid
      language sql stable
      as $$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $$;
    `);

    // --- apply the real migrations (init + admin security + permissions + test users + platform + super_admin) --
    const migrationSql = [
      readMigration(INIT_MIGRATION),
      readMigration(ADMIN_MIGRATION),
      readMigration(PERMISSIONS_MIGRATION),
      readMigration(TEST_USERS_MIGRATION),
      readMigration(PLATFORM_MIGRATION),
      readMigration(SUPER_ADMIN_MIGRATION),
      readMigration(FINAL_MIGRATION),
    ].join("\n\n-- ===== subsequent migration =====\n\n");
    await db.exec(migrationSql);

    // --- roles & privileges matching a Supabase project -----------------.
    // Supabase's default grants are installed after our migration's revokes,
    // so re-apply the revokes to land in the same post-migration state as a
    // real cloud project (where the migration runs after the defaults).
    try {
      await db.exec("grant usage on schema public to authenticated;");
    } catch {
      /* already granted */
    }
    await db.exec(`
      grant all on all tables in schema public to authenticated;
      grant usage on schema auth to authenticated;
      grant execute on all functions in schema auth to authenticated;
    `);
    await db.exec(`
      revoke insert on public.profiles from anon;
      revoke insert on public.profiles from authenticated;
      revoke update on public.profiles from anon;
      revoke update on public.profiles from authenticated;
      grant update (display_name) on public.profiles to anon;
      grant update (display_name) on public.profiles to authenticated;
      revoke all on public.audit_log from anon;
      revoke all on public.audit_log from authenticated;
      revoke all on public.admin_permissions from anon;
      revoke all on public.admin_permissions from authenticated;
      grant select on public.admin_permissions to authenticated;
      grant select on public.admin_permissions to anon;
      revoke all on public.app_permissions from anon;
      revoke all on public.app_permissions from authenticated;
      grant select on public.app_permissions to authenticated;
      grant select on public.app_permissions to anon;
      revoke all on public.features from anon;
      revoke all on public.features from authenticated;
      revoke all on public.improvement_proposals from anon;
      revoke all on public.improvement_proposals from authenticated;
      revoke all on public.ai_request_log from anon;
      revoke all on public.ai_request_log from authenticated;
    `);

    // Emulate GoTrue creating two users (profile rows are auto-created).
    const [a] = (
      await db.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), 'alice@example.com', '{"display_name":"Alice"}')
         returning id`,
        []
      )
    ).rows;
    const [b] = (
      await db.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), 'bob@example.com', '{"display_name":"Bob"}')
         returning id`,
        []
      )
    ).rows;
    userIdA = a.id;
    userIdB = b.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("schema migration created all tables and indexes", async () => {
    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
      []
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual([
      "admin_permissions",
      "ai_request_log",
      "app_permissions",
      "audit_log",
      "conversations",
      "features",
      "improvement_proposals",
      "messages",
      "profiles",
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' order by indexname`,
      []
    );
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "conversations_user_updated_idx",
        "messages_conversation_created_idx",
        "features_key_idx",
        "improvement_proposals_status_idx",
        "ai_request_log_created_idx",
        "app_permissions_user_idx",
      ])
    );

    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname in ('profiles','conversations','messages','audit_log','admin_permissions','app_permissions','features','improvement_proposals','ai_request_log')`,
      []
    );
    expect(rls.rows.map((r) => r.relrowsecurity).every((v) => v === true)).toBe(true);
  });

  it("signup trigger auto-creates a profile", async () => {
    const profiles = await db.query<{ id: string; display_name: string }>(
      "select id, display_name from profiles order by created_at",
      []
    );
    expect(profiles.rows).toHaveLength(2);
    const alice = profiles.rows.find((r) => r.id === userIdA);
    expect(alice?.display_name).toBe("Alice");
  });

  it("user A can create and read their own conversation and messages", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    const [conv] = (
      await db.query<{ id: string }>(
        `insert into conversations (user_id, title, provider, model)
         values ($1, 'My first chat', 'mock', 'mock-1') returning id`,
        [userIdA]
      )
    ).rows;
    await db.query(
      `insert into messages (conversation_id, role, content) values ($1, 'user', 'hello')`,
      [conv.id]
    );
    await db.query(
      `insert into messages (conversation_id, role, content) values ($1, 'assistant', 'hi there')`,
      [conv.id]
    );

    const count = await rowCount(db, "select count(*) from conversations where id = $1", [conv.id]);
    expect(count).toBe(1);

    const msgs = await db.query(
      "select role, content from messages where conversation_id = $1 order by created_at",
      [conv.id]
    );
    expect(msgs.rows).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);

    // updated_at trigger bumps on title change
    await db.query("update conversations set title = 'Renamed' where id = $1", [conv.id]);
    const updated = await db.query<{ title: string; updated_at: string }>(
      "select title, updated_at from conversations where id = $1",
      [conv.id]
    );
    expect(updated.rows[0].title).toBe("Renamed");
    await db.exec("commit;");
  });

  it("user B cannot see, modify, or write into user A's data", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdB, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    // Read: A's rows are hidden entirely. B can only ever see their own data.
    const convCount = await rowCount(db, "select count(*) from conversations", []);
    expect(convCount).toBe(0);
    const msgCount = await rowCount(db, "select count(*) from messages", []);
    expect(msgCount).toBe(0);

    // B can see their own profile but never Alice's.
    const ownProf = await rowCount(db, "select count(*) from profiles where id = $1", [userIdB]);
    expect(ownProf).toBe(1);
    const aliceProf = await rowCount(db, "select count(*) from profiles where id = $1", [userIdA]);
    expect(aliceProf).toBe(0);

    // Update: matches zero rows, returns nothing
    const [r] = (
      await db.query<{ id: string }>(
        `with updated as (
           update conversations set title = 'hijacked'
           where user_id = $1 returning id
         ) select id from updated`,
        [userIdA]
      )
    ).rows;
    expect(r).toBeUndefined();

    // Delete: matches zero rows
    const delCount = await rowCount(
      db,
      `with deleted as (
         delete from conversations where user_id = $1 returning id
       ) select count(*) from deleted`,
      [userIdA]
    );
    expect(delCount).toBe(0);

    // Insert into A's conversation: rejected by the WITH CHECK policy
    const aConv = (
      await db.query<{ id: string }>(
        "select id from conversations where user_id = $1",
        [userIdA]
      )
    ).rows;
    expect(aConv.length).toBe(0); // hidden, so we reference A directly:
    await expectPolicyViolation(
      db.query(
        `insert into messages (conversation_id, role, content)
         values (
           (select id from conversations where user_id = $1),
           'user', 'injected'
         )`,
        [userIdA]
      )
    );
    await db.exec("rollback;");
  });

  it("users can delete their own conversations (cascade removes messages)", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    const [conv] = (
      await db.query<{ id: string }>(
        `insert into conversations (user_id) values ($1) returning id`,
        [userIdA]
      )
    ).rows;
    await db.query(
      "insert into messages (conversation_id, role, content) values ($1, 'user', 'bonk')",
      [conv.id]
    );
    await db.query("delete from conversations where id = $1", [conv.id]);

    // Conversation is gone and cascade cleaned up its messages.
    const orphans = await rowCount(
      db,
      "select count(*) from messages where conversation_id = $1",
      [conv.id]
    );
    expect(orphans).toBe(0);
    const missing = await rowCount(db, "select count(*) from conversations where id = $1", [conv.id]);
    expect(missing).toBe(0);
    await db.exec("commit;");
  });

  it("every account gets the plain 'user' role by default", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    const [row] = (
      await db.query<{ role: string; admin_verified_at: unknown }>(
        "select role, admin_verified_at from profiles where id = $1",
        [userIdA]
      )
    ).rows;
    expect(row.role).toBe("user");
    expect(row.admin_verified_at).toBeNull();
    await db.exec("commit;");
  });

  it("tenants cannot promote themselves to admin", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query("update profiles set role = 'admin' where id = $1", [userIdA])
    );
    await db.exec("rollback;");
  });

  it("tenants cannot promote themselves to super_admin and cannot forge status", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query("update profiles set role = 'super_admin' where id = $1", [userIdA])
    );
    await db.exec("rollback;");

    // status is service-role only too — a tenant cannot self-approve.
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query("update profiles set status = 'approved' where id = $1", [userIdA])
    );
    await db.exec("rollback;");
  });

  it("new signups are pending until an admin approves them (migration 6 default)", async () => {
    const [newUser] = (
      await db.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), 'carol@example.com', '{"display_name":"Carol"}')
         returning id`,
        []
      )
    ).rows;
    const [row] = (
      await db.query<{ role: string; status: string }>(
        "select role, status from profiles where id = $1",
        [newUser.id]
      )
    ).rows;
    expect(row.role).toBe("user");
    expect(row.status).toBe("pending");
  });

  it("the super_admin role and approval statuses are legal values (service role)", async () => {
    // Table owner (service-role equivalent) can grant the top role and move
    // the account through the approval lifecycle.
    await db.query(
      "update profiles set role = 'super_admin', status = 'approved' where id = $1",
      [userIdA]
    );
    const [row] = (
      await db.query<{ role: string; status: string }>(
        "select role, status from profiles where id = $1",
        [userIdA]
      )
    ).rows;
    expect(row.role).toBe("super_admin");
    expect(row.status).toBe("approved");

    await db.query("update profiles set status = 'rejected' where id = $1", [userIdA]);
    const [rejected] = (
      await db.query<{ status: string }>(
        "select status from profiles where id = $1",
        [userIdA]
      )
    ).rows;
    expect(rejected.status).toBe("rejected");
  });

  it("tenants cannot forge an admin re-authentication timestamp", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query("update profiles set admin_verified_at = now() where id = $1", [userIdA])
    );
    await db.exec("rollback;");
  });

  it("tenants can still update their own display_name", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await db.query("update profiles set display_name = 'Alice Renamed' where id = $1", [
      userIdA,
    ]);
    const [row] = (
      await db.query<{ display_name: string }>(
        "select display_name from profiles where id = $1",
        [userIdA]
      )
    ).rows;
    expect(row.display_name).toBe("Alice Renamed");
    await db.exec("commit;");
  });

  it("audit_log is unreadable and unwritable by tenants", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(db.query("select count(*) from audit_log", []));
    await db.exec("rollback;");

    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query("insert into audit_log (actor_id, action) values ($1, 'admin.status')", [userIdA])
    );
    await db.exec("rollback;");
  });

  it("the service role (privileged path) can write audit entries", async () => {
    // Runs as the table owner (superuser in PGlite), mirroring service-role
    // writes which bypass RLS and column grants.
    const [row] = (
      await db.query<{ id: string }>(
        `insert into audit_log (actor_id, action, success, metadata)
         values ($1, 'admin.reauth', true, '{}'::jsonb) returning id`,
        [userIdA]
      )
    ).rows;
    expect(row.id).toBeTruthy();
    expect(await rowCount(db, "select count(*) from audit_log", [])).toBe(1);
  });

  it("platform tables are unreadable and unwritable by tenants", async () => {
    // features / improvement_proposals / ai_request_log are service-role only.
    // Each denial runs in its own transaction: once a statement fails, the
    // current transaction is aborted, so reusing it would mask later denials.
    const denials = [
      "select count(*) from features",
      "select count(*) from improvement_proposals",
      "select count(*) from ai_request_log",
      "insert into features (key, name) values ('x', 'X')",
      "update features set enabled = true",
    ];
    for (const sql of denials) {
      await db.exec("begin;");
      await db.query(
        "select set_config('request.jwt.claims', $1, true)",
        [JSON.stringify({ sub: userIdA, role: "authenticated" })]
      );
      await db.exec("set local role authenticated;");
      await expectPermissionDenied(db.query(sql, []));
      await db.exec("rollback;");
    }
  });

  it("the service role can seed and toggle features", async () => {
    // Mirrors the service role: table owner can insert and update.
    // 'internal_test_feature' is not part of the migration's seed registry.
    const [row] = (
      await db.query<{ key: string; enabled: boolean }>(
        `insert into features (key, name, enabled, available_to_users)
         values ('internal_test_feature', 'Internal Test', true, false)
         returning key, enabled`,
        []
      )
    ).rows;
    expect(row.enabled).toBe(true);

    await db.query(
      "update features set enabled = false where key = 'internal_test_feature'",
      []
    );
    const [after] = (
      await db.query<{ enabled: boolean }>(
        "select enabled from features where key = 'internal_test_feature'",
        []
      )
    ).rows;
    expect(after.enabled).toBe(false);
  });

  it("no user has any admin permission by default", async () => {
    const count = await rowCount(db, "select count(*) from admin_permissions", []);
    expect(count).toBe(0);
  });

  it("the CHECK constraint accepts manage_features after migration 5", async () => {
    const ok = await db.query<{ permission: string }>(
      `insert into admin_permissions (user_id, permission)
       values ($1, 'manage_features') on conflict do nothing returning permission`,
      [userIdA]
    );
    expect(ok.rows).toHaveLength(1);
    expect(ok.rows[0].permission).toBe("manage_features");
  });

  it("service role can grant and revoke admin permissions", async () => {
    const [row] = (
      await db.query<{ id: string }>(
        `insert into admin_permissions (user_id, permission, granted_by)
         values ($1, 'view_users', $2) returning id`,
        [userIdA, userIdB]
      )
    ).rows;
    expect(row.id).toBeTruthy();
    expect(
      await rowCount(
        db,
        "select count(*) from admin_permissions where user_id = $1 and permission = 'view_users'",
        [userIdA]
      )
    ).toBe(1);
  });

  it("the CHECK constraint rejects unknown permission values", async () => {
    let threw = false;
    try {
      await db.query(
        `insert into admin_permissions (user_id, permission) values ($1, 'view_everything')`,
        [userIdA]
      );
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/check constraint/i);
    }
    expect(threw).toBe(true);
  });

  it("tenants can read only their own admin permissions", async () => {
    await db.query(
      `insert into admin_permissions (user_id, permission, granted_by)
       values ($1, 'view_audit_logs', $1) on conflict do nothing`,
      [userIdA]
    );

    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    const own = await rowCount(
      db,
      "select count(*) from admin_permissions where user_id = $1",
      [userIdA]
    );
    expect(own).toBeGreaterThan(0);

    const other = await rowCount(
      db,
      "select count(*) from admin_permissions where user_id = $1",
      [userIdB]
    );
    expect(other).toBe(0);
    await db.exec("commit;");
  });

  it("tenants cannot grant or revoke permissions (even their own)", async () => {
    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query(
        `insert into admin_permissions (user_id, permission)
         values ($1, 'view_users')`,
        [userIdA]
      )
    );
    await db.exec("rollback;");

    await db.exec("begin;");
    await db.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userIdA, role: "authenticated" })]
    );
    await db.exec("set local role authenticated;");

    await expectPermissionDenied(
      db.query("delete from admin_permissions where user_id = $1", [userIdA])
    );
    await db.exec("rollback;");
  });

  it("migration 7: only 'user' and 'super_admin' roles exist after demotion", async () => {
    const legacy = await rowCount(
      db,
      "select count(*) from profiles where role not in ('user', 'super_admin')",
      []
    );
    expect(legacy).toBe(0);
  });

  it("migration 7: the role CHECK rejects a legacy 'admin' value", async () => {
    let threw = false;
    try {
      await db.query(
        "update profiles set role = 'admin' where id = $1",
        [userIdB]
      );
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/check constraint/i);
    }
    expect(threw).toBe(true);
  });

  it("migration 7: the role CHECK rejects arbitrary invented roles", async () => {
    let threw = false;
    try {
      await db.query(
        "update profiles set role = 'owner' where id = $1",
        [userIdB]
      );
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/check constraint/i);
    }
    expect(threw).toBe(true);
    const [row] = (
      await db.query<{ role: string }>(
        "select role from profiles where id = $1",
        [userIdB]
      )
    ).rows;
    expect(row.role).toBe("user");
  });

  it("migration 7: legacy 'active' status was unified and every row is legal", async () => {
    const active = await rowCount(db, "select count(*) from profiles where status = 'active'", []);
    expect(active).toBe(0);
    // No profile may carry a status outside the final four.
    const illegal = await rowCount(
      db,
      "select count(*) from profiles where status not in ('pending', 'approved', 'rejected', 'disabled')",
      []
    );
    expect(illegal).toBe(0);
  });

  it("migration 7: the status CHECK rejects the removed 'active' value", async () => {
    let threw = false;
    try {
      await db.query(
        "update profiles set status = 'active' where id = $1",
        [userIdB]
      );
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/check constraint/i);
    }
    expect(threw).toBe(true);
  });

  it("migration 7: all four approved statuses are legal (service role)", async () => {
    for (const status of ["pending", "approved", "rejected", "disabled"]) {
      await db.query("update profiles set status = $1 where id = $2", [status, userIdB]);
    }
    const [row] = (
      await db.query<{ status: string }>(
        "select status from profiles where id = $1",
        [userIdB]
      )
    ).rows;
    expect(row.status).toBe("disabled");
  });

  it("migration 7: new signups still default to 'pending' with role 'user'", async () => {
    const [nu] = (
      await db.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), 'migration7@example.com', '{}'::jsonb)
         returning id`,
        []
      )
    ).rows;
    const [row] = (
      await db.query<{ role: string; status: string }>(
        "select role, status from profiles where id = $1",
        [nu.id]
      )
    ).rows;
    expect(row.role).toBe("user");
    expect(row.status).toBe("pending");
  });
});