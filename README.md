# Chatr

A cloud-first, free-tier-first AI chat platform.

- **Frontend/API**: Next.js 16 (App Router) — deployed on Vercel
- **Database & Auth**: Supabase Cloud (Postgres + RLS)
- **AI**: pluggable provider abstraction (OpenAI, Anthropic, Gemini, extensible)
- **Usage**: 100% cloud. No local servers, no Docker, no local LLMs required.

## Production

The application runs entirely in the cloud and keeps working when this
development machine is offline.

- Deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- AI providers: [`docs/PROVIDERS.md`](docs/PROVIDERS.md)

## Configuration

Copy `.env.example` and fill in the values (or configure them in your cloud
platform as server-side environment variables):

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project
- `AI_PROVIDER` + the matching `*_API_KEY` / `*_MODEL` — AI backend
- `MAX_CONTEXT_MESSAGES` (optional) — history window size

`AI_PROVIDER=mock` is accepted only outside production, allowing a zero-key
development experience.

## Development

```bash
npm install
npm run dev          # defaults to the mock AI provider; Supabase keys required
```

## Verification

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run test         # Vitest (unit, component, API, RLS via PGlite)
npm run build        # production build
```

## Repository layout

- `src/app` — routes, pages, API route handlers
- `src/components` — UI components
- `src/lib` — Supabase clients, client-side SSE helpers
- `src/server` — AI providers, data access, validation, env, error handling
- `supabase/migrations` — schema, RLS policies, triggers
- `tests` — test suites
- `docs` — architecture, deployment, provider documentation

## Deployment

1. Create a Supabase project and apply the migration in `supabase/migrations/`.
2. Create a Vercel project connected to this repository.
3. Set the environment variables from `.env.example`.
4. Deploy. See `docs/DEPLOYMENT.md` for step-by-step instructions.