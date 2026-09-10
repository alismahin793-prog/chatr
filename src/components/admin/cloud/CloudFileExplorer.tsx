"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import CloudCodeEditor from "@/components/admin/cloud/CloudCodeEditor";
import { cloudApi, type FileEntry } from "@/components/admin/cloud/CloudApi";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudFileExplorerProps {
  projectId: string;
}

type Tab = "files" | "search";

/**
 * File explorer + editor for a cloud project. Every read/write goes through
 * the server workspace provider (path confinement, sensitive-file refusal,
 * size caps). Writes/renames/deletes require the elevated window.
 */
export default function CloudFileExplorer({ projectId }: CloudFileExplorerProps) {
  const { t } = useAdminI18n();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [path, setPath] = useState(".");
  const [tab, setTab] = useState<Tab>("files");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<null | { action: "file" | "dir" | "rename" | "delete"; target?: string }>(null);
  const [promptValue, setPromptValue] = useState("");
  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {
    setError(null);
    setNotice(null);
  });

  const load = useCallback(
    async (dir: string) => {
      try {
        const { entries: list } = await cloudApi.files.list(projectId, dir);
        setEntries(list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)));
        setPath(dir);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cloud.files.listFailed"));
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    cloudApi.files
      .list(projectId, ".")
      .then(({ entries: list }) => {
        if (cancelled) return;
        setEntries(list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)));
        setPath(".");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.files.listFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function toast(message: string) {
    setNotice(message);
    setError(null);
  }

  async function openFile(entry: FileEntry) {
    setError(null);
    try {
      const { file } = await cloudApi.files.read(projectId, entry.path);
      setOpenPath(entry.path);
      setContent(file.content);
      setSavedSize(file.size);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.files.openFailed"));
    }
  }

  function saveFile() {
    if (!openPath) return;
    queue(
      t("cloud.files.queue.saveTitle"),
      t("cloud.files.queue.saveDesc", { path: openPath ?? "" }),
      async () => {
        const { file } = await cloudApi.files.write(projectId, openPath, content);
        setSavedSize(file.size);
        setDirty(false);
        toast(t("cloud.files.savedPath", { path: openPath ?? "" }));
      }
    );
  }

  function confirmPrompt() {
    const action = prompt;
    if (!action) return;
    const value = promptValue.trim();
    setPrompt(null);
    setPromptValue("");
    if (!value) return;

    const targetPath = [path.replace(/^\.$/, ""), value].filter(Boolean).join("/");
    if (action.action === "file") {
      queue(t("cloud.files.queue.createFileTitle"), t("cloud.files.createTarget", { path: targetPath }), async () => {
        await cloudApi.files.write(projectId, targetPath, "");
        toast(t("cloud.files.createdPath", { path: targetPath }));
        await load(path);
      });
    } else if (action.action === "dir") {
      queue(t("cloud.files.queue.createDirTitle"), t("cloud.files.createTarget", { path: targetPath }), async () => {
        await cloudApi.files.mkdir(projectId, targetPath);
        toast(t("cloud.files.createdPath", { path: targetPath }));
        await load(path);
      });
    } else if (action.action === "rename" && action.target) {
      queue(
        t("cloud.files.queue.renameTitle"),
        t("cloud.files.queue.renameDesc", { from: action.target, to: value }),
        async () => {
          const from = action.target!;
          const to = [dirOf(from), value].filter(Boolean).join("/");
          await cloudApi.files.rename(projectId, from, to);
          toast(t("cloud.files.renamedTo", { path: to }));
          if (openPath === from) {
            setOpenPath(null);
            setContent("");
            setDirty(false);
          }
          await load(path);
        }
      );
    } else if (action.action === "delete" && action.target) {
      const isDir = entries.find((e) => e.path === action.target)?.type === "dir";
      queue(
        t("cloud.files.deleteTitle"),
        isDir
          ? t("cloud.files.deleteTargetRecursive", { path: action.target })
          : t("cloud.files.deleteTarget", { path: action.target }),
        async () => {
          await cloudApi.files.del(projectId, action.target!, isDir);
          toast(t("cloud.files.deletedPath", { path: action.target ?? "" }));
          if (openPath === action.target) {
            setOpenPath(null);
            setContent("");
            setDirty(false);
          }
          await load(path);
        }
      );
    }
  }

  async function runSearch() {
    if (!query.trim()) return;
    setError(null);
    try {
      const { entries: found } = await cloudApi.files.search(projectId, query);
      setResults(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.files.searchFailed"));
    }
  }

  const crumb = path === "." ? [] : path.split("/");

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Left: browser */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-2">
            <button
              onClick={() => setTab("files")}
              className={`rounded-md px-2 py-1 text-xs font-medium ${tab === "files" ? "bg-slate-100 text-slate-900" : "text-slate-500"}`}
            >
              {t("cloud.files.files")}
            </button>
            <button
              onClick={() => setTab("search")}
              className={`rounded-md px-2 py-1 text-xs font-medium ${tab === "search" ? "bg-slate-100 text-slate-900" : "text-slate-500"}`}
            >
              {t("common.search")}
            </button>
            <div className="ms-auto flex items-center gap-1">
              <button
                onClick={() => setPrompt({ action: "file" })}
                className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                title={t("cloud.files.newFile")}
              >
                {t("cloud.files.addFile")}
              </button>
              <button
                onClick={() => setPrompt({ action: "dir" })}
                className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                title={t("cloud.files.newFolder")}
              >
                {t("cloud.files.addDir")}
              </button>
              <button
                onClick={() => void load(path)}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
              >
                ↻
              </button>
            </div>
          </div>

          {tab === "files" ? (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                <button onClick={() => void load(".")} className="rounded px-1 hover:bg-slate-100 hover:text-indigo-600">
                  .
                </button>
                {crumb.map((part, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="text-slate-300">/</span>
                    <button
                      onClick={() => void load(crumb.slice(0, i + 1).join("/"))}
                      className="rounded px-1 hover:bg-slate-100 hover:text-indigo-600"
                    >
                      {part}
                    </button>
                  </span>
                ))}
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-1">
                {loading ? (
                  <p className="p-4 text-sm text-slate-400">{t("common.loading")}</p>
                ) : entries.length === 0 ? (
                  <p className="p-4 text-sm text-slate-400">{t("cloud.files.emptyDir")}</p>
                ) : (
                  entries.map((entry) => (
                    <div
                      key={entry.path}
                      className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50"
                    >
                      {entry.type === "dir" ? (
                        <button
                          onClick={() => void load(entry.path)}
                          className="flex min-w-0 items-center gap-2 text-sm text-slate-700"
                        >
                          <span className="text-slate-400">▸</span>
                          <span className="truncate font-medium">{entry.name}</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => void openFile(entry)}
                          className="flex min-w-0 items-center gap-2 text-sm text-slate-700"
                        >
                          <span className="text-slate-400">·</span>
                          <span className="truncate">{entry.name}</span>
                          <span className="text-[10px] tabular-nums text-slate-400">
                            {entry.size != null ? Math.round(entry.size / 1024) : ""}K
                          </span>
                        </button>
                      )}
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => {
                            setPrompt({ action: "rename", target: entry.path });
                          }}
                          className="rounded px-1 text-xs text-slate-400 hover:text-indigo-600"
                        >
                          {t("cloud.files.renameAction")}
                        </button>
                        <button
                          onClick={() => setPrompt({ action: "delete", target: entry.path })}
                          className="rounded px-1 text-xs text-slate-400 hover:text-rose-600"
                        >
                          {t("cloud.files.deleteAction")}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="p-3">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                  placeholder={t("cloud.files.searchPlaceholder")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => void runSearch()}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  {t("common.search")}
                </button>
              </div>
              <div className="mt-3 space-y-0.5">
                {results.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => (entry.type === "dir" ? void load(entry.path) : void openFile(entry))}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-start text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <span className="truncate font-mono text-xs">
                      {entry.type === "dir" ? "▸ " : ""}
                      {entry.path}
                    </span>
                  </button>
                ))}
                {results.length === 0 && query ? <p className="text-sm text-slate-400">{t("cloud.files.noMatches")}</p> : null}
              </div>
            </div>
          )}
        </section>

        {/* Right: editor */}
        <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          {openPath === null ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-400">
              {t("cloud.files.selectFilePrompt")}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
                <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                  {openPath}
                </code>
                {savedSize != null ? (
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {Math.round(savedSize / 1024)}K{dirty ? t("cloud.files.unsaved") : ""}
                  </span>
                ) : null}
                <div className="ms-auto flex items-center gap-2">
                  <button
                    onClick={() => {
                      setOpenPath(null);
                      setContent("");
                      setDirty(false);
                    }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                  >
                    {t("common.close")}
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={!dirty}
                    className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("common.save")}
                  </button>
                </div>
              </div>
              <div className="min-h-[52vh] flex-1">
                <CloudCodeEditor path={openPath} content={content} onChange={(v) => { setContent(v); setDirty(true); }} />
              </div>
            </>
          )}
        </section>
      </div>

      {notice ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {prompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              {prompt.action === "file"
                ? t("cloud.files.newFile")
                : prompt.action === "dir"
                  ? t("cloud.files.newFolder")
                  : prompt.action === "rename"
                    ? t("cloud.files.renameTarget", { path: prompt.target ?? "" })
                    : entries.find((e) => e.path === prompt.target)?.type === "dir"
                      ? t("cloud.files.deleteTargetRecursive", { path: prompt.target ?? "" })
                      : t("cloud.files.deleteTarget", { path: prompt.target ?? "" })}
            </h2>
            {prompt.action === "delete" ? (
              <p className="mt-1 text-sm text-slate-500">{t("cloud.files.deleteWarning")}</p>
            ) : (
              <input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmPrompt()}
                placeholder={prompt.action === "rename" ? t("cloud.files.newName") : t("common.name")}
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setPrompt(null);
                  setPromptValue("");
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={confirmPrompt}
                className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${prompt.action === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
              >
                {prompt.action === "delete" ? t("cloud.files.deleteTitle") : t("common.create")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ReauthModal
        open={pending !== null}
        onClose={cancel}
        onReauthenticated={onReauthenticated}
        title={pending?.title}
        description={pending?.description}
      />
    </>
  );
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}