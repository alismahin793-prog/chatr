import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { ForbiddenError, ValidationError } from "@/server/errors";

/**
 * Real filesystem tests for the workspace provider: confinement, sensitive
 * path refusal, binary/size guards, and read-write round trips. Each test
 * gets its own temp root and is cleaned up afterwards.
 */
describe("LocalWorkspaceProvider", () => {
  const provider = new LocalWorkspaceProvider();
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-ws-"));
    root = path.join(tmp, "ws");
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and reads a file round-trip", async () => {
    await provider.writeFile(root, "src/app.ts", "export const x = 1;\n");
    const file = await provider.readFile(root, "src/app.ts");
    expect(file.content).toBe("export const x = 1;\n");
    expect(file.size).toBe(Buffer.byteLength("export const x = 1;\n"));
  });

  it("creates intermediate directories on write", async () => {
    await provider.writeFile(root, "a/b/c.txt", "hello");
    expect(fs.existsSync(path.join(root, "a", "b", "c.txt"))).toBe(true);
  });

  it("lists directories with files and folders", async () => {
    await provider.writeFile(root, "src/a.ts", "");
    await provider.writeFile(root, "src/b.ts", "");
    await provider.createDir(root, "public");
    const entries = await provider.listDir(root, ".");
    const names = entries.map((e) => e.path);
    expect(names).toContain("src");
    expect(names).toContain("public");
  });

  it("renames paths", async () => {
    await provider.writeFile(root, "old.txt", "x");
    await provider.renamePath(root, "old.txt", "new.txt");
    const file = await provider.readFile(root, "new.txt");
    expect(file.content).toBe("x");
  });

  it("deletes files and directories (recursive)", async () => {
    await provider.writeFile(root, "keep.txt", "k");
    await provider.writeFile(root, "dir/deep/f.txt", "d");
    await expect(provider.deletePath(root, "dir")).rejects.toThrow(ValidationError); // not empty, no recursive
    await provider.deletePath(root, "dir", { recursive: true });
    const entries = await provider.listDir(root, ".");
    expect(entries.map((e) => e.path)).toEqual(["keep.txt"]);
  });

  it("refuses to read a sensitive file", async () => {
    await provider.writeFile(root, "not-used", "");
    // .env is written via fs directly because the provider refuses to write it.
    fs.writeFileSync(path.join(root, ".env"), "SUPABASE_SERVICE_ROLE=xxx");
    await expect(provider.readFile(root, ".env")).rejects.toThrow(ForbiddenError);
  });

  it("refuses to write to a sensitive path (even nonexistent)", async () => {
    await expect(provider.writeFile(root, ".env", "x=1")).rejects.toThrow(ForbiddenError);
    await expect(provider.writeFile(root, ".ssh/config", "x")).rejects.toThrow(ForbiddenError);
    await expect(provider.writeFile(root, "certs/ca.pem", "x")).rejects.toThrow(ForbiddenError);
    await expect(provider.renamePath(root, "a", ".npmrc")).rejects.toThrow(ForbiddenError);
  });

  it("rejects path traversal outright", async () => {
    await expect(provider.readFile(root, "../../outside.txt")).rejects.toThrow();
    await expect(provider.writeFile(root, "../../outside.txt", "x")).rejects.toThrow();
  });

  it("refuses binary files in the editor", async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    fs.writeFileSync(path.join(root, "img.png"), buf);
    await expect(provider.readFile(root, "img.png")).rejects.toThrow(ValidationError);
  });

  it("rejects oversized file writes", async () => {
    const big = "x".repeat(1_000_001);
    await expect(provider.writeFile(root, "big.txt", big)).rejects.toThrow(ValidationError);
  });

  it("searches names within the workspace only", async () => {
    await provider.writeFile(root, "README.md", "");
    await provider.writeFile(root, "src/readme-note.txt", "");
    const results = await provider.search(root, "readme");
    const names = results.map((r) => r.path.toLowerCase());
    expect(names).toContain("readme.md");
    expect(names).toContain("src/readme-note.txt");
    expect(results.every((r) => !r.path.startsWith("../"))).toBe(true);
  });

  it("status reports configured on a normal host", () => {
    const status = provider.status();
    expect(status.configured).toBe(true);
    expect(status.id).toBe("local-workspace");
  });
});