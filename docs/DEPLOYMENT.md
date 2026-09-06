# Chatr — Deployment (free tier, fully cloud)

Production runs entirely on managed cloud services; the app is reachable from
any device, even when the development PC is off. No local Docker is required.

## Services

| Service    | Role                    | Free tier note                          |
| ---------- | ----------------------- | --------------------------------------- |
| Vercel     | Next.js host (app/API)  | Hobby plan is free                     |
| Supabase   | Postgres + Auth         | Free project with one database (stops after 1 week of inactivity) |
| AI provider| Inference (any one)     | Each has free credits / quotas          |

## Prerequisites

1. A Supabase project: <https://supabase.com/dashboard> → New project.
2. Apply the schema. Auth → Table Editor source is convenient; the canonical
   SQL lives in `supabase/migrations/20260101000000_init.sql` (create extension,
   tables, RLS policies, triggers). Apply it via the Dashboard SQL editor or
   `supabase db push` from the CLI.
   - The migration references `auth.users` and relies on the `AUTH.JWT()`
     claims; do not strip the auth schema when applying.
3. Choose an AI provider and create an API key: OpenAI, Anthropic, or Google
   AI Studio. One key is enough (production requires a real provider).

## Environment variables (Vercel project settings)

Create a Vercel project connected to this repo, then set:

| Variable                        | Where                    | Example                          |
| ------------------------------- | ------------------------ | -------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Settings → API| `https://xxxx.project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API| `eyJhbGciOi...`                  |
| `AI_PROVIDER`                   | one of the providers     | `openai`                         |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | provider dashboard | `sk-...`                |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` (optional) | — | e.g. `gpt-4o-mini` |
| `MAX_CONTEXT_MESSAGES` (optional)| —                        | `20`                             |

Rules enforced in code:

- `AI_PROVIDER=mock` is **rejected in production** (mock only exists for dev).
- A selected provider requires its `*_API_KEY`; otherwise the chat API returns
  a 500 "AI provider is not configured."
- Public (+) variables never store secrets.

## Deploy

1. Push to GitHub, then import the repo into Vercel (framework: Next.js).
2. Add the environment variables above.
3. Deploy. The production build runs static generation, so a redeploy that
   only adds the schema does not need code changes.

## After deploy

- Verify `/api/health` returns `{"status":"ok"}`.
- Sign up via `/signup`, start a chat, confirm the streaming reply persists
  across reloads.

## Notes / caveats

- Free Supabase projects pause after ~1 week of inactivity. Log in to the
  dashboard to resume, or enable a paid plan.
- AI provider API keys are managed outside the repo. Rotate them in the
  provider dashboard, then update Vercel env vars (Vercel redeploys).
- RLS is mandatory: the migration deliberately grants no `service_role` key to
  the app. Never expose a service-role key to the client.