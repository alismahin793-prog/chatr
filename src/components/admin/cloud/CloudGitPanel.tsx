"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import { cloudApi, type GitBranchEntry, type GitLogEntry, type GitStatusData } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudGitPanelProps {
  projectId: string;
}

/**
 * Git panel: status/diff/log/branches are read-only GETs; branch, checkout,
 * commit, push and pull are elevated mutations that run through the git
 * provider (no force, no history rewrite).
 */
export default function CloudGitPanel({ projectId }: CloudGitPanelProps) {
  const { t } = useAdminI18n();
  const [status, setStatus] = useState<GitStatusData | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [showCommit, setShowCommit] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, logRes, branchesRes] = await Promise.all([
        cloudApi.git.status(projectId),
        cloudApi.git.log(projectId),
        cloudApi.git.branches(projectId),
      ]);
      setStatus(statusRes.status);
      setLog(logRes.log);
      setBranches(branchesRes.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.git.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {
    void refresh();
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      cloudApi.git.status(projectId),
      cloudApi.git.log(projectId),
      cloudApi.git.branches(projectId),
    ])
      .then(([statusRes, logRes, branchesRes]) => {
        if (cancelled) return;
        setStatus(statusRes.status);
        setLog(logRes.log);
        setBranches(branchesRes.branches);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.git.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function showDiff() {
    try {
      const { diff: text } = await cloudApi.git.diff(projectId);
      setDiff(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.git.diffFailed"));
    }
  }

  function runAction(action: string, title: string, description: string, payload: Record<string, unknown>) {
    queue(title, description, async () => {
      try {
        const { result: r } = await cloudApi.git.act({ projectId, action, ...payload });
        const stdout = (r as { stdout?: string }).stdout;
        const stderr = (r as { stderr?: string }).stderr;
        const exitCode = (r as { exitCode?: number | null }).exitCode;
        const text = [
          stdout,
          stderr,
          exitCode !== null && exitCode !== undefined ? t("cloud.git.exitCode", { code: String(exitCode) }) : "",
        ]
          .filter(Boolean)
          .join("\n")
          .trim();
        setResult(text || t("cloud.git.done"));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cloud.git.actionFailed"));
      }
    });
  }

  function commit() {
    if (!commitMessage.trim()) return;
    const message = commitMessage.trim();
    setCommitMessage("");
    setShowCommit(false);
    runAction("commit", t("cloud.git.queue.commitTitle"), t("cloud.git.queue.commitDesc"), {
      message,
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{t("cloud.git.branch")}</h3>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              {status?.branch ?? "…"}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {status ? (
              status.clean ? (
                <span className="text-emerald-600">{t("cloud.git.workingTreeClean")}</span>
              ) : (
                <span className="text-amber-600">
                  {t("cloud.git.uncommittedChanges", { count: status.files.length })}
                </span>
              )
            ) : (
              t("cloud.git.loadingState")
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {status ? t("cloud.git.aheadBehind", { ahead: status.ahead, behind: status.behind }) : ""}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{t("cloud.git.operations")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void refresh()} className="btn-chip">{t("cloud.git.refresh")}</button>
            <button onClick={() => void showDiff()} className="btn-chip">{t("cloud.git.diffHead")}</button>
            <button
              onClick={() => runAction("pull", t("cloud.git.pull"), t("cloud.git.queue.pullDesc"), {})}
              className="btn-chip"
            >
              {t("cloud.git.pull")}
            </button>
            <button
              onClick={() => runAction("push", t("cloud.git.push"), t("cloud.git.queue.pushDesc"), {})}
              className="btn-chip"
            >
              {t("cloud.git.push")}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{t("cloud.git.branches")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {branches.map((b) => (
              <span key={b.name} className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    runAction(
                      "checkout",
                      t("cloud.git.queue.checkoutTitle"),
                      t("cloud.git.queue.checkoutDesc", { branch: b.name }),
                      { branch: b.name }
                    )
                  }
                  disabled={b.current}
                  className={`rounded-md border px-2 py-1 font-mono text-xs ${
                    b.current
                      ? "cursor-default border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
                >
                  {b.name}
                </button>
              </span>
            ))}
            <button
              onClick={() => {
                const name = window.prompt(t("cloud.git.newBranchPrompt"));
                if (name) runAction("branch", t("cloud.git.queue.createBranchTitle"), t("cloud.git.queue.createBranchDesc", { branch: name.trim() }), { branch: name.trim() });
              }}
              className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            >
              {t("cloud.git.createBranchShort")}
            </button>
          </div>
        </div>
      </section>

      {showCommit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("cloud.git.queue.commitTitle")}</h2>
            <textarea
              autoFocus
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              placeholder={t("cloud.git.commitMessage")}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCommit(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                {t("common.cancel")}
              </button>
              <button onClick={commit} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                {t("cloud.git.commit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("cloud.git.result")}</span>
            <button onClick={() => setResult(null)} className="text-xs text-slate-400 hover:text-slate-600">{t("common.close")}</button>
          </div>
          <pre className="max-h-96 overflow-auto p-4 font-mono text-xs text-slate-700 whitespace-pre-wrap">{result}</pre>
        </div>
      ) : null}

      {diff !== null ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">git diff HEAD</span>
            <button onClick={() => setDiff(null)} className="text-xs text-slate-400 hover:text-slate-600">{t("common.close")}</button>
          </div>
          <pre className="max-h-96 overflow-auto p-4 font-mono text-xs text-slate-700 whitespace-pre-wrap">{diff}</pre>
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{t("cloud.git.statusTitle")}</h2>
          {status?.clean ? <CloudBadge status="ready" /> : status ? <CloudBadge status="active" /> : null}
        </div>
        {loading ? (
          <p className="p-4 text-sm text-slate-400">{t("common.loading")}</p>
        ) : status && status.files.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("cloud.git.staged")}</th>
                  <th className="px-4 py-2 font-medium">{t("cloud.git.worktree")}</th>
                  <th className="px-4 py-2 font-medium">{t("cloud.git.path")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {status.files.map((file, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{file.x || "·"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{file.y || "·"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{file.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-400">{t("cloud.git.noChanges")}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{t("cloud.git.recentCommits")}</h2>
          <button
            onClick={() => setShowCommit(true)}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            {t("cloud.git.commitMore")}
          </button>
        </div>
        {log.length === 0 && !loading ? (
          <p className="p-4 text-sm text-slate-400">{t("cloud.git.noCommits")}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {log.slice(0, 12).map((entry) => (
              <div key={entry.ref} className="flex items-start gap-3 px-4 py-2.5">
                <code className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                  {entry.short}
                </code>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{entry.subject}</p>
                  <p className="text-xs text-slate-400">{entry.author} · {entry.date}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <style jsx>{`
        .btn-chip {
          border-radius: 0.5rem;
          border: 1px solid rgb(226 232 240);
          padding: 0.375rem 0.625rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: rgb(71 85 105);
        }
        .btn-chip:hover {
          border-color: rgb(165 180 252);
          color: rgb(79 70 229);
        }
      `}</style>

      <ReauthModal
        open={pending !== null}
        onClose={cancel}
        onReauthenticated={onReauthenticated}
        title={pending?.title}
        description={pending?.description}
      />
    </div>
  );
}