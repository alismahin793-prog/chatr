import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logAdminAction } from "@/server/admin/audit";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { SelfDevelopmentAi } from "./ai";
import { CodeModificationProvider } from "./modifier";
import { SelfDevelopmentOrchestrator } from "./orchestrator";
import { SupabaseSelfDevelopmentStore } from "./store";
import {
  allowProductionSelfModification,
  appPublicBaseUrl,
  maxFilesChanged,
  maxRepairAttempts,
  selfDevelopmentTimeoutMs,
} from "./config";

/**
 * Wires the Self-Development Engine with the real providers and audit trail.
 * Audit metadata keys are secret-safe; logAdminAction redacts credential-like
 * values automatically and never blocks the workflow on an audit failure.
 */
export function buildOrchestrator(
  service: SupabaseClient<Database>,
  actorId: string
): SelfDevelopmentOrchestrator {
  const workspace = getWorkspaceProvider();
  return new SelfDevelopmentOrchestrator({
    store: new SupabaseSelfDevelopmentStore(service),
    workspace,
    execution: getExecutionProvider(),
    git: getGitProvider(),
    deployment: getDeploymentProvider(),
    ai: new SelfDevelopmentAi(),
    modifier: new CodeModificationProvider(workspace),
    config: {
      allowProductionSelfModification: allowProductionSelfModification(),
      maxRepairAttempts: maxRepairAttempts(),
      timeoutMs: selfDevelopmentTimeoutMs(),
      maxFilesChanged: maxFilesChanged(),
      appBaseUrl: appPublicBaseUrl(),
    },
    audit: async (action, meta) => {
      const requestId = typeof meta?.requestId === "string" ? meta.requestId : undefined;
      await logAdminAction(service, {
        actorId,
        action,
        resourceType: "self_development_request",
        resourceId: requestId,
        metadata: meta ? { ...meta } : {},
      });
    },
  });
}