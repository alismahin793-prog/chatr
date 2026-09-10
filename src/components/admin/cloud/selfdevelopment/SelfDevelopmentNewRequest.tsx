"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminSection from "@/components/admin/AdminSection";
import ReauthModal from "@/components/admin/ReauthModal";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import { cloudApi } from "@/components/admin/cloud/CloudApi";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface NewRequestProject {
  id: string;
  name: string;
  slug: string;
  status: string;
  default_branch: string;
}

export default function SelfDevelopmentNewRequest({
  projects,
}: {
  projects: NewRequestProject[];
}) {
  const router = useRouter();
  const { t } = useAdminI18n();
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const active = projects.filter((p) => p.status === "active");
  const remaining = 8000 - prompt.length;

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {});

  function submit() {
    setError(null);
    setNotice(null);
    if (!projectId) {
      setError(t("selfdev.newRequest.error.noProject"));
      return;
    }
    if (prompt.trim().length < 10) {
      setError(t("selfdev.newRequest.error.promptTooShort"));
      return;
    }
    queue(
      t("selfdev.newRequest.reauthTitle"),
      t("selfdev.newRequest.reauthDescription"),
      async () => {
        try {
          const { request } = await cloudApi.selfDevelopment.create({
            projectId,
            prompt,
          });
          setNotice(t("selfdev.newRequest.noticeCreated"));
          router.push(`/admin/cloud/self-development/${request.id}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("selfdev.newRequest.error.createFailed"));
        }
      }
    );
  }

  return (
    <>
      <AdminSection
        titleKey="selfdev.newRequest.title"
        descriptionKey="selfdev.newRequest.description"
      >
        <Link href="/admin/cloud/self-development" className="text-sm text-indigo-600 hover:underline">
          {t("selfdev.newRequest.backLink")}
        </Link>

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

        <div className="mt-6 max-w-2xl rounded-xl border border-slate-200 bg-white p-6">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("selfdev.newRequest.cloudProject")}</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">{t("selfdev.newRequest.selectProject")}</option>
              {active.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.slug} · {project.default_branch})
                </option>
              ))}
            </select>
          </label>
          {active.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              {t("selfdev.newRequest.noActivePrefix")}{" "}
              <Link href="/admin/cloud/projects" className="text-indigo-600 hover:underline">
                {t("nav.cloudProjects")}
              </Link>{" "}
              {t("selfdev.newRequest.noActiveSuffix")}
            </p>
          ) : null}

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">{t("selfdev.prompt")}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              maxLength={8000}
              placeholder={t("selfdev.newRequest.promptPlaceholder")}
              className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <span className="mt-1 block text-end text-[11px] tabular-nums text-slate-400">
              {t("selfdev.newRequest.charactersLeft", { count: remaining })}
            </span>
          </label>
          <p className="mt-1 text-xs text-slate-500">
            {t("selfdev.newRequest.helper")}
          </p>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Link
              href="/admin/cloud/self-development"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {t("common.cancel")}
            </Link>
            <button
              onClick={submit}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              {t("selfdev.newRequest.create")}
            </button>
          </div>
        </div>
      </AdminSection>

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