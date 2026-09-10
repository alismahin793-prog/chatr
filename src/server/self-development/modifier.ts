import type { WorkspaceProvider } from "@/server/cloud/types";
import { isSensitivePath, normalizeRelPath } from "@/server/cloud/paths";
import { AppError } from "@/server/errors";
import { redactSecretContent, sha256Hex, unifiedDiff, type DiffStats } from "./diff";
import type { AppliedChange, ApplyModificationResult, CodeChangeOp } from "./types";

/**
 * CodeModificationProvider — the ONLY way the Self-Development Engine touches
 * files. It executes structured operations (create/edit/rename/delete) through
 * the bounded WorkspaceProvider; the AI never reaches a shell and never
 * receives raw filesystem paths from the client.
 *
 * Every applied change records before/after sha256 and a unified diff whose
 * credential-looking content is always redacted. Sensitive or unsafe paths are
 * refused (skipped with a reason), never silently applied.
 */

const MAX_CONTEXT_FILES = 12;
const MAX_CONTEXT_FILE_BYTES = 40_000;
const MAX_STORED_DIFF_LINES = 2000;

export class CodeModificationProvider {
  constructor(private readonly workspace: WorkspaceProvider) {}

  private async probeFile(
    root: string,
    relPath: string
  ): Promise<{ exists: true; content: string } | { exists: false; reason: string }> {
    try {
      const { content } = await this.workspace.readFile(root, relPath);
      return { exists: true, content };
    } catch (error) {
      if (error instanceof AppError) {
        return { exists: false, reason: error.message };
      }
      return { exists: false, reason: "Target file does not exist." };
    }
  }

  private safeRel(relPath: string): string {
    return normalizeRelPath(relPath).join("/");
  }

  /** Applies a batch of structured operations; individual refusals become skips. */
  async apply(root: string, ops: readonly CodeChangeOp[]): Promise<ApplyModificationResult> {
    const applied: AppliedChange[] = [];
    const skipped: Array<{ file: string; reason: string }> = [];

    for (const op of ops) {
      try {
        const result = await this.applyOne(root, op);
        if (result) applied.push(result);
      } catch (error) {
        const message = error instanceof AppError ? error.message : "Operation was refused.";
        skipped.push({ file: this.describeOp(op), reason: message });
      }
    }
    return { applied, skipped };
  }

  private describeOp(op: CodeChangeOp): string {
    switch (op.op) {
      case "rename":
        return `${op.from} -> ${op.to}`;
      default:
        return op.path;
    }
  }

  private async applyOne(root: string, op: CodeChangeOp): Promise<AppliedChange | null> {
    switch (op.op) {
      case "create": {
        const rel = this.safeRel(op.path);
        if (!rel) throw new AppError("validation", "A file path is required.");
        if (isSensitivePath(rel)) throw new AppError("forbidden", "Sensitive path refused.");
        const existing = await this.probeFile(root, rel);
        if (existing.exists) throw new AppError("conflict", "File already exists.");
        await this.workspace.writeFile(root, rel, op.content);
        const after = sha256Hex(op.content);
        const diff = this.storableDiff(rel, "", op.content);
        return this.entry(rel, "create", null, null, null, after, diff);
      }
      case "edit": {
        const rel = this.safeRel(op.path);
        if (!rel) throw new AppError("validation", "A file path is required.");
        if (isSensitivePath(rel)) throw new AppError("forbidden", "Sensitive path refused.");
        const existing = await this.probeFile(root, rel);
        if (!existing.exists) throw new AppError("not_found", existing.reason);
        if (existing.content === op.content) throw new AppError("conflict", "No change made.");
        await this.workspace.writeFile(root, rel, op.content);
        const before = sha256Hex(existing.content);
        const after = sha256Hex(op.content);
        const diff = this.storableDiff(rel, existing.content, op.content);
        return this.entry(rel, "edit", null, null, before, after, diff);
      }
      case "rename": {
        const from = this.safeRel(op.from);
        const to = this.safeRel(op.to);
        if (!from || !to) throw new AppError("validation", "Both rename paths are required.");
        if (isSensitivePath(from) || isSensitivePath(to)) {
          throw new AppError("forbidden", "Sensitive path refused.");
        }
        const existing = await this.probeFile(root, from);
        if (!existing.exists) throw new AppError("not_found", existing.reason);
        await this.workspace.renamePath(root, from, to);
        const before = sha256Hex(existing.content);
        const after = sha256Hex(existing.content);
        const diff = redactSecretContent(`--- a/${from}\n+++ b/${to}`);
        return this.entry(from, "rename", from, to, before, after, diff);
      }
      case "delete": {
        const rel = this.safeRel(op.path);
        if (!rel) throw new AppError("validation", "A file path is required.");
        if (isSensitivePath(rel)) throw new AppError("forbidden", "Sensitive path refused.");
        const existing = await this.probeFile(root, rel);
        if (!existing.exists) throw new AppError("not_found", existing.reason);
        await this.workspace.deletePath(root, rel);
        const before = sha256Hex(existing.content);
        const diff = this.storableDiff(rel, existing.content, "");
        return this.entry(rel, "delete", null, null, before, null, diff);
      }
    }
  }

  private storableDiff(file: string, before: string, after: string): string {
    const diff = unifiedDiff(file, before, after);
    const redacted = redactSecretContent(diff);
    const lines = redacted.split("\n");
    if (lines.length > MAX_STORED_DIFF_LINES) {
      return `${lines.slice(0, MAX_STORED_DIFF_LINES).join("\n")}\n...`;
    }
    return redacted;
  }

  private entry(
    file: string,
    operation: AppliedChange["operation"],
    pathFrom: string | null,
    pathTo: string | null,
    beforeSha256: string | null,
    afterSha256: string | null,
    diff: string
  ): AppliedChange {
    const stats: DiffStats = { added: 0, removed: 0 };
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) stats.added++;
      else if (line.startsWith("-") && !line.startsWith("---")) stats.removed++;
    }
    return { file, operation, pathFrom, pathTo, beforeSha256, afterSha256, diff, ...stats };
  }

  /**
   * Reads a scoped set of files for AI context, skipping sensitive/oversized
   * files and capping each snippet. Contents are engine-side only — the AI
   * never receives sensitive paths or files (the workspace provider refuses
   * them) and nothing read here is persisted.
   */
  async readContextFiles(
    root: string,
    paths: readonly string[]
  ): Promise<Array<{ path: string; content: string; truncated: boolean }>> {
    const out: Array<{ path: string; content: string; truncated: boolean }> = [];
    for (const rel of paths) {
      if (out.length >= MAX_CONTEXT_FILES) break;
      const safe = this.safeRel(rel);
      if (!safe || isSensitivePath(safe)) continue;
      try {
        const { content } = await this.workspace.readFile(root, safe);
        out.push({
          path: safe,
          content: content.slice(0, MAX_CONTEXT_FILE_BYTES),
          truncated: content.length > MAX_CONTEXT_FILE_BYTES,
        });
      } catch {
        // skip unreadable entries silently (binary, forbidden, missing)
      }
    }
    return out;
  }
}