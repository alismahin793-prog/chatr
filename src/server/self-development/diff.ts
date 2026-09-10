import { createHash } from "node:crypto";
import { SECRET_CONTENT_PATTERNS } from "@/server/cloud/paths";

/**
 * Line-level unified diff for the self-development diff/review engine.
 *
 * Diffs are computed in TypeScript from before/after content held in memory;
 * only the diff (plus hashes) is ever persisted. Secret-looking content is
 * redacted before anything is stored, so credentials can never leak through a
 * stored diff, the review page, or the audit trail.
 */

export interface DiffStats {
  added: number;
  removed: number;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Replaces every credential-looking span in `text` with a marker. */
export function redactSecretContent(text: string): string {
  if (!text) return text;
  const combined = new RegExp(SECRET_CONTENT_PATTERNS.map((p) => p.source).join("|"), "gi");
  return text.replace(combined, "[REDACTED]");
}

const MAX_DIFF_LINES = 2000;
const CONTEXT = 3;

type Op =
  | { type: "eq"; line: string }
  | { type: "del"; line: string }
  | { type: "add"; line: string };

/** Diff line counts of two texts (before/after). */
export function diffStats(before: string, after: string): DiffStats {
  if (before === after) return { added: 0, removed: 0 };
  const a = before.split("\n");
  const b = after.split("\n");
  let removed = 0;
  let added = 0;
  for (const op of editScript(a, b)) {
    if (op.type === "del") removed++;
    else if (op.type === "add") added++;
  }
  return { added, removed };
}

/** A unified diff for `filePath` between `before` and `after`. */
export function unifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = editScript(a, b);
  if (ops.length === 0) return "";

  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "eq") changeIndices.push(i);
  }
  if (changeIndices.length === 0) return "";

  // Merge nearby changes into hunks with surrounding context.
  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - CONTEXT);
    const end = Math.min(ops.length - 1, idx + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = end;
    else ranges.push({ start, end });
  }

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];
  for (const range of ranges) {
    const section = ops.slice(range.start, range.end + 1);
    let aCount = 0;
    let bCount = 0;
    for (const op of section) {
      if (op.type !== "add") aCount++;
      if (op.type !== "del") bCount++;
    }
    let aPos = 0;
    let bPos = 0;
    for (const op of ops.slice(0, range.start)) {
      if (op.type !== "add") aPos++;
      if (op.type !== "del") bPos++;
    }
    lines.push(`@@ -${aPos + 1},${aCount || 1} +${bPos + 1},${bCount || 1} @@`);
    for (const op of section) {
      if (op.type === "del") lines.push(`-${op.line}`);
      else if (op.type === "add") lines.push(`+${op.line}`);
      else lines.push(` ${op.line}`);
    }
  }
  if (lines.length > MAX_DIFF_LINES) {
    lines.push("...");
  }
  return lines.join("\n");
}

function editScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // LCS is O(n*m); fall back to prefix/suffix trimming for large inputs so an
  // oversized proposal can never exhaust memory on the server.
  const capped = n * m > 4_000_000;
  if (capped) {
    const ops: Op[] = [];
    let i = 0;
    while (i < n && i < m && a[i] === b[i]) i++;
    let j = 0;
    while (j < n - i && j < m - i && a[n - 1 - j] === b[m - 1 - j]) j++;
    for (let k = i; k < n - j; k++) ops.push({ type: "del", line: a[k] });
    for (let k = i; k < m - j; k++) ops.push({ type: "add", line: b[k] });
    return ops;
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", line: a[i++] });
    } else {
      ops.push({ type: "add", line: b[j++] });
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++] });
  while (j < m) ops.push({ type: "add", line: b[j++] });
  return ops;
}