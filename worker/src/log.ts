/**
 * Safe, dependency-free structured logger.
 *
 * Never logs tokens, arguments, output, working directories, or environment
 * contents. Only pre-approved, low-cardinality fields are emitted.
 */

export type LogField = string | number | boolean | null | undefined;

export type LogFields = Record<string, LogField>;

function emit(stream: NodeJS.WriteStream, event: string, level: string, fields: LogFields): void {
  stream.write(`${JSON.stringify({ ts: Date.now(), service: "cloud-execution-worker", level, event, ...fields })}\n`);
}

export function log(event: string, fields: LogFields = {}): void {
  emit(process.stdout, event, "info", fields);
}

export function logWarn(event: string, fields: LogFields = {}): void {
  emit(process.stdout, event, "warn", fields);
}

export function logError(event: string, fields: LogFields = {}): void {
  emit(process.stderr, event, "error", fields);
}