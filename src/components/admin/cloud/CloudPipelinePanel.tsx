"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cloudApi, type CloudOperation } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

interface CloudPipelinePanelProps {
  projectId: string;
}

const STEP_LABELS: Record<string, TranslationKey> = {
  install: "cloud.pipeline.step.install",
  lint: "cloud.pipeline.step.lint",
  typecheck: "cloud.pipeline.step.typecheck",
  test: "cloud.pipeline.step.test",
  gate: "cloud.pipeline.step.gate",
  build: "cloud.pipeline.step.build",
};

/**
 * Static, declarative pipeline steps served by the pipeline route
 * (install → lint → typecheck → test → gate → build). Clicking a step runs it
 * through the REAL execution provider; progress streams on the Terminal page.
 */
export default function CloudPipelinePanel({ projectId }: CloudPipelinePanelProps) {
  const { t } = useAdminI18n();
  const [steps, setSteps] = useState<{ key: string; label: string; description: string }[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [last, setLast] = useState<{ step: string; state: string; exitCode: number | null } | null>(null);
  const [operations, setOperations] = useState<CloudOperation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cloudApi
      .providers()
      .then((payload) => setSteps(payload.pipeline))
      .catch((err) => setError(err instanceof Error ? err.message : t("cloud.pipeline.loadFailed")));
  }, []);

  useEffect(() => {
    void cloudApi.operations(projectId).then(({ operations }) => setOperations(operations)).catch(() => undefined);
  }, [projectId, last]);

  async function runStep(key: string) {
    setError(null);
    setRunning(key);
    try {
      const res = await cloudApi.pipeline(projectId, key);
      setLast({ step: key, state: res.process.state, exitCode: res.process.exitCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.pipeline.startFailed"));
      setLast({ step: key, state: "error", exitCode: null });
    } finally {
      setRunning(null);
      void cloudApi.operations(projectId).then(({ operations }) => setOperations(operations)).catch(() => undefined);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {last ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <CloudBadge status={last.state} />
            <span className="text-slate-700">
              <strong className="font-mono">{last.step}</strong>{" "}
              {t("cloud.pipeline.finished")}
              {last.exitCode !== null ? t("cloud.pipeline.withCode", { code: String(last.exitCode) }) : ""}.
            </span>
            <Link href={`/admin/cloud/projects/${projectId}/terminal`} className="ms-auto text-xs font-medium text-indigo-600 hover:underline">
              {t("cloud.pipeline.viewTerminal")}
            </Link>
          </div>
          {last.state === "running" ? (
            <p className="mt-1 text-xs text-slate-500">{t("cloud.pipeline.streamingNote")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => {
          const runKind =
            step.key === "build"
              ? "build"
              : step.key === "test"
                ? "test"
                : step.key === "install"
                  ? "install"
                  : step.key === "lint"
                    ? "lint"
                    : step.key === "typecheck"
                      ? "typecheck"
                      : "command";
          const op = operations.find((o) => o.kind === runKind && o.status === "running");
          const isRunning = running === step.key || !!op;
          const labelKey = STEP_LABELS[step.key];
          return (
            <div key={step.key} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-900">
                  {labelKey ? t(labelKey) : step.label}
                </h3>
                {isRunning ? <CloudBadge status="running" /> : null}
              </div>
              <p className="mt-1 min-h-[2.5rem] text-xs text-slate-500">{step.description}</p>
              <button
                onClick={() => void runStep(step.key)}
                disabled={isRunning}
                className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isRunning ? t("cloud.pipeline.running") : t("cloud.pipeline.runStep")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}