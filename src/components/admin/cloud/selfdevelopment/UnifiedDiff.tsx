"use client";

import { useState } from "react";
import type { SelfDevelopmentChange } from "@/components/admin/cloud/CloudApi";
import { useAdminI18n } from "@/i18n/LanguageProvider";

function summaryOf(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

/** Syntax-free unified diff viewer. Line prefixes drive color; full content is never persisted. */
export function UnifiedDiff({ diff }: { diff: string }) {
  const { t } = useAdminI18n();
  const [wrap, setWrap] = useState(false);
  const lines = diff.split("\n");
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("selfdev.diff.title")}</span>
        <button
          type="button"
          onClick={() => setWrap((v) => !v)}
          className="text-[11px] font-medium text-indigo-600 hover:underline"
        >
          {wrap ? t("common.noWrap") : t("common.wrap")}
        </button>
      </div>
      <pre
        className={`overflow-x-auto bg-slate-950 px-3 py-2 font-mono text-[11px] leading-5 text-slate-100 ${
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        }`}
      >
        {lines.map((line, index) => {
          let className = "text-slate-300";
          if (line.startsWith("+++") || line.startsWith("---")) className = "text-indigo-300 font-semibold";
          else if (line.startsWith("+")) className = "text-emerald-300";
          else if (line.startsWith("-")) className = "text-rose-300";
          else if (line.startsWith("@@")) className = "text-amber-300 font-semibold";
          return (
            <div key={index} className={className}>
              {line.length === 0 ? " " : line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** Compact one-line summary per stored change (op + sha256 hashes). */
export function ChangeRow({ change }: { change: SelfDevelopmentChange }) {
  const { t } = useAdminI18n();
  const { added, removed } = summaryOf(change.diff);
  return (
    <div className="border-b border-slate-200 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          {change.operation}
        </span>
        <code className="font-mono text-xs font-medium text-slate-800">{change.file}</code>
        {change.path_from && change.path_to ? (
          <code className="font-mono text-[11px] text-slate-400">
            {change.path_from} {"->"} {change.path_to}
          </code>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>
          <span className="font-medium text-emerald-600">+{added}</span>{" "}
          <span className="font-medium text-rose-600">-{removed}</span>
        </span>
        {change.before_sha256 ? (
          <span className="font-mono">{t("common.before")} <span className="text-slate-400">sha256:{change.before_sha256.slice(0, 12)}</span></span>
        ) : null}
        {change.after_sha256 ? (
          <span className="font-mono">{t("common.after")} <span className="text-slate-400">sha256:{change.after_sha256.slice(0, 12)}</span></span>
        ) : null}
      </div>
    </div>
  );
}