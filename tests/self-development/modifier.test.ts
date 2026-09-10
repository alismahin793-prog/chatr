import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { LocalWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { CodeModificationProvider } from "@/server/self-development/modifier";

const workspace = new LocalWorkspaceProvider();
const modifier = new CodeModificationProvider(workspace);

async function seededRoot(): Promise<string> {
  const root = workspace.resolveRoot(randomUUID());
  await workspace.writeFile(root, "src/hello.ts", "export const greeting = 'hi';\n");
  await workspace.writeFile(root, "package.json", "{}\n");
  return root;
}

describe("CodeModificationProvider.apply", () => {
  it("applies create + edit and records redacted diffs + hashes", async () => {
    const root = await seededRoot();
    const result = await modifier.apply(root, [
      { op: "create", path: "src/new.ts", content: "export const two = 2;\n" },
      { op: "edit", path: "src/hello.ts", content: "export const greeting = 'hello';\n" },
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.applied).toHaveLength(2);

    const created = result.applied[0];
    expect(created.operation).toBe("create");
    expect(created.afterSha256).toBeTruthy();
    expect(created.diff).toContain("--- a/src/new.ts");

    const edited = result.applied[1];
    expect(edited.operation).toBe("edit");
    expect(edited.beforeSha256).toBeTruthy();
    expect(edited.afterSha256).toBeTruthy();
    expect(created.diff).toContain("+export const two");

    const onDisk = await workspace.readFile(root, "src/new.ts");
    expect(onDisk.content).toBe("export const two = 2;\n");
  });

  it("never applies sensitive paths — they become skips", async () => {
    const root = await seededRoot();
    const result = await modifier.apply(root, [
      { op: "edit", path: ".env", content: "API_KEY=super-secret-value-123456\n" },
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0].file).toBe(".env");
    expect(result.skipped[0].reason.toLowerCase()).toContain("sensitive");
  });

  it("redacts secret-looking content before persisting the diff", async () => {
    const root = await seededRoot();
    const result = await modifier.apply(root, [
      {
        op: "edit",
        path: "src/hello.ts",
        content: "const token = 'sk-abcdefghijklmnop';\n",
      },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].diff).not.toContain("sk-abcdefghijklmnop");
    expect(result.applied[0].diff).toContain("[REDACTED]");
  });

  it("supports rename and delete", async () => {
    const root = await seededRoot();
    const renamed = await modifier.apply(root, [{ op: "rename", from: "src/hello.ts", to: "src/world.ts" }]);
    expect(renamed.applied[0].operation).toBe("rename");
    expect(renamed.applied[0].pathFrom).toBe("src/hello.ts");
    expect(renamed.applied[0].pathTo).toBe("src/world.ts");

    const deleted = await modifier.apply(root, [{ op: "delete", path: "src/world.ts" }]);
    expect(deleted.applied[0].operation).toBe("delete");
    await expect(workspace.readFile(root, "src/world.ts")).rejects.toThrow();
  });
});

describe("CodeModificationProvider.readContextFiles", () => {
  it("returns scoped content, skipping sensitive and unreadable paths", async () => {
    const root = await seededRoot();
    const snippets = await modifier.readContextFiles(root, ["src/hello.ts", ".env", "missing.ts", "package.json"]);
    expect(snippets.map((s) => s.path).sort()).toEqual(["package.json", "src/hello.ts"]);
  });
});