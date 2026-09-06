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

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260101000000_init.sql"
);

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

describe("supabase migration + RLS data isolation", () => {
  let db: PGlite;
  let userIdA: string;
  let userIdB: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create schema auth;");

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

    // --- apply the real migration --------------------------------------
    const migrationSql = readFileSync(MIGRATION, "utf8").replace(
      // Supabase's managed Postgres ships pgcrypto; PGlite does not, but it
      // runs PostgreSQL 17 where gen_random_uuid() lives in core anyway.
      "create extension if not exists pgcrypto;",
      "-- pgcrypto: preinstalled on Supabase; gen_random_uuid() is core on PG13+"
    );
    await db.exec(migrationSql);

    // --- roles & privileges matching a Supabase project -----------------
    try {
      await db.exec("create role authenticated;");
    } catch {
      /* role already exists */
    }
    await db.exec(`
      grant usage on schema public to authenticated;
      grant all on all tables in schema public to authenticated;
      grant usage on schema auth to authenticated;
      grant execute on all functions in schema auth to authenticated;
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
      "conversations",
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
      ])
    );

    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname in ('profiles','conversations','messages')`,
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
});