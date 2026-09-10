import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { NotFoundError, ValidationError } from "@/server/errors";
import { logAdminAction } from "@/server/admin/audit";

/**
 * Self-improvement workflow. Users/admins submit improvement proposals; admins
 * review them (approve / reject / mark implemented). This is an audit trail and
 * decision log only — nothing here executes code or writes to the app. The
 * historical SELF_DEVELOPMENT permissions still govern proposal access.
 */

export type ProposalStatus = "proposed" | "approved" | "rejected" | "implemented";

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "proposed",
  "approved",
  "rejected",
  "implemented",
];

/** Outcomes an admin review may set. "proposed" is deliberately excluded. */
export const REVIEW_STATUSES: readonly ProposalStatus[] = [
  "approved",
  "rejected",
  "implemented",
];

export interface ProposalSummary {
  id: string;
  title: string;
  description: string;
  status: ProposalStatus;
  proposedBy: string | null;
  reviewedBy: string | null;
  reviewComment: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const PROPOSAL_FIELDS =
  "id, title, description, status, proposed_by, reviewed_by, review_comment, created_at, reviewed_at";

type ProposalRow = Database["public"]["Tables"]["improvement_proposals"]["Row"];

function toSummary(row: ProposalRow): ProposalSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    proposedBy: row.proposed_by,
    reviewedBy: row.reviewed_by,
    reviewComment: row.review_comment,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

/** Lists proposals, newest first, optionally filtered by status. */
export async function listProposals(
  service: SupabaseClient<Database>,
  status?: ProposalStatus
): Promise<ProposalSummary[]> {
  let query = service.from("improvement_proposals").select(PROPOSAL_FIELDS);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw supabaseErrorToAppError(error);
  return (data ?? []).map(toSummary);
}

export interface CreateProposalInput {
  title: string;
  description: string;
}

/** Records a new proposal. Logs the action to the audit trail. */
export async function createProposal(
  service: SupabaseClient<Database>,
  input: CreateProposalInput,
  actorId: string
): Promise<ProposalSummary> {
  const { data, error } = await service
    .from("improvement_proposals")
    .insert({
      title: input.title,
      description: input.description,
      proposed_by: actorId,
    })
    .select(PROPOSAL_FIELDS)
    .single();
  if (error) throw supabaseErrorToAppError(error);

  await logAdminAction(service, {
    actorId,
    action: "improvements.proposal_created",
    resourceType: "improvement_proposal",
    resourceId: data.id,
    metadata: { title: input.title },
  });

  return toSummary(data);
}

export interface ReviewProposalInput {
  status: "approved" | "rejected" | "implemented";
  comment?: string;
}

/** Reviews a proposal. Requires a valid target status and an existing row. */
export async function reviewProposal(
  service: SupabaseClient<Database>,
  proposalId: string,
  input: ReviewProposalInput,
  reviewerId: string
): Promise<ProposalSummary> {
  const existing = await getProposal(service, proposalId);
  if (!existing) throw new NotFoundError("Proposal not found.");
  if (!REVIEW_STATUSES.includes(input.status)) {
    throw new ValidationError("Invalid review status.");
  }

  const reviewComment = input.comment?.trim() || null;
  const { data, error } = await service
    .from("improvement_proposals")
    .update({
      status: input.status,
      reviewed_by: reviewerId,
      review_comment: reviewComment,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", proposalId)
    .select(PROPOSAL_FIELDS)
    .single();
  if (error) throw supabaseErrorToAppError(error);

  await logAdminAction(service, {
    actorId: reviewerId,
    action: `improvements.proposal_${input.status}`,
    resourceType: "improvement_proposal",
    resourceId: proposalId,
    metadata: { title: existing.title },
  });

  return toSummary(data);
}

export async function getProposal(
  service: SupabaseClient<Database>,
  proposalId: string
): Promise<ProposalSummary | null> {
  const { data, error } = await service
    .from("improvement_proposals")
    .select(PROPOSAL_FIELDS)
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  return data ? toSummary(data) : null;
}