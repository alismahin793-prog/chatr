import { fileURLToPath, URL as NodeURL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Worker tests exercise shared app providers (e.g. RemoteExecutionProvider)
      // whose imports use the "@/" alias; the worker runtime itself stays alias-free.
      "@": fileURLToPath(new NodeURL("../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["worker/tests/**/*.test.ts"],
    pool: "forks",
    testTimeout: 30000,
    hookTimeout: 30000,
    css: false,
  },
});