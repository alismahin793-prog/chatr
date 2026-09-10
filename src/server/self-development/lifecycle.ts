import type { SelfDevelopmentRequestStatus } from "@/lib/supabase/database.types";
import { ConflictError } from "@/server/errors";

/**
 * Lifecycle state machine for self-development requests. Every transition is
 * explicit: the engine can only advance along these edges, so a request can
 * never silently skip a gate (plan approval before snapshotting, deploy
 * approval before deploying, etc.).
 */

const TRANSITIONS: Record<SelfDevelopmentRequestStatus, readonly SelfDevelopmentRequestStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["awaiting_plan_approval", "failed", "cancelled"],
  awaiting_plan_approval: ["snapshotting", "rejected", "cancelled"],
  snapshotting: ["workspace_preparing", "failed", "cancelled"],
  workspace_preparing: ["analyzing", "failed", "cancelled"],
  analyzing: ["modifying", "failed", "cancelled"],
  modifying: ["testing", "failed", "cancelled"],
  testing: ["typechecking", "modifying", "failed", "cancelled"],
  typechecking: ["linting", "modifying", "failed", "cancelled"],
  linting: ["building", "modifying", "failed", "cancelled"],
  building: ["reviewing", "modifying", "failed", "cancelled"],
  reviewing: ["awaiting_deploy_approval", "modifying", "failed", "cancelled"],
  awaiting_deploy_approval: ["deploying", "cancelled"],
  deploying: ["verifying", "failed", "cancelled"],
  verifying: ["completed", "failed", "cancelled"],
  completed: ["rolled_back"],
  failed: ["rolled_back"],
  rolled_back: [],
  cancelled: [],
  rejected: [],
};

export function canTransition(
  from: SelfDevelopmentRequestStatus,
  to: SelfDevelopmentRequestStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws ConflictError (409) when the transition is not allowed. */
export function assertTransition(
  from: SelfDevelopmentRequestStatus,
  to: SelfDevelopmentRequestStatus
): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `Cannot move a request from "${from}" to "${to}" — that transition is not allowed by the lifecycle.`
    );
  }
}

const TERMINAL = new Set<SelfDevelopmentRequestStatus>([
  "completed",
  "failed",
  "rolled_back",
  "cancelled",
  "rejected",
]);

export function isTerminal(status: SelfDevelopmentRequestStatus): boolean {
  return TERMINAL.has(status);
}