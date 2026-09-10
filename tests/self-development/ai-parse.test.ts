import { describe, expect, it } from "vitest";
import {
  SelfDevelopmentAi,
  collectText,
  extractJsonObject,
  parseChangeOps,
  parsePlan,
  parseReview,
} from "@/server/self-development/ai";
import type { ChatProvider, StreamChunk } from "@/server/ai/types";

function syncProviderReply(reply: string): ChatProvider {
  const iter = (async function* () {
    yield { delta: reply } as StreamChunk;
  })();
  return {
    id: "mock",
    displayName: "Test",
    defaultModel: "test",
    availableModels: [],
    chat() {
      return iter;
    },
  };
}

function providerWith(replies: string[]): ChatProvider {
  return {
    id: "mock",
    displayName: "Test",
    defaultModel: "test",
    availableModels: [],
    async *chat() {
      const reply = replies.length > 0 ? replies.shift() ?? "{}" : "{}";
      yield { delta: reply };
    },
  };
}

describe("extractJsonObject (balanced extraction)", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(extractJsonObject('```json\n{"a":[1,2,3]}\n```')).toEqual({ a: [1, 2, 3] });
  });

  it("ignores prose before/after the JSON", () => {
    expect(extractJsonObject("Here you go:\n{\"a\":\"b\"}\nHope that helps")).toEqual({ a: "b" });
  });

  it("handles nested braces and strings", () => {
    const text = '{"changes":[{"op":"edit","path":"x.ts","content":"{ nested }"}]}';
    expect(extractJsonObject(text)).toEqual({
      changes: [{ op: "edit", path: "x.ts", content: "{ nested }" }],
    });
  });

  it("returns null for invalid JSON", () => {
    expect(extractJsonObject("{nope")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("parsePlan", () => {
  it("accepts a well-formed plan", () => {
    const plan = parsePlan({ goal: "Ship feature", affectedFiles: ["src/a.ts"], affectedSystems: ["api"] });
    expect(plan).not.toBeNull();
    expect(plan?.affectedFiles).toEqual(["src/a.ts"]);
  });

  it("rejects plans without a goal", () => {
    expect(parsePlan({ affectedFiles: [] })).toBeNull();
    expect(parsePlan(null)).toBeNull();
  });
});

describe("parseChangeOps", () => {
  it("normalizes ops and drops invalid entries", () => {
    const ops = parseChangeOps({
      changes: [
        { op: "edit", path: "src\\a.ts", content: "export const x = 1;" },
        { op: "rename", from: "old.ts", to: "new.ts" },
        { op: "nuke", path: "whatever" },
        { op: "" },
      ],
    });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ op: "edit", path: "src/a.ts", content: "export const x = 1;" });
    expect(ops[1]).toEqual({ op: "rename", from: "old.ts", to: "new.ts" });
  });
});

describe("parseReview", () => {
  it("defaults an unknown result to approved", () => {
    const review = parseReview({ summary: "Looks fine" });
    expect(review?.result).toBe("approved");
  });
});

describe("SelfDevelopmentAi (streaming + strict JSON)", () => {
  it("collectText accumulates deltas", async () => {
    const out = await collectText(syncProviderReply("ab"), [], {});
    expect(out).toBe("ab");
  });

  it("buildPlan returns the parsed plan", async () => {
    const ai = new SelfDevelopmentAi(
      providerWith(['{"goal":"Add header","affectedFiles":["src/a.ts"],"affectedSystems":["ui"]}'])
    );
    const plan = await ai.buildPlan({ prompt: "Add a header", projectOverview: "src" });
    expect(plan.goal).toBe("Add header");
    expect(plan.affectedFiles).toEqual(["src/a.ts"]);
  });

  it("planCodeChanges returns structured ops", async () => {
    const ai = new SelfDevelopmentAi(
      providerWith([
        '{"goal":"g","affectedFiles":["src/a.ts"],"affectedSystems":["ui"]}',
        '{"changes":[{"op":"edit","path":"src/a.ts","content":"export const header = true;"}]}',
      ])
    );
    const plan = await ai.buildPlan({ prompt: "x", projectOverview: "y" });
    const ops = await ai.planCodeChanges({ plan, fileTree: ["src/a.ts"], snippets: [] });
    expect(ops[0]).toMatchObject({ op: "edit", path: "src/a.ts" });
  });

  it("reviewChanges parses the review verdict", async () => {
    const ai = new SelfDevelopmentAi(
      providerWith([
        '{"goal":"g","affectedFiles":[],"affectedSystems":["ui"]}',
        '{"result":"approved","summary":"ok"}',
      ])
    );
    const plan = await ai.buildPlan({ prompt: "x", projectOverview: "y" });
    const review = await ai.reviewChanges({
      projectName: "demo",
      fileTree: [],
      plan,
      validationFailures: [],
      snippets: [],
    });
    expect(review.result).toBe("approved");
  });

  it("honestly fails when no structured plan comes back", async () => {
    const empty = new SelfDevelopmentAi(syncProviderReply("no JSON here"));
    await expect(empty.buildPlan({ prompt: "x", projectOverview: "y" })).rejects.toThrow(/structured development plan/i);
  });
});