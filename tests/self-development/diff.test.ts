import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { diffStats, redactSecretContent, sha256Hex, unifiedDiff } from "@/server/self-development/diff";

describe("sha256Hex", () => {
  it("produces the expected hex digest", () => {
    expect(sha256Hex("hello")).toBe(createHash("sha256").update("hello").digest("hex"));
  });
});

describe("redactSecretContent", () => {
  it("redacts credential-looking spans but keeps normal code", () => {
    const unsafe = "const token = 'sk-abcdefghijklmnop'; console.log('hi');";
    expect(redactSecretContent(unsafe)).toContain("[REDACTED]");
    expect(redactSecretContent(unsafe)).not.toContain("sk-abcdefghijklmnop");

    const key = "AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE";
    expect(redactSecretContent(key)).toContain("[REDACTED]");

    const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----";
    expect(redactSecretContent(privateKey)).toContain("[REDACTED]");

    const clean = "export function add(a, b) { return a + b; }";
    expect(redactSecretContent(clean)).toBe(clean);
  });
});

describe("diffStats + unifiedDiff", () => {
  it("counts added/removed lines correctly", () => {
    const before = "a\nb\nc\n";
    const after = "a\nx\nc\nd\n";
    expect(diffStats(before, after)).toEqual({ added: 2, removed: 1 });
  });

  it("returns an empty diff when nothing changed", () => {
    expect(diffStats("same\n", "same\n")).toEqual({ added: 0, removed: 0 });
    expect(unifiedDiff("src/a.ts", "same\n", "same\n")).toBe("");
  });

  it("produces a valid unified diff with headers and +/- lines", () => {
    const diff = unifiedDiff("src/a.ts", "line1\nline2\nline3\n", "line1\nchanged\nline3\n");
    expect(diff).toContain("--- a/src/a.ts");
    expect(diff).toContain("+++ b/src/a.ts");
    expect(diff).toContain("-line2");
    expect(diff).toContain("+changed");
    expect(diff).toMatch(/@@ .* @@/);
  });

  it("caps oversized diffs instead of O(n*m) blowup", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    const tweaked = `${big}\ndifferent trailing line`;
    const diff = unifiedDiff("big.ts", big, tweaked);
    expect(diff.length).toBeGreaterThan(0);
  });
});