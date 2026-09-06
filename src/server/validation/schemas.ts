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

/** Shared error formatting so all API consumers see the same shape. */
export function formatZodError(err: z.ZodError): { message: string; issues: z.ZodIssue[] } {
  const first = err.issues[0];
  const message = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.";
  return { message, issues: err.issues };
}