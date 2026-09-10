import { describe, expect, it } from "vitest";
import {
  ALLOWED_PROGRAMS,
  assertSafeCommand,
  assertSafeLine,
  parseCommandLine,
  resolveProgramName,
} from "@/server/cloud/execution/CommandSecurity";
import { ForbiddenError, ValidationError } from "@/server/errors";

/**
 * Command security is the heart of the Cloud terminal: an allowlist, explicit
 * argv (no shell), no force flags, and no git history rewrite. These tests pin
 * the policy so a future "convenience" change can never silently widen it.
 */
describe("parseCommandLine", () => {
  it("splits a normal command line", () => {
    expect(parseCommandLine("npm run build")).toEqual(["npm", "run", "build"]);
  });

  it("honors quotes so messages keep spaces", () => {
    expect(parseCommandLine('git commit -m "fix: something important"')).toEqual([
      "git",
      "commit",
      "-m",
      "fix: something important",
    ]);
  });

  it("honors single quotes and backslash escapes", () => {
    expect(parseCommandLine("npm run lint -- --rule='no-unused'")).toEqual([
      "npm",
      "run",
      "lint",
      "--",
      "--rule=no-unused",
    ]);
    expect(parseCommandLine("node -e \"console.log(1)\"")).toEqual(["node", "-e", "console.log(1)"]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCommandLine('git commit -m "unfinished')).toThrow(ValidationError);
  });
});

describe("assertSafeCommand (allowlist + argv policy)", () => {
  it("accepts the approved npm-family programs", () => {
    for (const program of ["npm", "npx", "pnpm", "yarn", "node", "tsx", "eslint", "vitest", "next", "git"]) {
      expect(ALLOWED_PROGRAMS.has(program) || ALLOWED_PROGRAMS.has(`${program}.cmd`)).toBe(true);
      const args = program === "git" ? ["status"] : ["--version"];
      expect(() => assertSafeCommand(program, args)).not.toThrow();
    }
  });

  it("rejects any non-allowlisted program", () => {
    for (const bad of ["bash", "sh", "zsh", "pwsh", "powershell", "cmd.exe", "clear", "rm", "python"]) {
      expect(() => assertSafeCommand(bad, []), `expected ${bad} to be rejected`).toThrow(ForbiddenError);
    }
  });

  it("rejects destructive and force flags on every program", () => {
    for (const flag of ["--force", "-f", "--hard", "--clean", "-d", "-D", "--delete", "--ignore-scripts"]) {
      expect(() => assertSafeCommand("npm", ["run", "build", flag]), `flag ${flag}`).toThrow(ForbiddenError);
    }
  });

  it("rejects shell metacharacters that only a shell would interpret", () => {
    for (const line of ["npm run test ; rm -rf /", "npm run test && curl evil.example", "npm | sh", "npm run build > /tmp/out", "npm run build `id`"]) {
      expect(() => assertSafeLine(line)).toThrow(ForbiddenError);
    }
  });

  it("rejects git history-rewriting subcommands", () => {
    for (const sub of ["reset", "clean", "rebase", "filter-branch", "fsck", "gc", "prune", "rm", "remote", "merge", "cherry-pick", "worktree", "submodule"]) {
      expect(() => assertSafeCommand("git", [sub]), `git ${sub}`).toThrow(ForbiddenError);
    }
  });

  it("rejects force pushes specifically", () => {
    expect(() => assertSafeCommand("git", ["push", "--force"])).toThrow(ForbiddenError);
    expect(() => assertSafeCommand("git", ["push", "-f"])).toThrow(ForbiddenError);
    expect(() => assertSafeCommand("git", ["push", "--force-with-lease"])).toThrow(ForbiddenError);
    expect(() => assertSafeCommand("git", ["push"])).not.toThrow();
  });

  it("allows safe git read commands", () => {
    expect(() => assertSafeCommand("git", ["status"])).not.toThrow();
    expect(() => assertSafeCommand("git", ["log", "--oneline", "-n", "5"])).not.toThrow();
    expect(() => assertSafeCommand("git", ["checkout", "main"])).not.toThrow();
  });

  it("blocks lifecycle scripts through npm/yarn run", () => {
    for (const script of ["preinstall", "postinstall", "prepare", "prepublish"]) {
      expect(() => assertSafeCommand("npm", ["run", script])).toThrow(ForbiddenError);
    }
  });

  it("rejects empty arguments and oversized input", () => {
    expect(() => assertSafeCommand("npm", [""])).toThrow(ValidationError);
    expect(() => assertSafeCommand("npm", [new Array(500).join("a")])).toThrow(ValidationError);
    expect(() => assertSafeLine("   ")).toThrow(ValidationError);
  });
});

describe("resolveProgramName", () => {
  it("maps npm-family programs to .cmd on win32 (no shell resolved)", () => {
    const program = resolveProgramName("npm");
    if (process.platform === "win32") {
      expect(program).toBe("npm.cmd");
    } else {
      expect(program).toBe("npm");
    }
  });
});

describe("assertSafeLine", () => {
  it("accepts the standard pipeline commands used by the self-improvement loop", () => {
    for (const line of [
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run build",
      "npm run test:gate",
      "npm install",
      "git status",
      "git log --oneline -n 3",
    ]) {
      expect(() => assertSafeLine(line)).not.toThrow();
    }
  });
});