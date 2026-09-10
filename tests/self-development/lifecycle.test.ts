import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isTerminal } from "@/server/self-development/lifecycle";
import { ConflictError } from "@/server/errors";
import type { SelfDevelopmentRequestStatus } from "@/lib/supabase/database.types";

describe("self-development lifecycle transitions", () => {
  it("allows the supervised happy path", () => {
    const happy: Array<[SelfDevelopmentRequestStatus, SelfDevelopmentRequestStatus]> = [
      ["draft", "planning"],
      ["planning", "awaiting_plan_approval"],
      ["awaiting_plan_approval", "snapshotting"],
      ["snapshotting", "workspace_preparing"],
      ["workspace_preparing", "analyzing"],
      ["analyzing", "modifying"],
      ["modifying", "testing"],
      ["testing", "typechecking"],
      ["typechecking", "linting"],
      ["linting", "building"],
      ["building", "reviewing"],
      ["reviewing", "awaiting_deploy_approval"],
      ["awaiting_deploy_approval", "deploying"],
      ["deploying", "verifying"],
      ["verifying", "completed"],
    ];
    for (const [from, to] of happy) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("allows plan rejection and cancellation from every active state", () => {
    expect(canTransition("awaiting_plan_approval", "rejected")).toBe(true);
    const active: SelfDevelopmentRequestStatus[] = [
      "planning",
      "awaiting_plan_approval",
      "snapshotting",
      "workspace_preparing",
      "analyzing",
      "modifying",
      "testing",
      "typechecking",
      "linting",
      "building",
      "reviewing",
      "awaiting_deploy_approval",
      "deploying",
      "verifying",
    ];
    for (const state of active) {
      expect(canTransition(state, "cancelled"), state).toBe(true);
    }
  });

  it("allows rollback only after a deploy completed or a failed attempt", () => {
    const rollbackable: SelfDevelopmentRequestStatus[] = ["completed", "failed"];
    for (const from of rollbackable) {
      expect(canTransition(from, "rolled_back"), from).toBe(true);
    }
    expect(canTransition("awaiting_deploy_approval", "rolled_back")).toBe(false);
    expect(canTransition("verifying", "rolled_back")).toBe(false);
  });

  it("refuses to skip gates", () => {
    expect(canTransition("draft", "awaiting_plan_approval")).toBe(false);
    expect(canTransition("draft", "modifying")).toBe(false);
    expect(canTransition("awaiting_plan_approval", "reviewing")).toBe(false);
    expect(canTransition("completed", "reviewing")).toBe(false);
  });

  it("is terminal only for finished states", () => {
    const finished: SelfDevelopmentRequestStatus[] = ["completed", "failed", "rolled_back", "cancelled", "rejected"];
    for (const done of finished) {
      expect(isTerminal(done), done).toBe(true);
    }
    expect(isTerminal("draft")).toBe(false);
    expect(isTerminal("verifying")).toBe(false);
  });

  it("throws a ConflictError for disallowed transitions", () => {
    expect(() => assertTransition("draft", "deploying")).toThrow(ConflictError);
    expect(() => assertTransition("completed", "completed")).toThrow(ConflictError);
  });
});