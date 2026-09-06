# Chatr — Architecture

A full-stack, cloud-first AI chat app. Next.js serves both the frontend and API;
Supabase (Postgres + Auth) is the data/auth layer; AI inference comes from
cloud providers (OpenAI, Anthropic, Gemini) through a pluggable adapter layer.

## Runtime shape

- **Frontend**: Next.js 16 App Router (React Server Components + client
  components), Tailwind CSS v4.
- **Auth**: Supabase Auth (email/password). Sessions flow through cookies via
  `@supabase/ssr` (`src/lib/supabase/server.ts`, `client.ts`). A `proxy` (Next
  16 successor to middleware, `src/proxy.ts`) refreshes sessions and protects
  routes; API handlers additionally call `requireUser()` as defense-in-depth.
- **Data**: Postgres via Supabase, accessed only with the user's session and
  guarded by Row-Level Security (see `supabase/migrations/`). All reads/writes
  filter by the authenticated user id.
- **API**: Route handlers in `src/app/api/**`. JSON for CRUD; the chat endpoint
  (`POST /api/chat`) is Server-Sent Events (SSE) streaming.
- **AI layer**: `src/server/ai/` defines a normalized `ChatProvider` interface
  and adapters for OpenAI/Anthropic/Gemini plus a dev-only `mock` provider.

## Request flow (chat)

1. `ChatWorkspace` (client) posts `{ conversationId?, content, provider?, model? }`
   to `POST /api/chat`.
2. The handler authenticates the user, resolves (or creates) the conversation,
   persists the user message, and loads recent history as context.
3. `createProvider()` builds the chosen adapter. The provider streams deltas.
4. Deltas are relayed as `event: delta` SSE frames; on completion the assistant
   reply is persisted and `event: done` returns it. Failures emit `event: error`.

## Key invariants

- **RLS is the source of truth** for ownership — the API never bypasses it.
- **No secrets in clients**: API keys live only in env vars; `/api/models`
  exposes descriptors, never keys.
- **Mock works, but only in dev**: `AI_PROVIDER` defaults to `mock` outside
  production so `npm run dev` needs zero accounts; production refuses the mock.

## Folder layout

```
src/
  app/            routes, pages, API handlers
  components/     React components (auth, chat)
  lib/            supabase clients, client-side helpers (chat-sse)
  server/
    ai/           provider types, adapters, factory, error classification
    api/          shared handler helpers (auth, errors, JSON parsing)
    config/       env resolution
    data/         typed data access (conversations, messages)
    validation/   zod schemas
    errors.ts     HTTP-friendly AppError hierarchy
supabase/migrations/   schema + RLS + triggers (apply to production)
tests/            vitest suites (unit, component, API, RLS via PGlite)
docs/             this documentation set
```

## Testing strategy

Vitest suites mirror the security-sensitive layers:

- `tests/db/rls.test.ts` — migration plus RLS enforcement against
  `@electric-sql/pglite` (WASM Postgres), using an auth shim that emulates
  `auth.uid()`.
- `tests/ai/*` — provider adapters against stub `fetch` implementations
  (success, auth, rate-limit/quota, content-filter, upstream, abort, network).
- `tests/api/*` — handler wiring with mocked Supabase auth + repo modules
  (validation, 401/404, JSON and SSE error shapes).
- `tests/components/*` and `tests/lib/*` — chat UI + SSE client parsing.

`npm run test:gate` is the combined typecheck + lint + test entry point used in
CI.