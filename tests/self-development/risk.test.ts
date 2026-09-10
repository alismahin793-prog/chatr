import { describe, expect, it } from "vitest";
import { classifyRisk, riskLevelLabel } from "@/server/self-development/risk";

describe("classifyRisk (deterministic keyword tiers)", () => {
  it("flags auth / roles / secrets / RLS as critical", () => {
    expect(classifyRisk({ prompt: "Change the super admin authorization flow", affectedFiles: [] }).level).toBe("critical");
    expect(classifyRisk({ prompt: "Touch row level security policies", affectedFiles: [] }).level).toBe("critical");
    expect(classifyRisk({ prompt: "Rotate the api key handling", affectedFiles: [] }).level).toBe("critical");
    expect(classifyRisk({ prompt: "Update .env handling", affectedFiles: ["src/config.ts"] }).level).toBe("critical");
  });

  it("flags auth/session/deploy/migration paths as high", () => {
    expect(classifyRisk({ prompt: "Add session persistence", affectedFiles: [] }).level).toBe("high");
    expect(classifyRisk({ prompt: "Extend the deploy pipeline", affectedFiles: [] }).level).toBe("high");
    expect(classifyRisk({ prompt: "Edit app/api/users route", affectedFiles: [] }).level).toBe("high");
  });

  it("flags api/database/schema changes as medium", () => {
    expect(classifyRisk({ prompt: "Add an API endpoint", affectedFiles: [] }).level).toBe("medium");
    expect(classifyRisk({ prompt: "Extend the database schema", affectedFiles: [] }).level).toBe("medium");
  });

  it("classifies pure UI changes as low", () => {
    expect(classifyRisk({ prompt: "Update the landing page component styles", affectedFiles: ["src/components/Landing.tsx"] }).level).toBe("low");
  });

  it("never decides critical by itself — affected files join the prompt", () => {
    expect(classifyRisk({ prompt: "Make the header nicer", affectedFiles: ["src/security.ts"] }).level).toBe("critical");
  });

  it("returns a label and is fully deterministic", () => {
    const a = classifyRisk({ prompt: "Add an API endpoint", affectedFiles: [] });
    const b = classifyRisk({ prompt: "Add an API endpoint", affectedFiles: [] });
    expect(a).toEqual(b);
    expect(b.reasons.length).toBeGreaterThan(0);
    expect(riskLevelLabel("critical")).toBe("Critical");
  });
});