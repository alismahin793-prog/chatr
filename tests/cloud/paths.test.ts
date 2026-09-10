import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  assertInsideWorkspace,
  containsSecretContent,
  isSensitivePath,
  projectWorkspaceDir,
  redactSecretContent,
} from "@/server/cloud/paths";
import { ForbiddenError, ValidationError } from "@/server/errors";

const ROOT = path.join(os.tmpdir(), "chatr-ws-test-proj");

describe("assertInsideWorkspace (path confinement)", () => {
  it("accepts the root and nested files", () => {
    expect(assertInsideWorkspace(ROOT, ".")).toBe(path.resolve(ROOT, "."));
    expect(assertInsideWorkspace(ROOT, "")).toBe(path.resolve(ROOT, "."));
    expect(assertInsideWorkspace(ROOT, "src/index.ts")).toBe(path.join(ROOT, "src", "index.ts"));
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    expect(assertInsideWorkspace(ROOT, "src\\index.ts")).toBe(path.join(ROOT, "src", "index.ts"));
  });

  it("rejects traversal escape attempts", () => {
    for (const bad of ["../outside", "../../../etc/passwd", "src/../../outside"]) {
      expect(() => assertInsideWorkspace(ROOT, bad), bad).toThrow(ForbiddenError);
    }
  });

  it("neutralizes absolute paths to workspace-relative (never host-absolute)", () => {
    // A leading "/" is split into empty segments, so "/etc/passwd" collapses
    // to ROOT/etc/passwd. The point is the result stays inside the workspace.
    expect(assertInsideWorkspace(ROOT, "/etc/passwd")).toBe(path.join(ROOT, "etc", "passwd"));
  });

  it("never lets an adversarial path resolve outside the workspace", () => {
    const adversarial = [
      "C:/Windows/system32",
      "C:Windows\\system32",
      "//server/share",
      "..\\..\\..\\Windows",
      "%2e%2e/config",
      "subdir/..\\..\\esc",
    ];
    for (const bad of adversarial) {
      let abs: string | undefined;
      let threw = false;
      try {
        abs = assertInsideWorkspace(ROOT, bad);
      } catch {
        threw = true;
      }
      expect(threw || abs !== undefined, bad).toBe(true);
      if (abs !== undefined) {
        const rel = path.relative(ROOT, abs);
        expect(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)), bad).toBe(true);
      }
    }
  });

  it("rejects non-string or oversized paths", () => {
    expect(() => assertInsideWorkspace(ROOT, "x".repeat(1100))).toThrow(ValidationError);
  });
});

describe("isSensitivePath (never served or written)", () => {
  it("flags credential/source-control files", () => {
    for (const p of [
      ".env",
      ".env.local",
      ".env.production",
      "config/.env",
      ".npmrc",
      ".git/config",
      "src/.git/config",
      ".ssh/authorized_keys",
      "keys/id_rsa",
      "keys/id_ed25519.pub",
      "certs/server.pem",
      ".vercel/project.json",
    ]) {
      expect(isSensitivePath(p), p).toBe(true);
    }
  });

  it("passes normal source files", () => {
    for (const p of ["src/index.ts", "package.json", "README.md", "src/.environment.ts", "public/favicon.ico"]) {
      expect(isSensitivePath(p), p).toBe(false);
    }
  });
});

describe("containsSecretContent", () => {
  it("detects credential-looking blobs", () => {
    expect(containsSecretContent("access key AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(containsSecretContent("token=ghp_1234567890abcdefghij")).toBe(true);
    expect(containsSecretContent("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
  });

  it("passes innocuous output", () => {
    expect(containsSecretContent("build finished in 12s")).toBe(false);
    expect(containsSecretContent("wrote 42 files")).toBe(false);
  });
});

describe("redactSecretContent", () => {
  it("masks every known credential pattern", () => {
    expect(redactSecretContent("aws key AKIAIOSFODNN7EXAMPLE here")).not.toContain(
      "AKIAIOSFODNN7EXAMPLE"
    );
    expect(redactSecretContent("token=ghp_1234567890abcdefghij")).toContain("[REDACTED]");
    expect(
      redactSecretContent("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----")
    ).toContain("[REDACTED]");
    expect(redactSecretContent("export API_KEY=supersecretvalue123")).toContain("[REDACTED]");
    expect(redactSecretContent("password: hunter12secret!!")).not.toContain("hunter12secret");
  });

  it("keeps innocuous text unchanged", () => {
    const text = "build finished in 12s, 42 files";
    expect(redactSecretContent(text)).toBe(text);
  });

  it("never leaves a known pattern intact anywhere (multi-line logs)", () => {
    const log = [
      "npm warn deprecated x@1.0",
      "vercel token: XXXX_VERCELTOKEN123456",
      "done",
    ].join("\n");
    const redacted = redactSecretContent(log);
    expect(redacted).not.toMatch(/[0-9A-Za-z_\-.]{12,}/);
  });
});

describe("projectWorkspaceDir", () => {
  it("validates the project identifier before touching disk", () => {
    expect(() => projectWorkspaceDir("nope")).toThrow(ValidationError);
    expect(() => projectWorkspaceDir("../../etc")).toThrow(ValidationError);
    expect(() => projectWorkspaceDir("PROJECT")).toThrow(ValidationError);
  });
});