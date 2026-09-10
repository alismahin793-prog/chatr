"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cloudApi, type CloudOperation, type ProjectDetail } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { formatDate } from "@/components/admin/cloud/formatDate";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudProjectOverviewProps {
  projectId: string;
}

/** Project metadata + live summary used by the project overview page. */
export default function CloudProjectOverview({ projectId }: CloudProjectOverviewProps) {
  const { t, dir } = useAdminI18n();
  const streamArrow = dir === "rtl" ? "←" : "→";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [operations, setOperations] = useState<CloudOperation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([cloudApi.projects.get(projectId), cloudApi.operations(projectId)])
      .then(([{ project: detail }, { operations: ops }]) => {
        if (cancelled) return;
        setProject(detail);
        setOperations(ops);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.overview.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  if (error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }
  if (!project) {
    return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  }

  const running = operations.filter((o) => o.status === "running");
  const lastOp = operations.filter((o) => o.status !== "running")[0];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900">{project.name}</h2>
              <CloudBadge status={project.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">/{project.slug}</code>
              {project.description ? <span className="ms-2">{project.description}</span> : null}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/admin/cloud/projects/${projectId}/files`}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {t("cloud.overview.openWorkspace")}
            </Link>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
          {[
            [t("common.created"), formatDate(project.createdAt)],
            [t("common.updated"), formatDate(project.updatedAt)],
            [t("cloud.overview.lastActivity"), formatDate(project.lastActivityAt)],
            [t("cloud.overview.defaultBranch"), project.defaultBranch || "—"],
            [t("cloud.overview.baseEnv"), project.baseEnv || "production"],
            [t("cloud.overview.envVariables"), String(project.envVarCount)],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-4 py-3">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
              <dd className="mt-0.5 text-sm text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="px-5 py-3 text-xs text-slate-400">
          {project.repoUrl ? (
            <span>
              {t("cloud.overview.sourceRepo")}: <a className="text-indigo-600 hover:underline" href={project.repoUrl} target="_blank" rel="noreferrer">{project.repoUrl}</a>
            </span>
          ) : (
            <span>{t("cloud.overview.workspaceOnly")}</span>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{t("cloud.overview.runningOperations")}</h3>
          {running.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {running.map((op) => (
                <li key={op.id} className="flex items-center gap-2 text-sm">
                  <CloudBadge status="running" />
                  <code className="truncate font-mono text-xs text-slate-700">
                    {op.program.replace(/\.(cmd|exe)$/i, "")} {op.args.join(" ")}
                  </code>
                  <Link href={`/admin/cloud/projects/${projectId}/terminal`} className="ms-auto text-xs font-medium text-indigo-600 hover:underline">
                    {t("cloud.overview.stream")} {streamArrow}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-400">{t("cloud.overview.nothingRunning")}</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{t("cloud.overview.lastFinishedOperation")}</h3>
          {lastOp ? (
            <div className="mt-2 text-sm">
              <div className="flex items-center gap-2">
                <CloudBadge status={lastOp.status} />
                <code className="truncate font-mono text-xs text-slate-700">
                  {lastOp.program.replace(/\.(cmd|exe)$/i, "")} {lastOp.args.join(" ")}
                </code>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {lastOp.exit_code !== null ? t("cloud.overview.exitCode", { code: lastOp.exit_code }) : lastOp.status} ·{" "}
                {lastOp.duration_ms != null ? `${Math.round(lastOp.duration_ms / 1000)}s` : "—"} ·{" "}
                {formatDate(lastOp.created_at)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">{t("cloud.overview.noOperations")}</p>
          )}
        </section>
      </div>
    </div>
  );
}