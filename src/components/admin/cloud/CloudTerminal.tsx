"use client";

import { useEffect, useRef, useState } from "react";
import { cloudApi, type CloudOperation } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudTerminalProps {
  projectId: string;
  initialOperations: CloudOperation[];
}

interface OutLine {
  seq: number;
  kind: "stdout" | "stderr" | "system";
  text: string;
}

const QUICK_COMMANDS = [
  "npm run test:gate",
  "npm run typecheck",
  "npm run lint",
  "npm test",
  "npm run build",
  "git status",
];

/**
 * Live terminal for a cloud project. Commands are validated server-side
 * (allowlisted programs, no shell), executed by the REAL execution provider,
 * and the output is streamed over SSE. Nothing is simulated — if the provider
 * is not configured, this terminal says so.
 */
export default function CloudTerminal({ projectId, initialOperations }: CloudTerminalProps) {
  const { t } = useAdminI18n();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [lines, setLines] = useState<OutLine[]>([
    { seq: 0, kind: "system", text: t("cloud.terminal.ready") },
  ]);
  const [status, setStatus] = useState<"idle" | "running">("idle");
  const [exit, setExit] = useState<{ code: number | null; state: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operations, setOperations] = useState<CloudOperation[]>(initialOperations);
  const esRef = useRef<EventSource | null>(null);
  const lastSeqRef = useRef(0);
  const systemSeqRef = useRef(10 ** 8);
  const startedAtRef = useRef<number | null>(null);
  const outRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [lines, status]);

  function append(seq: number, kind: OutLine["kind"], text: string) {
    if (seq <= lastSeqRef.current && kind !== "system") return;
    lastSeqRef.current = seq;
    setLines((prev) => [...prev, { seq, kind, text }]);
  }

  function openStream(operationId: string) {
    esRef.current?.close();
    const es = new EventSource(`/api/admin/cloud/execute/operations/${operationId}/stream`);
    esRef.current = es;
    lastSeqRef.current = 0;

    es.addEventListener("process", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { state: string; startedAt: number };
      startedAtRef.current = data.startedAt;
      setStatus("running");
      setExit(null);
    });
    es.addEventListener("output", (e) => {
      const chunks = JSON.parse((e as MessageEvent).data) as { seq: number; kind: "stdout" | "stderr"; text: string }[];
      for (const chunk of chunks) append(chunk.seq, chunk.kind, chunk.text);
    });
    es.addEventListener("end", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { state: string; exitCode: number | null };
      setStatus("idle");
      setExit({ code: data.exitCode, state: data.state });
      es.close();
      esRef.current = null;
      void refreshOperations();
    });
    es.addEventListener("error", () => {
      // The browser fires this on connection loss too; only close when the
      // stream truly ended (handled above). Do nothing here to allow
      // EventSource auto-reconnect.
    });
  }

  async function refreshOperations() {
    try {
      const { operations: list } = await cloudApi.operations(projectId);
      setOperations(list);
    } catch {
      // non-fatal
    }
  }

  async function runCommand(command: string) {
    const trimmed = command.trim();
    if (!trimmed || status === "running") return;
    setError(null);
    append(systemSeqRef.current++, "system", `$ ${trimmed}`);
    setHistory((h) => [trimmed, ...h].slice(0, 50));
    try {
      const { operationId, process } = await cloudApi.execute(projectId, trimmed);
      setNotice(null);
      void refreshOperations();
      if (process.state === "error") {
        setExit({ code: null, state: "error" });
      } else {
        openStream(operationId);
      }
    } catch (err) {
      setStatus("idle");
      append(systemSeqRef.current++, "system", `! ${err instanceof Error ? err.message : t("cloud.terminal.commandStartFailed")}`);
    }
  }

  async function cancelRun() {
    const op = operations.find((o) => o.status === "running");
    if (!esRef.current && !op) return;
    try {
      if (op) await cloudApi.cancel(op.id);
      esRef.current?.close();
      esRef.current = null;
      setStatus("idle");
      setExit({ code: null, state: "cancelled" });
      append(systemSeqRef.current++, "system", `! ${t("cloud.terminal.cancelledByOperator")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.terminal.cancelFailed"));
    }
  }

  const runningOperation = operations.find((o) => o.status === "running");

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("cloud.terminal.quickCommands")}</span>
          {QUICK_COMMANDS.map((command) => (
            <button
              key={command}
              onClick={() => void runCommand(command)}
              disabled={status === "running"}
              className="rounded-md border border-slate-200 px-2 py-1 font-mono text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
            >
              {command}
            </button>
          ))}
        </div>
      </section>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1220] shadow-inner">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500/80" />
              <span className="size-2.5 rounded-full bg-amber-400/80" />
              <span className="size-2.5 rounded-full bg-emerald-500/80" />
            </span>
            <span className="ms-2 font-mono text-xs text-slate-400">{projectId.slice(0, 8)} · {t("cloud.terminal.workspace")}</span>
            {runningOperation ? (
              <span className="ms-2"><CloudBadge status="running" /></span>
            ) : null}
          </div>
          <button
            onClick={() => void cancelRun()}
            disabled={status !== "running" && !runningOperation}
            className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-30"
          >
            {t("common.cancel")}
          </button>
        </div>

        <div ref={outRef} className="h-[460px] overflow-y-auto p-3 font-mono text-[13px] leading-relaxed">
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.kind === "stderr"
                  ? "whitespace-pre-wrap text-red-300"
                  : line.kind === "system"
                    ? "whitespace-pre-wrap font-semibold text-slate-400"
                    : "whitespace-pre-wrap text-slate-100"
              }
            >
              {line.text.endsWith("\n") ? line.text : `${line.text}\n`}
            </div>
          ))}
          {status === "running" ? (
            <span className="inline-block text-emerald-400">
              <span className="animate-pulse">▍</span>
            </span>
          ) : null}
          {exit ? (
            <div className="mt-1 text-xs text-slate-500">
              {exit.code !== null
                ? t("cloud.terminal.exitedWithCode", { code: String(exit.code) })
                : t("cloud.terminal.exitedTo", { state: exit.state })}
            </div>
          ) : null}
        </div>

        <div className="border-t border-white/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-emerald-400">$</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const value = input;
                  setInput("");
                  void runCommand(value);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const next = Math.min(historyIndex + 1, history.length - 1);
                  setHistoryIndex(next);
                  if (history[next] !== undefined) setInput(history[next]);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = Math.max(historyIndex - 1, -1);
                  setHistoryIndex(next);
                  setInput(next === -1 ? "" : history[next] ?? "");
                }
              }}
              disabled={status === "running"}
              placeholder={t("cloud.terminal.tryHint")}
              spellCheck={false}
              autoComplete="off"
              className="flex-1 bg-transparent font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-40"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-600">{t("cloud.terminal.allowlistNote")}</p>
        </div>
      </div>

      {/* Recent operations */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{t("cloud.terminal.recentOperations")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{t("common.status")}</th>
                <th className="px-4 py-2 font-medium">{t("cloud.terminal.command")}</th>
                <th className="px-4 py-2 font-medium">{t("cloud.terminal.exit")}</th>
                <th className="px-4 py-2 font-medium">{t("cloud.terminal.duration")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {operations.slice(0, 10).map((op) => (
                <tr key={op.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2"><CloudBadge status={op.status} /></td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">
                    {op.program.replace(/\.(cmd|exe)$/i, " ")} {op.args.join(" ")}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-500">{op.exit_code ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">
                    {op.duration_ms != null ? `${Math.round(op.duration_ms / 1000)}s` : "—"}
                  </td>
                </tr>
              ))}
              {operations.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-4 text-sm text-slate-400">{t("cloud.terminal.noOperations")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}