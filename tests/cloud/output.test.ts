import { describe, expect, it } from "vitest";
import { buildOutputHead } from "@/server/cloud/output";

/**
 * Stored output head: bounded, secret-redacted, NUL-stripped. This is what
 * ends up in cloud_operations.output_head — it must never contain a raw
 * credential or unbounded text.
 */
describe("buildOutputHead", () => {
  it("passes through short innocuous text", () => {
    const { head, truncated } = buildOutputHead("build finished in 12s");
    expect(head).toBe("build finished in 12s");
    expect(truncated).toBe(false);
  });

  it("redacts credentials before they are persisted", () => {
    const { head } = buildOutputHead("token=ghp_1234567890abcdefghij ok\nkey AKIAIOSFODNN7EXAMPLE");
    expect(head).not.toContain("ghp_");
    expect(head).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(head).toContain("[REDACTED]");
  });

  it("strips NUL bytes", () => {
    const { head } = buildOutputHead("a\u0000b\u0000c");
    expect(head).toBe("abc");
  });

  it("truncates long output to the bounded head", () => {
    const { head, truncated } = buildOutputHead("x".repeat(10_000), 4000);
    expect(head.length).toBe(4000);
    expect(truncated).toBe(true);
  });

  it("reports not truncated at or under the cap", () => {
    const { head, truncated } = buildOutputHead("y".repeat(4000), 4000);
    expect(head.length).toBe(4000);
    expect(truncated).toBe(false);
  });

  it("applies redaction before truncation so no secret survives", () => {
    // API key ends up entirely after the first 4000 chars of padding.
    const { head } = buildOutputHead("z".repeat(3990) + " secret=AKIAIOSFODNN7EXAMPLE");
    expect(head).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});