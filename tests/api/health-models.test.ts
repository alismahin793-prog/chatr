import { afterEach, describe, expect, it } from "vitest";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as modelsGet } from "@/app/api/models/route";

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER;
});

describe("GET /api/health", () => {
  it("is public and reports ok", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });
});

describe("GET /api/models", () => {
  it("lists configured providers without exposing keys", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const res = await modelsGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.providers.map((p: { id: string }) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("mock");
    expect(ids).not.toContain("anthropic");
    const asString = JSON.stringify(body);
    expect(asString).not.toContain("sk-test");
  });

  it("never lists the mock provider in production", async () => {
    const previous = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    try {
      process.env.OPENAI_API_KEY = "sk-test";
      const body = await (await modelsGet()).json();
      expect(body.providers.map((p: { id: string }) => p.id)).not.toContain("mock");
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = previous ?? "test";
    }
  });
});