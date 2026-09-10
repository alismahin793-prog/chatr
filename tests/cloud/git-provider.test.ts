import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { LocalGitProvider, assertBranchName } from "@/server/cloud/git/providers";
import { ForbiddenError, ValidationError } from "@/server/errors";

/**
 * Real git repository tests against a throwaway repo: commits, branches,
 * log/status/diff, and — critically — the dirty-worktree refusal that keeps
 * snapshot rollback from ever eating uncommitted work.
 */
describe("LocalGitProvider", () => {
  const provider = new LocalGitProvider();
  let tmp: string;
  let repo: string;

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-git-"));
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git("init", "-b", "main");
    git("config", "user.name", "Cloud Test");
    git("config", "user.email", "cloud-test@chatr.local");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function commitFile(rel: string, content: string, message: string): Promise<string> {
    fs.writeFileSync(path.join(repo, rel), content);
    git("add", ".");
    const result = await provider.commit(repo, message);
    return result.ref;
  }

  it("recognizes a git repository", async () => {
    expect(await provider.isGitRepo(repo)).toBe(true);
  });

  it("reports non-repos with a validation error", async () => {
    const empty = path.join(tmp, "not-a-repo");
    fs.mkdirSync(empty);
    await expect(provider.status(empty)).rejects.toThrow(ValidationError);
    expect(await provider.isGitRepo(empty)).toBe(false);
  });

  it("commits files and reads clean status + log", async () => {
    const ref = await commitFile("README.md", "# hi\n", "initial");
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
    const status = await provider.status(repo);
    expect(status.clean).toBe(true);
    expect(status.branch).toBe("main");
    const log = await provider.log(repo);
    expect(log).toHaveLength(1);
    expect(log[0].ref).toBe(ref);
    expect(log[0].subject).toBe("initial");
    expect(log[0].short).toMatch(/^[0-9a-f]{7}$/);
  });

  it("branches and switches branches cleanly", async () => {
    await commitFile("base.txt", "base\n", "initial");
    let status = await provider.createBranch(repo, "feature/x");
    expect(status.branch).toBe("feature/x");
    await commitFile("feature.txt", "feature\n", "feature work");
    status = await provider.checkout(repo, "main");
    expect(status.branch).toBe("main");
    const branches = await provider.branches(repo);
    const main = branches.find((b) => b.name === "main");
    expect(main?.current).toBe(true);
  });

  it("refuses to switch branches on a dirty tree (snapshot safety)", async () => {
    await commitFile("base.txt", "base\n", "initial");
    await provider.createBranch(repo, "dev");
    await provider.checkout(repo, "main");
    fs.writeFileSync(path.join(repo, "uncommitted.txt"), "work in progress\n");
    await expect(provider.checkout(repo, "dev")).rejects.toThrow(ForbiddenError);
    await expect(provider.createBranch(repo, "other")).rejects.toThrow(ForbiddenError);
  });

  it("shows dirty status and a diff", async () => {
    await commitFile("base.txt", "one\n", "initial");
    fs.writeFileSync(path.join(repo, "base.txt"), "two\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "n\n");
    const status = await provider.status(repo);
    expect(status.clean).toBe(false);
    expect(status.files.map((f) => f.path)).toEqual(expect.arrayContaining(["base.txt", "new.txt"]));
    const diff = await provider.diff(repo, "base.txt");
    expect(diff).toContain("base.txt");
    expect(diff).toContain("+two");
  });

  it("reports missing upstream instead of throwing on push/pull", async () => {
    await commitFile("base.txt", "base\n", "initial");
    const pull = await provider.pull(repo);
    expect(pull.ok).toBe(false);
    const push = await provider.push(repo);
    expect(push.ok).toBe(false);
    expect(push.message).toBeTruthy();
  });

  it("validates branch names", () => {
    expect(() => assertBranchName("")).toThrow(ValidationError);
    expect(() => assertBranchName("-nope")).toThrow(ForbiddenError);
    expect(() => assertBranchName("feature/ok_2.x")).not.toThrow();
    expect(() => assertBranchName("./evil")).toThrow(ForbiddenError);
  });
});