"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReauthModal from "@/components/admin/ReauthModal";
import AdminSection from "@/components/admin/AdminSection";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { formatDate } from "@/components/admin/cloud/formatDate";
import { cloudApi, type Project } from "@/components/admin/cloud/CloudApi";
import { useAdminI18n } from "@/i18n/LanguageProvider";

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug;
}

/**
 * Cloud projects directory. Creation and archiving are sensitive actions that
 * re-enter the 30-second elevated window; the server independently enforces
 * super_admin + window on every endpoint.
 */
export default function CloudProjectsManager() {
  const { t } = useAdminI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const refresh = useCallback(async () => {
    try {
      const { projects: list } = await cloudApi.projects.list();
      setProjects(list);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.projects.loadError"));
      setLoading(false);
    }
  }, [t]);

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {
    void refresh();
    setShowCreate(false);
  });

  useEffect(() => {
    let cancelled = false;
    cloudApi.projects
      .list()
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.projects.loadError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  function submitCreate() {
    queue(
      t("cloud.projects.createTitle"),
      t("cloud.projects.createDescription"),
      async () => {
        await cloudApi.projects.create({
          name,
          slug,
          description: description || undefined,
          repoUrl: repoUrl || undefined,
        });
        setNotice(t("cloud.projects.createdNotice", { name }));
      }
    );
  }

  function archive(project: Project) {
    queue(
      t("cloud.projects.archiveTitle", { name: project.name }),
      t("cloud.projects.archiveDescription"),
      async () => {
        await cloudApi.projects.archive(project.id);
        setNotice(t("cloud.projects.archivedNotice", { name: project.name }));
      }
    );
  }

  return (
    <>
      <AdminSection
        titleKey="cloud.projects.title"
        descriptionKey="cloud.projects.description"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {loading
              ? t("common.loading")
              : projects.length === 1
                ? t("cloud.projects.countOne")
                : t("cloud.projects.countMany", { count: projects.length })}
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {t("cloud.projects.newProject")}
          </button>
        </div>

        {notice ? (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {projects.length === 0 && !loading ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="font-medium text-slate-700">{t("cloud.projects.emptyTitle")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t("cloud.projects.emptyDescription")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("cloud.projects.tableProject")}</th>
                  <th className="px-4 py-3 font-medium">{t("cloud.projects.tableBuild")}</th>
                  <th className="px-4 py-3 font-medium">{t("cloud.projects.tableLastDeploy")}</th>
                  <th className="px-4 py-3 font-medium">{t("common.updated")}</th>
                  <th className="px-4 py-3 font-medium">{t("cloud.projects.tableActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/cloud/projects/${project.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {project.name}
                      </Link>
                      <p className="text-xs text-slate-400">/{project.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <CloudBadge
                        status={project.lastBuildStatus === "never" ? "never" : project.lastBuildStatus}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CloudBadge
                        status={project.lastDeploymentStatus === "never" ? "never" : project.lastDeploymentStatus}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatDate(project.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/cloud/projects/${project.id}/files`}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                        >
                          {t("cloud.projects.tabs.files")}
                        </Link>
                        <Link
                          href={`/admin/cloud/projects/${project.id}/terminal`}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                        >
                          {t("cloud.projects.tabs.terminal")}
                        </Link>
                        {project.status === "active" ? (
                          <button
                            onClick={() => archive(project)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-rose-300 hover:text-rose-600"
                          >
                            {t("cloud.projects.archive")}
                          </button>
                        ) : (
                          <CloudBadge status="archived" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("cloud.projects.createTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("cloud.projects.createModalDescription")}
            </p>
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitCreate();
              }}
            >
              <Field label={t("common.name")}>
                <input
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSlug(slugify(e.target.value));
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500"
                  placeholder={t("cloud.projects.placeholderName")}
                />
              </Field>
              <Field label={t("cloud.projects.fieldSlug")}>
                <input
                  required
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-indigo-500"
                />
              </Field>
              <Field label={t("cloud.projects.fieldDescriptionOptional")}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500"
                />
              </Field>
              <Field label={t("cloud.projects.fieldRepoUrlOptional")}>
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-indigo-500"
                  placeholder="https://github.com/org/repo.git"
                />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  {t("cloud.projects.createAction")}
                </button>
              </div>
            </form>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}