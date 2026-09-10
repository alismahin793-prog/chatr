# Self-Development (supervised cloud code changes)

The Self Development area (`/admin/cloud/self-development`) lets the super-admin
request an AI-planned, human-approved code change against a cloud project. The
engine runs bounded, sandboxed work in the same confined local workspace the
Cloud Development area uses, then asks for approval at *two* gates:
**approve plan** and **approve deploy**. No change is ever applied to
production code, and (by default) the pipeline never deploys to production at
all — it stops at preview.

> **Security model first.** Same principle as Cloud Development: every external
> capability is a provider whose local default is real but confined, and whose
> answer on the Vercel serverless runtime is honestly "not configured". The AI
> is never the deploy key — a human approval is required for every written file
> and every deployment.

---

## Architecture

```
UI  (src/app/admin/(panel)/cloud/self-development/**, src/components/admin/cloud/selfdevelopment/**)
   │  via CloudApi.selfDevelopment
   ▼
Routes (src/app/api/admin/cloud/self-development/**)
   │  reads: requireAdminIdentity
   │  create:  requireSensitivePermission(create_dev_requests)
   │  plan approval:  approve_dev_plans
   │  deploy approval: approve_deployments
   ▼
Orchestrator (src/server/self-development/orchestrator.ts)
   │  store · workspace · modifier · git · execution · deployment · ai
   ▼
Providers (src/server/cloud/{workspace,git,execution,deploy}/*) — shared with Cloud Development
```

The orchestrator is the only writer. It drives a status machine (each step is
audited) and every file write goes through `CodeModificationProvider`, which:

- normalises and confines paths inside the project workspace,
- **refuses** sensitive paths (`.env*`, `.npmrc`, `.git/`, `.ssh`, private
  keys, certs),
- records a `sha256` hash and a **redacted unified diff** for each applied
  change (`SECRET_CONTENT_PATTERNS` are replaced with `[REDACTED]` before
  anything is persisted or displayed); stored diffs are redacted and
  line-limited,
- refuses files outside the workspace and caps the changed files per request,
- skips a change (with `skip` + reason) instead of dying on a single bad op.

## AI contract

`SelfDevelopmentAi` streams from the same `ChatProvider` as the cloud chat and
extracts strictly structured values for every step:

- a development **plan** (`goal`, `affectedFiles`, `affectedSystems`,
  `potentialRisks`, `databaseChanges`, `apiChanges`, `uiChanges`,
  `securityImpact`, `testingStrategy`, `deploymentImpact`, `rollbackStrategy`),
- **change operations** (create/edit/rename/delete + full file content),
- a **review verdict** (`approved` / `rejected` with reasons for security,
  correctness, architecture, regression risk, performance, code quality,
  tests, database/auth/deployment impact),
- build-failure **repair** operations.

If the AI does not return a parseable structured value the step fails loudly
("The AI did not return a structured …") — it never guesses. Non-approved
verdicts halt the run; secrets are never included in prompts.

## Lifecycle

```
draft → planning → awaiting_plan_approval → snapshotting → workspace_preparing
→ analyzing → modifying → testing → typechecking → linting → building
→ reviewing → awaiting_deploy_approval → deploying → verifying → completed
```

Every arrow may also land on `failed`; `cancelled` is available from every
active state, `rejected` from `awaiting_plan_approval`, and `rolled_back` only
after a deploy completed or a failed attempt. Terminal states are
`completed`, `failed`, `rolled_back`, `cancelled`, `rejected`.

Requests carry a **risk level** (`low`/`medium`/`high`/`critical`): critical
changes additionally require an explicit `acknowledgeCritical` at **both**
approval gates. Gates cannot be skipped: `draft` cannot jump straight to
`modifying`, and a plan approval cannot be followed by a deploy approval
without the intervening pipeline steps.

## Permissions

Three sensitive permissions (managed in `/admin/cloud/permissions`):

- `create_dev_requests` — start planning / request new work.
- `approve_dev_plans` — approve or reject a produced plan.
- `approve_deployments` — approve a preview deploy, or roll back one.

Every mutation routes through `requireSensitivePermission` (or `requireAdmin`
for neutral actions like start-planning/run/cancel) plus full audit logging.

## Databases

One additive migration: `supabase/migrations/20260910000000_self_development.sql`.

- `self_development_requests` — a request's goal, risk level, plan summary,
  current status, timings, and terminal outcome.
- `self_development_steps` — one row per status transition (status → status,
  started/finished times, outcome, error).
- `self_development_changes` — one row per approved change op: path, op type,
  `sha256` hash, and the **redacted** unified diff.

> Apply out-of-band, never via `supabase db push`:
> `supabase db query --linked --file supabase/migrations/20260910000000_self_development.sql`

RLS keeps rows admin-only; the database never stores file contents or secrets,
only hashes and redacted diffs.

## Honest availability

| Capability                | Without config (serverless)   | With config                       |
| ------------------------- | ----------------------------- | --------------------------------- |
| Workspace + file writes   | confined local workspace      | same (`CLOUD_WORKSPACE_ROOT`)     |
| Verification (test/lint/…) | `not configured` (no sim)    | `CLOUD_EXECUTION_WORKER_URL`      |
| Git ops                   | `not configured`              | `CLOUD_EXECUTION_WORKER_URL`      |
| Deploy / rollback         | `not configured`              | `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` |
| AI planning/review        | `not configured` (503)        | a cloud chat provider configured  |

The AI provider list reuses the chat provider registry; if none is configured
the whole flow honestly refuses to start rather than pretending to plan.

## Configuration

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `ALLOW_PRODUCTION_SELF_MODIFICATION` | `"false"` | Even `"true"` **never bypasses approvals**; it only lets an approved request deploy a preview commit to the project. Otherwise the pipeline stops at the deploy-approval gate with manual instructions. |
| `MAX_REPAIR_ATTEMPTS` | `3` | Bounded AI repair loop on build/test/lint failures. |
| `SELF_DEVELOPMENT_TIMEOUT_MS` | `1800000` | Hard timeout for the whole run — no unbounded work. |
| `SELF_DEVELOPMENT_MAX_FILES_CHANGED` | `50` | Cap on changed files per request. |

## URLs

- `/admin/cloud/self-development` — list, stats, refresh.
- `/admin/cloud/self-development/new` — pick a project + goal, start planning.
- `/admin/cloud/self-development/[id]` — plan, review, redacted diffs, actions
  (approve/reject/run/cancel/rollback), timeline, verifications.

## Tests

`tests/self-development/` covers the security-critical pieces:

- `risk.test.ts` — deterministic risk tiers decided by the engine (keyword
  tiers over the prompt + affected files, no AI self-grading).
- `lifecycle.test.ts` — the full transition rules, gate-skip refusal, terminal
  states.
- `diff.test.ts` — `sha256Hex`, redaction, diff statistics, unified diff
  rendering.
- `ai-parse.test.ts` — strict JSON extraction, plan/ops/review parsing,
  streaming accumulation, honest failure.
- `modifier.test.ts` — real-fs create/edit/rename/delete, sensitive-path
  skips, redaction.
- `orchestrator.test.ts` — in-memory end-to-end run: plan → approve → code →
  verify → review → deploy → rollback, plus the critical-ack gate, disabled
  production self-modification, cancel conflicts, and rollback confirmation.

`tests/ui/admin-layout.test.ts` keeps the admin nav model honest (Self
Development group, all new pages guarded).