import type { ChatMessage, ChatProvider, StreamChunk } from "@/server/ai/types";
import { createProvider } from "@/server/ai/factory";
import { isProviderError } from "@/server/ai/errors";
import { getAiSettings } from "@/server/config/env";
import { AppError } from "@/server/errors";
import type { SelfDevelopmentPlan, SelfDevelopmentReview } from "@/lib/supabase/database.types";
import type { CodeChangeOp, DevelopmentContext } from "./types";

/**
 * AI front-end for the Self-Development Engine.
 *
 * The engine talks to the configured ChatProvider through the same streaming
 * contract as the chat UI (there is no separate non-streaming API), by
 * accumulating the stream. Every capability is strict-JSON with honest
 * failures: if the provider is unconfigured or does not return a well-formed
 * document, the step fails instead of fabricating a plan, review, or diff.
 *
 * Prompts are scoped context only — the engine never sends secrets to the AI.
 */

/** Accumulates a streaming chat response into a single string. */
export async function collectText(
  provider: ChatProvider,
  messages: ChatMessage[],
  options: { model?: string; signal?: AbortSignal } = {}
): Promise<string> {
  let out = "";
  const iter: AsyncGenerator<StreamChunk> = provider.chat({
    messages,
    model: options.model,
    signal: options.signal,
  });
  for await (const chunk of iter) {
    out += chunk.delta;
  }
  return out;
}

/** Extracts the first balanced JSON object from a model reply. */
export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 200);
}

/** Validates a raw AI object into a SelfDevelopmentPlan (or null). */
export function parsePlan(raw: unknown): SelfDevelopmentPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const plan = raw as Record<string, unknown>;
  if (!asString(plan.goal).trim()) return null;
  return {
    goal: asString(plan.goal),
    currentArchitecture: asString(plan.currentArchitecture),
    affectedFiles: asStringList(plan.affectedFiles),
    affectedSystems: asStringList(plan.affectedSystems),
    requiredChanges: asString(plan.requiredChanges),
    potentialRisks: asString(plan.potentialRisks),
    databaseChanges: asString(plan.databaseChanges),
    apiChanges: asString(plan.apiChanges),
    uiChanges: asString(plan.uiChanges),
    securityImpact: asString(plan.securityImpact),
    testingStrategy: asString(plan.testingStrategy),
    deploymentImpact: asString(plan.deploymentImpact),
    rollbackStrategy: asString(plan.rollbackStrategy),
  };
}

/** Validates a raw AI object into a list of structured change operations. */
export function parseChangeOps(raw: unknown): CodeChangeOp[] {
  if (!raw || typeof raw !== "object") return [];
  const list = Array.isArray((raw as { changes?: unknown }).changes)
    ? (raw as { changes: unknown[] }).changes
    : [];
  const ops: CodeChangeOp[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const op = asString(it.op);
    if (op === "create" || op === "edit") {
      const path = asString(it.path).trim().replace(/\\/g, "/");
      const content = typeof it.content === "string" ? it.content : "";
      if (path) ops.push({ op, path, content });
    } else if (op === "rename") {
      const from = asString(it.from).trim().replace(/\\/g, "/");
      const to = asString(it.to).trim().replace(/\\/g, "/");
      if (from && to) ops.push({ op, from, to });
    } else if (op === "delete") {
      const path = asString(it.path).trim().replace(/\\/g, "/");
      if (path) ops.push({ op, path });
    }
  }
  return ops;
}

/** Validates a raw AI object into a SelfDevelopmentReview. */
export function parseReview(raw: unknown): SelfDevelopmentReview | null {
  if (!raw || typeof raw !== "object") return null;
  const review = raw as Record<string, unknown>;
  const resultRaw = asString(review.result).toLowerCase();
  const result = resultRaw === "needs_changes" || resultRaw === "blocked" ? resultRaw : "approved";
  return {
    result,
    summary: asString(review.summary) || "No summary provided.",
    security: asString(review.security),
    correctness: asString(review.correctness),
    architecture: asString(review.architecture),
    regressionRisk: asString(review.regressionRisk),
    performance: asString(review.performance),
    codeQuality: asString(review.codeQuality),
    tests: asString(review.tests),
    databaseImpact: asString(review.databaseImpact),
    authImpact: asString(review.authImpact),
    deploymentImpact: asString(review.deploymentImpact),
    reviewedAt: new Date().toISOString(),
  };
}

const PLAN_SCHEMA = [
  "goal",
  "currentArchitecture",
  "affectedFiles",
  "affectedSystems",
  "requiredChanges",
  "potentialRisks",
  "databaseChanges",
  "apiChanges",
  "uiChanges",
  "securityImpact",
  "testingStrategy",
  "deploymentImpact",
  "rollbackStrategy",
];

const JSON_ONLY = "Reply with one JSON object only. No explanations, no markdown fences, no comments.";

/**
 * Strict-JSON gateway used by the Self-Development Engine. Accepts an injected
 * ChatProvider (tests) or resolves the configured provider from the
 * environment. Failures surface as AppError("unavailable") so orchestration
 * can fail a step honestly instead of guessing.
 */
export class SelfDevelopmentAi {
  constructor(private readonly override?: ChatProvider) {}

  private provider(): ChatProvider {
    if (this.override) return this.override;
    const settings = getAiSettings();
    return createProvider(settings.provider, { model: settings.model });
  }

  async buildPlan(input: { prompt: string; projectOverview: string }): Promise<SelfDevelopmentPlan> {
    const text = await collectText(this.provider(), [
      {
        role: "user",
        content:
          `You are the planning engine of a supervised software development system. ` +
          `Produce a development plan for the requested feature. ` +
          `Ask yourself what currently exists, what must change, what could break, and how it can be tested and rolled back. ` +
          `Use plain language. Never invent credentials, endpoints, or secret values; keep the plan to what is verifiable in the repository. ` +
          JSON_ONLY,
      },
      {
        role: "user",
        content:
          `Feature request:\n${input.prompt}\n\n` +
          `Project overview (sanitized file tree):\n${input.projectOverview}\n\n` +
          `Return a JSON object with exactly these string fields (affectedFiles and affectedSystems are string arrays):\n` +
          PLAN_SCHEMA.map((name) => `"${name}"`).join(", "),
      },
    ]);
    const plan = parsePlan(extractJsonObject(text));
    if (!plan) {
      throw new AppError("unavailable", "The AI did not return a structured development plan.");
    }
    return plan;
  }

  async planCodeChanges(input: {
    plan: SelfDevelopmentPlan;
    fileTree: string[];
    snippets: Array<{ path: string; content: string; truncated: boolean }>;
  }): Promise<CodeChangeOp[]> {
    const text = await collectText(this.provider(), [
      {
        role: "user",
        content:
          `You are the implementation engine of a supervised development system. ` +
          `Translate the approved plan into a minimal list of structured file changes. ` +
          `Each change must be one of: ` +
          `{"op":"create","path":"...","content":"full file contents"}, ` +
          `{"op":"edit","path":"...","content":"full new file contents"}, ` +
          `{"op":"rename","from":"...","to":"..."}, ` +
          `{"op":"delete","path":"..."}. ` +
          `Prefer the smallest correct diff. Never edit .env, key, certificate, or other sensitive files. ` +
          `Never invent secret values. ` +
          JSON_ONLY,
      },
      {
        role: "user",
        content:
          `Approved plan:\n${JSON.stringify(input.plan, null, 2)}\n\n` +
          `Relevant file tree:\n${input.fileTree.join("\n")}\n\n` +
          `Relevant file contents (sanitized):\n${formatSnippets(input.snippets)}\n\n` +
          `Return: {"changes": [ ... ]}`,
      },
    ]);
    const ops = parseChangeOps(extractJsonObject(text));
    if (ops.length === 0) {
      throw new AppError("unavailable", "The AI did not return any structured code changes.");
    }
    return ops;
  }

  async fixBuildFailure(input: {
    plan: SelfDevelopmentPlan;
    fileTree: string[];
    validationFailures: string[];
    snippets: Array<{ path: string; content: string; truncated: boolean }>;
  }): Promise<CodeChangeOp[]> {
    const text = await collectText(this.provider(), [
      {
        role: "user",
        content:
          `You are the repair engine of a supervised development system. ` +
          `Inspect the sanitized failure output and propose the smallest structured change to fix it. ` +
          `Use the same change schema as implementation (op create/edit/rename/delete). ` +
          `Never edit sensitive files, never invent secrets, never regress. ` +
          JSON_ONLY,
      },
      {
        role: "user",
        content:
          `Plan:\n${JSON.stringify(input.plan, null, 2)}\n\n` +
          `File tree:\n${input.fileTree.join("\n")}\n\n` +
          `Relevant file contents (sanitized):\n${formatSnippets(input.snippets)}\n\n` +
          `Sanitized failures:\n${input.validationFailures.join("\n---\n")}\n\n` +
          `Return: {"changes": [ ... ]}`,
      },
    ]);
    const ops = parseChangeOps(extractJsonObject(text));
    if (ops.length === 0) {
      throw new AppError("unavailable", "The AI did not return repair changes.");
    }
    return ops;
  }

  async reviewChanges(input: DevelopmentContext): Promise<SelfDevelopmentReview> {
    const text = await collectText(this.provider(), [
      {
        role: "user",
        content:
          `You are the review engine of a supervised development system. ` +
          `Review the applied changes against the plan and the sanitized results of lint, ` +
          `typecheck, tests, and build. Be strict about regressions, security, secrets, ` +
          `auth/authorization (including RLS), and over-reach. ` +
          `Return "result" as exactly one of "approved", "needs_changes", "blocked". ` +
          `"blocked" means the system must not proceed; "needs_changes" means changes are required before deployment. ` +
          JSON_ONLY,
      },
      {
        role: "user",
        content:
          `Context:\n${JSON.stringify(input, null, 2)}\n\n` +
          `Return a JSON object with: result, summary, security, correctness, architecture, ` +
          `regressionRisk, performance, codeQuality, tests, databaseImpact, authImpact, deploymentImpact (all strings).`,
      },
    ]);
    const review = parseReview(extractJsonObject(text));
    if (!review) {
      throw new AppError("unavailable", "The AI did not return a structured review.");
    }
    return review;
  }
}

/** Wraps provider-level errors (no key configured, quota, network) affordably. */
export function aiErrorMessage(error: unknown): string {
  if (isProviderError(error)) return error.message;
  if (error instanceof AppError) return error.message;
  return "The AI step failed unexpectedly.";
}

function formatSnippets(snippets: Array<{ path: string; content: string; truncated: boolean }>): string {
  if (snippets.length === 0) return "(none)";
  return snippets
    .map((snippet) => `// ${snippet.path}${snippet.truncated ? " (truncated)" : ""}\n${snippet.content}`)
    .join("\n\n");
}