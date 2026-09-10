import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { assertCwdInsideWorkspace } from "../src/workspace";
import { ForbiddenError, ValidationError } from "../../src/server/errors";

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-ws-"));
  tempRoots.push(root);
  return root;
}

function junctionSupported(): boolean {
  if (process.platform !== "win32") {
    try {
      const a = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-junction-probe-"));
      fs.symlinkSync(a, path.join(a, "link"), "dir");
      return true;
    } catch {
      return false;
    }
  }
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-junction-probe-"));
    fs.symlinkSync(path.join(root, "real"), path.join(root, "link"), "junction");
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("assertCwdInsideWorkspace", () => {
  it("accepts the workspace root itself and subdirectories", () => {
    const root = makeWorkspace();
    const sub = path.join(root, "some", "project");
    fs.mkdirSync(sub, { recursive: true });
    expect(assertCwdInsideWorkspace(root, ".")).toBe(root);
    expect(assertCwdInsideWorkspace(root, root)).toBe(root);
    expect(assertCwdInsideWorkspace(root, sub)).toBe(sub);
  });

  it("rejects paths that escape the workspace", () => {
    const root = makeWorkspace();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-outside-"));
    tempRoots.push(outside);
    expect(() => assertCwdInsideWorkspace(root, path.join(root, "..", "x"))).toThrow(ForbiddenError);
    expect(() => assertCwdInsideWorkspace(root, outside)).toThrow(ForbiddenError);
    expect(() => assertCwdInsideWorkspace(root, path.resolve(root, ".."))).toThrow(ForbiddenError);
  });

  it("rejects relative traversal tricks", () => {
    const root = makeWorkspace();
    expect(() => assertCwdInsideWorkspace(root, "..\\..\\etc")).toThrow(ForbiddenError);
    expect(() => assertCwdInsideWorkspace(root, "../../etc")).toThrow(ForbiddenError);
  });

  it("requires the directory to exist", () => {
    const root = makeWorkspace();
    expect(() => assertCwdInsideWorkspace(root, path.join(root, "does-not-exist"))).toThrow(ValidationError);
  });

  it("rejects protected paths even inside the workspace", () => {
    const root = makeWorkspace();
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, ".ssh"), { recursive: true });
    fs.writeFileSync(path.join(root, ".env"), "X=1");
    expect(() => assertCwdInsideWorkspace(root, path.join(root, ".git"))).toThrow(ForbiddenError);
    expect(() => assertCwdInsideWorkspace(root, path.join(root, ".ssh"))).toThrow(ForbiddenError);
    expect(() => assertCwdInsideWorkspace(root, path.join(root, ".env"))).toThrow(ForbiddenError);
  });

  it.skipIf(!junctionSupported())(
    "rejects a cwd that escapes through a junction/symlink",
    () => {
      if (process.platform !== "win32") return;
      const root = makeWorkspace();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-junction-out-"));
      tempRoots.push(outside);
      fs.mkdirSync(path.join(outside, "sub"), { recursive: true });
      const link = path.join(root, "evil-link");
      fs.symlinkSync(outside, link, "junction");
      expect(() => assertCwdInsideWorkspace(root, link)).toThrow(ForbiddenError);
      expect(() => assertCwdInsideWorkspace(root, path.join(link, "sub"))).toThrow(ForbiddenError);
    }
  );
});