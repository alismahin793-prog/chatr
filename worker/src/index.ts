import fs from "node:fs";
import { loadConfig } from "./config";
import { log, logError } from "./log";
import { WorkerHandle } from "./server";

const SHUTDOWN_GRACE_MS = 8_000;

/**
 * Cloud Execution worker entry point.
 *
 * Fail-fast on missing configuration, then listen on the configured host/port.
 * SIGTERM/SIGINT trigger a graceful shutdown: new connections stop being
 * accepted, active children are terminated, and the process exits after a
 * bounded grace period.
 */
function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    logError("config_error", { error: (err as Error).message });
    process.exit(1);
  }

  try {
    fs.mkdirSync(config.workspaceRoot, { recursive: true });
  } catch (err) {
    logError("workspace_root_error", { error: (err as Error).message });
    process.exit(1);
  }

  const handle = new WorkerHandle(config);
  handle.server.on("error", (err: Error) => {
    logError("server_error", { error: err.message });
    process.exit(1);
  });

  handle.server.listen(config.port, config.host, () => {
    const addr = handle.server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : config.port;
    log("ready", { host: config.host, port });
  });

  let shuttingDown = false;
  const onSignal = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutdown", { signal });
    handle.shutdown();
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

void main();