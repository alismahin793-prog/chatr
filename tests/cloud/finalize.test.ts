import { describe, expect, it } from "vitest";
import { isTerminalState, outputTextOf, storedStatusFor } from "@/server/cloud/execution/finalize";

/**
 * Finalization bookkeeping: maps provider terminal states to the persisted
 * operation status and joins provider output chunks. Pure functions tested
 * directly; SQL persistence is exercised via the route tests.
 */
describe("storedStatusFor", () => {
  it("maps exitCode 0 to completed", () => {
    expect(storedStatusFor({ state: "completed", exitCode: 0 })).toBe("completed");
  });

  it("maps non-zero exit to failed", () => {
    expect(storedStatusFor({ state: "completed", exitCode: 3 })).toBe("failed");
  });

  it("preserves timed_out itself", () => {
    expect(storedStatusFor({ state: "timed_out", exitCode: null })).toBe("timed_out");
  });

  it("preserves cancelled itself", () => {
    expect(storedStatusFor({ state: "cancelled", exitCode: null })).toBe("cancelled");
  });

  it("maps provider error to failed", () => {
    expect(storedStatusFor({ state: "error", exitCode: null })).toBe("failed");
  });
});

describe("isTerminalState", () => {
  it("treats running as live", () => {
    expect(isTerminalState("running")).toBe(false);
  });

  it("treats everything else as terminal", () => {
    for (const s of ["completed", "failed", "timed_out", "cancelled", "error"]) {
      expect(isTerminalState(s), s).toBe(true);
    }
  });
});

describe("outputTextOf", () => {
  it("joins chunks in seq order and drops NUL bytes", () => {
    const chunks = [
      { seq: 0, kind: "stdout" as const, text: "hello" },
      { seq: 1, kind: "stderr" as const, text: "\u0000 warning" },
    ];
    expect(outputTextOf(chunks)).toBe("hello warning");
  });

  it("handles an empty chunk list", () => {
    expect(outputTextOf([])).toBe("");
  });
});