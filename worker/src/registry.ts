import { ConflictError } from "../../src/server/errors";
import { cancelRun, type RunRecord } from "./run";

/**
 * In-memory bounded registry of active runs.
 *
 * Only running processes are tracked. A run is deleted as soon as its terminal
 * snapshot is produced, so memory stays bounded by maxConcurrent. No
 * persistence is needed: the provider contract never discovers a finished
 * remote operation after the fact (poll/list are not supported remotely).
 */
export class Registry {
  private readonly records = new Map<string, RunRecord>();

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.records.size;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): RunRecord | undefined {
    return this.records.get(id);
  }

  put(record: RunRecord): void {
    if (this.records.has(record.id)) {
      throw new ConflictError('Operation "' + record.id + '" is already running.');
    }
    this.records.set(record.id, record);
  }

  delete(id: string): void {
    this.records.delete(id);
  }

  /** Terminates every active run during graceful shutdown. */
  cancelAll(): void {
    for (const record of [...this.records.values()]) {
      cancelRun(record);
    }
  }
}