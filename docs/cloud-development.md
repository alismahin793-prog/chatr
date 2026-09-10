# Cloud Development (super-admin workspaces)

The Cloud Development area gives the super-admin real, isolated dev workspaces
inside `/admin/cloud`: a file browser + editor, an approved command terminal, a
pipeline runner, git, snapshots with safe rollback, deployments/previews, and
environment-variable *metadata*. It is gated to `super_admin` with the same
30-second re-auth (`requireAdmin` / `useElevatedAction`) and full audit logging
as the rest of the console.

> **Security model first.** Every capability is built as a provider interface
> whose local default is real but confined, and whose production answer on the
> Vercel serverless runtime is *honestly "not configured"*. Nothing is ever
> simulated, and no capability pretends to work when the runtime cannot back it.

---

## Architecture

```
UI  (src/app/admin/(panel)/cloud/**, src/components/admin/cloud/**)
   │  via CloudApi helper (fetch)
   ▼
Routes (src/app/api/admin/cloud/**)
   │  reads: requireAdminIdentity · mutations: requireAdmin + logAdminAction
   ▼
Service layer (src/server/cloud/service.ts)
   ▼
Providers (src/server/cloud/{execution,workspace,git,deploy}/*)
```

- **Workspace provider** — per-project directory under `CLOUD_WORKSPACE_ROOT`
  (default: OS temp). Every client-supplied path is re-normalised and confined
  with `assertInsideWorkspace()`; sensitive files (`.env*`, `.npmrc`, `.git/`,
  `.ssh`, private keys, certs) are refused for read/write/rename/delete;
  binary and >1 MB files are refused; listings are capped.
- **Execution provider** — never a shell. An allowlisted program
  (`npm`, `npx`, `pnpm`, `yarn`, `node`, `git`, `tsx`, `eslint`, `vitest`,
  `next`; `.cmd` on Windows) is spawned with an explicit argv, output limiter,
  hard timeout, and cancellation. `CommandSecurity` also rejects shell
  metacharacters, force/clean/delete flags, `npm run` lifecycle scripts, all
  git history-rewriting subcommands, and force pushes.

## Cloud Execution worker (`worker/`)

A real, isolated, authenticated execution endpoint for the `RemoteExecutionProvider`.
It is a standalone Node process (compiled with `tsc`, CommonJS, zero runtime
dependencies) that reuses the shared security modules
(`CommandSecurity`, `paths`, `output`, `errors`, `buildSpawnEnv`) via relative
imports.

**Contract (matches `RemoteExecutionProvider` exactly — no extra endpoints):**

| Endpoint                             | Behaviour                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `POST /processes`                    | Validates (auth, JSON, allowlist, workspace, env), spawns `shell:false`, and **blocks until the process reaches a terminal state**, returning the final `ProcessSnapshot`. |
| `POST /processes/:id/cancel`         | Requests cancellation (SIGTERM → SIGKILL after a grace period) and returns the snapshot. |
| `GET /health`                        | `{ ok: true, service: "cloud-execution-worker", pid, uptimeMs }` (unauthenticated, minimal). |

Because `RemoteExecutionProvider` has no poll/status/stream support, the
run response *is* the completion signal: the app finalizes an operation from
`run()` alone. A duplicate or over-capacity run is refused with `409`.

**Security:**

- Every `/processes*` request requires `Authorization: Bearer
  <CLOUD_EXECUTION_WORKER_TOKEN>` (constant-time comparison). The app provider
  sends this token; a worker without the token is not configured.
- The worker re-runs `assertSafeCommand` — never trusts the app to have
  validated the command.
- `cwd` must resolve inside `CLOUD_WORKER_WORKSPACE_ROOT` (validated twice,
  including via realpath so symlinks/junctions cannot escape) and never inside
  `.git/.ssh/.env*/…`.
- The child inherits only the shared env allowlist plus explicitly allowed
  request variables. Worker secrets and secret-looking names are refused;
  structural variables (`PATH`, `ComSpec`, …) cannot be overridden.
- Output is bounded to `maxOutputBytes`, redacted (`redactSecretContent`), and
  NUL-stripped before byte counting; it is never persisted and never returned
  (no streaming endpoint).
- Logs are JSON lines and never contain tokens, arguments, output, or paths.

**Run it:**

```bash
npm run worker:build        # tsc -> worker/dist (CommonJS)
CLOUD_EXECUTION_WORKER_TOKEN=<shared> CLOUD_EXECUTION_WORKER_PORT=8787 \
  npm run worker:start      # node worker/dist/worker/src/index.js
```

Then set the same token (and `CLOUD_EXECUTION_WORKER_URL=http://127.0.0.1:8787`)
for the Next.js app. For local dev, leave
`CLOUD_WORKER_WORKSPACE_ROOT` unset on both sides so they share the default temp
workspace. Worker env names live in `.env.example`; defaults in
`worker/src/config.ts`. Commands, pipelines, git, and deployments still work;
streaming output is intentionally not part of the remote contract.
- **Git provider** — `git` with a bounded argv. Only *additive* operations:
  status/log/diff/branches, `checkout -b`, commit, `pull --ff-only`, `push`
  (never forced). Every branch switch refuses a dirty worktree, which is what
  makes snapshot rollback safe.
- **Deploy provider** — real Vercel deploy/preview/env-secrets only when
  `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` are configured. Env values are pushed
  in-flight; the database stores **metadata only**
  (`{ name, configured, updatedAt }`).

## Honest availability

On **local dev / the test worker** the local providers are fully functional.
On the **Vercel serverless runtime** persistent processes cannot exist and
secrets cannot be presented without configuration, so:

| Capability                      | Without config (serverless)          | With config                     |
| ------------------------------- | ------------------------------------ | ------------------------------- |
| Files / workspace               | read + edit (per-project dirs)       | same (`CLOUD_WORKSPACE_ROOT`)   |
| Terminal / pipeline             | `not configured` (503, no simulation)| `CLOUD_EXECUTION_WORKER_URL`    |
| Git (status/branch/commit/push) | `not configured`                     | `CLOUD_EXECUTION_WORKER_URL`    |
| Deployments / previews / env    | `not configured`                     | `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` |

The provider status screen (`/admin/cloud`) explains exactly which env var to
set for each missing capability. Route handlers return proper
`402/503`-style errors rather than fake data.

## Database

One additive migration: `supabase/migrations/20260909000000_cloud_development.sql`.

- `cloud_projects` — owned by the auth user, RLS on the `cloud_admin`
  (`super_admin`) membership, worker-gated service-role access, `env_vars`
  metadata column (jsonb, never values).
- `cloud_operations` — every command/pipeline run by the admin with
  provider, state, timings, exit code, truncated output, `secret_redacted`
  flag.
- `cloud_snapshots` — per-project git ref snapshots (metadata + `ref`).

> Apply out-of-band, never via `supabase db push`:
> `supabase db query --linked --file supabase/migrations/20260909000000_cloud_development.sql`

All mutations are wrapped so the service role is the only path for the app
(`service_role`); RLS never exposes rows to arbitrary signed-in users.
Env values never reach the database, logs, or response bodies
(`SECRET_CONTENT_PATTERNS` redaction/refusal).

## Pipeline

`CLOUD_PIPELINE_STEPS` drives `PipelinePanel` and the pipeline UI: `install`,
`lint`, `typecheck`, `test`, `build`. Each step becomes one audited
`cloud_operations` row whose command is mapped from the step key
(`build`,`test`,`install`,`lint`,`typecheck`,`command`), never from a template
string that could smuggle flags.

## URLs

- `/admin/cloud` — hub: provider statuses, stats, pipeline steps.
- `/admin/cloud/projects` — create/archive projects, open a workspace.
- `/admin/cloud/projects/[id]/{files,terminal,git,pipeline,snapshots,deployments,environments}`
- `/admin/cloud/deployments`, `/admin/cloud/environments` — cross-project views.
- `/api/admin/cloud/**` — all data + mutation routes.

## Tests

`tests/cloud/` covers the security-critical pieces with real processes and
real git repos:

- `command-security.test.ts` — tokenizer, allowlist, forbidden flags,
  git subcommands, force-push refusal, lifecycle scripts.
- `paths.test.ts` — confinement against traversal/drive/absolute paths,
  sensitive-path refusal, secret-content detection.
- `workspace-provider.test.ts` — real fs CRUD, traversal/sensitive/binary/size
  refusal, search isolation.
- `execution-provider.test.ts` — real child processes: output capture, exit
  codes, timeout kill, cancel, serverless honesty.
- `git-provider.test.ts` — real repos: commit/log/branch/diff, and the dirty-
  worktree rollback guard.

`tests/ui/admin-layout.test.ts` keeps the admin nav model honest (Cloud group,
all new pages guarded, managers render the console shell).