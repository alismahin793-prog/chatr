import type {
  SelfDevelopmentChangeOperation,
  SelfDevelopmentPlan,
  SelfDevelopmentRequestStatus,
  SelfDevelopmentReview,
  SelfDevelopmentRiskLevel,
  SelfDevelopmentStepStatus,
} from "@/lib/supabase/database.types";

export type {
  SelfDevelopmentChangeOperation,
  SelfDevelopmentPlan,
  SelfDevelopmentRequestStatus,
  SelfDevelopmentReview,
  SelfDevelopmentRiskLevel,
  SelfDevelopmentStepStatus,
};

export type SelfDevelopmentReviewResult = SelfDevelopmentReview["result"];

/** Human-readable labels for request lifecycle statuses. */
export const REQUEST_STATUS_LABELS: Record<SelfDevelopmentRequestStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  awaiting_plan_approval: "Awaiting plan approval",
  snapshotting: "Snapshotting",
  workspace_preparing: "Preparing workspace",
  analyzing: "Analyzing",
  modifying: "Modifying",
  testing: "Testing",
  typechecking: "Type checking",
  linting: "Linting",
  building: "Building",
  reviewing: "Reviewing",
  awaiting_deploy_approval: "Awaiting deploy approval",
  deploying: "Deploying",
  verifying: "Verifying",
  completed: "Completed",
  failed: "Failed",
  rolled_back: "Rolled back",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

/** Human-readable labels for timeline / validation step stages. */
export const STEP_KIND_LABELS: Record<string, string> = {
  planning: "Planning",
  snapshot: "Snapshot",
  workspace: "Isolated workspace",
  analyze: "Code analysis",
  modify: "Apply changes",
  install: "Install dependencies",
  lint: "Lint",
  typecheck: "Type check",
  test: "Tests",
  gate: "Full gate",
  build: "Production build",
  repair: "Repair",
  commit: "Commit",
  review: "AI review",
  deploy: "Deployment",
  verify: "Verification",
  rollback: "Rollback",
  cancel: "Cancellation",
};

/**
 * Structured file operations the AI may propose. The engine executes these
 * through the workspace provider only — never through a shell.
 */
export type CodeChangeOp =
  | { op: "create"; path: string; content: string }
  | { op: "edit"; path: string; content: string }
  | { op: "rename"; from: string; to: string }
  | { op: "delete"; path: string };

/** A successfully applied modification. `diff` is always secret-redacted. */
export interface AppliedChange {
  file: string;
  operation: SelfDevelopmentChangeOperation;
  pathFrom: string | null;
  pathTo: string | null;
  beforeSha256: string | null;
  afterSha256: string | null;
  diff: string;
  added: number;
  removed: number;
}

/** An operation the engine refused (sensitive path, security policy, etc.). */
export interface SkippedChange {
  file: string;
  reason: string;
}

export interface ApplyModificationResult {
  applied: AppliedChange[];
  skipped: SkippedChange[];
}

/** Sanitized, scoped context handed to the AI. Never contains secrets. */
export interface FileSnippet {
  path: string;
  content: string;
  truncated: boolean;
}

export interface DevelopmentContext {
  projectName: string;
  fileTree: string[];
  plan: SelfDevelopmentPlan;
  /** Sanitized output heads of failed validation steps (for repairs). */
  validationFailures: string[];
  /** Scoped safe file contents for analysis/repair. */
  snippets: FileSnippet[];
}

export interface RiskAssessment {
  level: SelfDevelopmentRiskLevel;
  reasons: string[];
}

export interface DeployCheckResult {
  ok: boolean;
  failures: string[];
}