import type { ReactNode } from "react";
import AdminSection from "@/components/admin/AdminSection";
import CloudProjectTabs from "@/components/admin/cloud/CloudProjectTabs";
import { createServiceClient } from "@/lib/supabase/service";
import { getProjectOrThrow } from "@/server/cloud/service";

export type CloudProjectTab =
  | "overview"
  | "files"
  | "terminal"
  | "git"
  | "pipeline"
  | "snapshots"
  | "deployments"
  | "environments";

/**
 * Server shell for a cloud project page: resolves the project server-side so
 * the AdminSection title/description are real data and a missing project fails
 * with a not-found render. The tab bar is a client component so its labels can
 * be translated.
 */
export default async function CloudProjectShell({
  projectId,
  tab,
  children,
}: {
  projectId: string;
  tab: CloudProjectTab;
  children: ReactNode;
}) {
  const service = createServiceClient();
  const project = await getProjectOrThrow(service, projectId);
  return (
    <AdminSection title={project.name} description={`/${project.slug}`}>
      <CloudProjectTabs projectId={projectId} tab={tab} />
      {children}
    </AdminSection>
  );
}