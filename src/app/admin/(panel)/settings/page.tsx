import { requireAdminIdentity } from "@/server/admin/security";
import { getAiSettings } from "@/server/config/env";
import { listAvailableProviders } from "@/server/ai/factory";
import { getSystemHealth } from "@/server/admin/system";
import AdminSection from "@/components/admin/AdminSection";
import { SUPER_ADMIN_ROLE, USER_ROLE } from "@/lib/shared/roles";
import SettingsIdentity from "@/components/admin/pages/SettingsIdentity";
import SettingsRoles from "@/components/admin/pages/SettingsRoles";
import SettingsAiWiring from "@/components/admin/pages/SettingsAiWiring";
import SettingsHelpfulLinks from "@/components/admin/pages/SettingsHelpfulLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings page. Requires super_admin identity (enforced server-side).
 * Read-only reference: identity, the role/status model, provider wiring and
 * deployment facts. Never exposes secrets.
 */
export default async function AdminSettingsPage() {
  const ctx = await requireAdminIdentity();
  const settings = getAiSettings();
  const providers = listAvailableProviders();
  const health = await getSystemHealth(ctx.service);

  const signedInAt = ctx.user.created_at;

  return (
    <AdminSection
      titleKey="pages.settings.title"
      descriptionKey="pages.settings.description"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <SettingsIdentity
          displayName={ctx.profile.display_name}
          email={ctx.user.email}
          userIdPrefix={ctx.user.id.slice(0, 8)}
          role={ctx.profile.role ?? "none"}
          roleTone={ctx.profile.role === SUPER_ADMIN_ROLE ? "emerald" : "default"}
          status={ctx.profile.status ?? "none"}
          statusTone={ctx.profile.status === "approved" ? "emerald" : "default"}
          signedInSince={signedInAt ? new Date(signedInAt).toLocaleString() : "—"}
        />

        <SettingsRoles
          rolesValue={`${SUPER_ADMIN_ROLE} · ${USER_ROLE}`}
        />

        <SettingsAiWiring
          activeProvider={settings.provider}
          activeModel={settings.model}
          configuredCount={providers.length}
          databaseOk={health.database === "ok"}
          platformValue="Chatr · Supabase · Vercel"
          runtimeVersion={`Node ${process.version ?? "—"}`}
        />

        <SettingsHelpfulLinks />
      </div>
    </AdminSection>
  );
}
