"use client";

import Link from "next/link";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface EnvironmentsProjectRow {
  id: string;
  name: string;
  slug: string;
  envVarCount: number;
  updatedAt: string;
}

interface EnvironmentsGlobalProps {
  projects: EnvironmentsProjectRow[];
}

export default function EnvironmentsGlobal({ projects }: EnvironmentsGlobalProps) {
  const { t } = useAdminI18n();

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">
                {t("pages.cloud.environments.columnProject")}
              </th>
              <th className="px-4 py-3 font-medium">
                {t("pages.cloud.environments.columnVariables")}
              </th>
              <th className="px-4 py-3 font-medium">{t("common.updated")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {projects.map((project) => (
              <tr key={project.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/cloud/projects/${project.id}/environments`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {project.name}
                  </Link>
                  <p className="text-xs text-slate-400">/{project.slug}</p>
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{project.envVarCount}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{project.updatedAt}</td>
              </tr>
            ))}
            {projects.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-sm text-slate-400">
                  {t("pages.cloud.environments.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}