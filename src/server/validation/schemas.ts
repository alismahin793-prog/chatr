import { z } from "zod";
import { PROVIDER_IDS } from "@/server/ai/types";

const optionalProvider = z
  .enum(PROVIDER_IDS)
  .optional()
  .describe("Which AI backend to use for this conversation.");

export const createConversationSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120).optional(),
  provider: optionalProvider,
  model: z.string().trim().min(1).max(80).optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  content: z.string().trim().min(1, "Message cannot be empty.").max(40_000),
  provider: optionalProvider,
  model: z.string().trim().min(1).max(80).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const conversationIdSchema = z.object({
  id: z.string().uuid("Invalid conversation id."),
});

export const updateConversationSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
});

export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const reauthSchema = z.object({
  password: z.string().min(1, "Password is required.").max(4096),
});

export type ReauthInput = z.infer<typeof reauthSchema>;

// ------------------------------------------------------------------
// Test-user management (Admin Panel)
// ------------------------------------------------------------------

const testUserCapabilities = z.enum(["chat", "models"]);
const testUserStatus = z.enum(["active", "disabled"]);
const optionalIsoDate = z
  .string()
  .datetime()
  .optional()
  .nullable();

export const userIdSchema = z.object({
  id: z.string().uuid("Invalid user id."),
});

export const createTestUserSchema = z.object({
  email: z.string().trim().email("A valid email is required.").max(254),
  displayName: z.string().trim().min(1, "Display name is required.").max(80),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters.")
    .max(128),
  status: testUserStatus.default("active"),
  permissions: z.array(testUserCapabilities).max(10).default([]),
  expiresAt: optionalIsoDate,
});

export type CreateTestUserInput = z.infer<typeof createTestUserSchema>;

export const updateTestUserSchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name is required.").max(80).optional(),
    status: testUserStatus.optional(),
    expiresAt: optionalIsoDate,
  })
  .refine((v) => v.displayName !== undefined || v.status !== undefined || v.expiresAt !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateTestUserInput = z.infer<typeof updateTestUserSchema>;

export const replaceTestUserPermissionsSchema = z.object({
  permissions: z.array(testUserCapabilities).max(10),
});

export type ReplaceTestUserPermissionsInput = z.infer<
  typeof replaceTestUserPermissionsSchema
>;

export const resetTestUserPasswordSchema = z.object({
  password: z
    .string()
    .min(6, "Password must be at least 6 characters.")
    .max(128),
});

export type ResetTestUserPasswordInput = z.infer<typeof resetTestUserPasswordSchema>;

// ------------------------------------------------------------------
// Features registry (Admin Panel)
// ------------------------------------------------------------------

export const updateFeatureSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80).optional(),
    description: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
    availableToUsers: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.enabled !== undefined ||
      v.availableToUsers !== undefined,
    { message: "Provide at least one field to update." }
  );

export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>;

// ------------------------------------------------------------------
// Improvement proposals (Admin Panel / Self-Improvement)
// ------------------------------------------------------------------

export const createProposalSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(160),
  description: z.string().trim().min(1, "Description is required.").max(4000),
});

export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const reviewProposalSchema = z.object({
  status: z.enum(["approved", "rejected", "implemented"]),
  comment: z.string().trim().max(1000).optional(),
});

export type ReviewProposalInput = z.infer<typeof reviewProposalSchema>;

// ------------------------------------------------------------------
// Account directory (Admin Panel)
// ------------------------------------------------------------------

export const accountSearchSchema = z.object({
  query: z.string().trim().min(1, "Query is required.").max(120),
});

// ------------------------------------------------------------------
// Registration approval (Admin Panel / Approvals)
// ------------------------------------------------------------------

export const accountApprovalSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  status: z.enum(["approved", "rejected", "disabled"], {
    message: "Status must be approved, rejected, or disabled.",
  }),
});

export type AccountApprovalInput = z.infer<typeof accountApprovalSchema>;

// ------------------------------------------------------------------
// Cloud Development (Admin Panel / Super Admin)
// ------------------------------------------------------------------

const cloudSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "Slug must start with a letter/digit and contain only lowercase letters, digits, and dashes.");

export const cloudCreateProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  slug: cloudSlug,
  description: z.string().trim().max(2000).optional().default(""),
  repoUrl: z.string().trim().url("A valid repository URL is required.").max(500).optional().nullable(),
  defaultBranch: z.string().trim().min(1).max(120).optional().default("main"),
  baseEnv: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional().default("development"),
});

export type CloudCreateProjectInput = z.infer<typeof cloudCreateProjectSchema>;

export const cloudUpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    repoUrl: z.string().trim().url("A valid repository URL is required.").max(500).optional().nullable(),
    defaultBranch: z.string().trim().min(1).max(120).optional(),
    baseEnv: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

export type CloudUpdateProjectInput = z.infer<typeof cloudUpdateProjectSchema>;

export const cloudExecuteSchema = z.object({
  projectId: z.string().uuid("Invalid project id."),
  command: z.string().trim().min(1, "Command is required.").max(2000),
  kind: z
    .enum(["command", "install", "lint", "typecheck", "test", "build", "process"], {
      message: "Invalid operation kind.",
    })
    .optional()
    .default("command"),
});

export type CloudExecuteInput = z.infer<typeof cloudExecuteSchema>;

export const cloudPipelineSchema = z.object({
  projectId: z.string().uuid("Invalid project id."),
  step: z.enum(["install", "lint", "typecheck", "test", "gate", "build"], {
    message: "Invalid pipeline step.",
  }),
});

export type CloudPipelineInput = z.infer<typeof cloudPipelineSchema>;

export const cloudFileWriteSchema = z.object({
  path: z.string().trim().min(1, "A file path is required.").max(1024),
  content: z.string().max(1_000_000, "File content is too large."),
});

export type CloudFileWriteInput = z.infer<typeof cloudFileWriteSchema>;

export const cloudFileRenameSchema = z.object({
  from: z.string().trim().min(1).max(1024),
  to: z.string().trim().min(1).max(1024),
});

export type CloudFileRenameInput = z.infer<typeof cloudFileRenameSchema>;

export const cloudFileDeleteSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  recursive: z.boolean().optional().default(false),
});

export type CloudFileDeleteInput = z.infer<typeof cloudFileDeleteSchema>;

export const cloudCreateDirSchema = z.object({
  path: z.string().trim().min(1).max(1024),
});

export type CloudCreateDirInput = z.infer<typeof cloudCreateDirSchema>;

export const cloudGitActionSchema = z.object({
  projectId: z.string().uuid("Invalid project id."),
  action: z.enum(["checkout", "create-branch", "commit", "push", "pull", "init"], {
    message: "Invalid git action.",
  }),
  branch: z.string().trim().max(120).optional(),
  defaultBranch: z.string().trim().max(120).optional(),
  message: z.string().trim().max(2000).optional(),
});

export type CloudGitActionInput = z.infer<typeof cloudGitActionSchema>;

export const cloudSnapshotCreateSchema = z.object({
  reason: z.string().trim().min(1, "A snapshot reason is required.").max(1000),
});

export type CloudSnapshotCreateInput = z.infer<typeof cloudSnapshotCreateSchema>;

export const cloudDeploySchema = z.object({
  projectId: z.string().uuid("Invalid project id."),
  kind: z.enum(["preview", "production"], { message: "Invalid deployment kind." }).default("production"),
  branch: z.string().trim().max(120).optional(),
});

export type CloudDeployInput = z.infer<typeof cloudDeploySchema>;

export const cloudRollbackSchema = z.object({
  deploymentId: z.string().uuid("Invalid deployment id."),
  confirm: z.literal(true, { message: "Rollback requires confirmation." }),
});

export type CloudRollbackInput = z.infer<typeof cloudRollbackSchema>;

export const cloudEnvSetSchema = z.object({
  projectId: z.string().uuid("Invalid project id."),
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid environment variable name.").max(128),
  value: z.string().min(1).max(4000),
});

export type CloudEnvSetInput = z.infer<typeof cloudEnvSetSchema>;

export const selfDevelopmentCreateSchema = z.object({
  projectId: z.string().uuid("Invalid project id."),
  prompt: z
    .string()
    .trim()
    .min(10, "Describe what you want built in enough detail.")
    .max(8000, "Prompt is too long."),
});

export type SelfDevelopmentCreateInput = z.infer<typeof selfDevelopmentCreateSchema>;

export const selfDevelopmentActionSchema = z.object({
  action: z.enum(
    ["start-planning", "approve-plan", "reject-plan", "run", "approve-deploy", "cancel", "rollback"],
    { message: "Invalid action." }
  ),
  acknowledgeCritical: z.boolean().optional().default(false),
  confirm: z.boolean().optional().default(false),
});

export type SelfDevelopmentActionInput = z.infer<typeof selfDevelopmentActionSchema>;

// ------------------------------------------------------------------
// Shared error formatting so all API consumers see the same shape.
// ------------------------------------------------------------------
export function formatZodError(err: z.ZodError): { message: string; issues: z.ZodIssue[] } {
  const first = err.issues[0];
  const message = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.";
  return { message, issues: err.issues };
}