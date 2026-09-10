"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import AdminSection from "@/components/admin/AdminSection";
import ReauthModal from "@/components/admin/ReauthModal";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";
import {
  cloudApi,
  type SelfDevelopmentAction,
  type SelfDevelopmentDetail as Detail,
} from "@/components/admin/cloud/CloudApi";
import { formatDate } from "@/components/admin/cloud/formatDate";
import {
  SelfDevelopmentRiskBadge,
  SelfDevelopmentStatusBadge,
  SelfDevelopmentStepBadge,
} from "@/components/admin/cloud/selfdevelopment/SelfDevelopmentBadge";
import { ChangeRow, UnifiedDiff } from "@/components/admin/cloud/selfdevelopment/UnifiedDiff";

const STEP_KIND_LABELS: Record<string, TranslationKey> = {
  planning: "selfdev.stepKind.planning",
  snapshot: "selfdev.stepKind.snapshot",
  workspace: "selfdev.stepKind.workspace",
  analyze: "selfdev.stepKind.analyze",
  modify: "selfdev.stepKind.modify",
  install: "selfdev.stepKind.install",
  lint: "selfdev.stepKind.lint",
  typecheck: "selfdev.stepKind.typecheck",
  test: "selfdev.stepKind.test",
  gate: "selfdev.stepKind.gate",
  build: "selfdev.stepKind.build",
  repair: "selfdev.stepKind.repair",
  commit: "selfdev.stepKind.commit",
  review: "selfdev.reviews.title",
  deploy: "selfdev.stepKind.deploy",
  verify: "selfdev.stepKind.verify",
  rollback: "selfdev.stepKind.rollback",
  cancel: "selfdev.stepKind.cancel",
};

const REVIEW_RESULT_LABELS: Record<string, TranslationKey> = {
  approved: "selfdev.reviewResult.approved",
  needs_changes: "selfdev.reviewResult.needs_changes",
  blocked: "selfdev.reviewResult.blocked",
};

const TERMINAL = new Set(["completed", "failed", "rolled_back", "cancelled", "rejected"]);

export default function SelfDevelopmentDetail({ initial }: { initial: Detail }) {
  const { t } = useAdminI18n();
  const [data, setData] = useState<Detail>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ackCritical, setAckCritical] = useState(false);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await cloudApi.selfDevelopment.get(initial.request.id);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("selfdev.detail.reloadFailed"));
    }
  }, [initial.request.id]);

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {});

  const { request, project } = data;

  function submit(action: SelfDevelopmentAction) {
    setError(null);
    setNotice(null);
    if (action === "approve-plan" && request.risk_level === "critical" && !ackCritical) {
      setError(t("selfdev.detail.error.ackPlan"));
      return;
    }
    if (action === "approve-deploy") {
      if (request.risk_level === "critical" && !ackCritical) {
        setError(t("selfdev.detail.error.ackDeploy"));
        return;
      }
      if (!confirmDeploy) {
        setError(t("selfdev.detail.error.confirmDeploy"));
        return;
      }
    }
    if (action === "rollback" && !confirmRollback) {
      setError(t("selfdev.detail.error.confirmRollback"));
      return;
    }

    queue(
      t(TITLES[action]),
      t(ACTION_DESCRIPTIONS[action]),
      async () => {
        try {
          setBusy(action);
          await cloudApi.selfDevelopment.action(request.id, {
            action,
            acknowledgeCritical: ackCritical,
            confirm: action === "rollback" ? confirmRollback : confirmDeploy,
          });
          setAckCritical(false);
          setConfirmDeploy(false);
          setConfirmRollback(false);
          setNotice(t("selfdev.detail.actionCompleted", { title: t(TITLES[action]) }));
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : t("selfdev.detail.actionFailed"));
        } finally {
          setBusy(null);
        }
      }
    );
  }

  const canCancel = !TERMINAL.has(request.status) && request.status !== "draft";

  return (
    <>
      <AdminSection titleKey="selfdev.detail.title" descriptionKey="selfdev.detail.description">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SelfDevelopmentStatusBadge status={request.status} size="md" />
          <SelfDevelopmentRiskBadge risk={request.risk_level} />
          <Link href={`/admin/cloud/projects/${project.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
            {project.name}
          </Link>
          {request.branch ? (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{request.branch}</code>
          ) : null}
          <span className="font-mono text-[11px] text-slate-400">{request.id.slice(0, 8)}</span>
          <span className="text-xs text-slate-400">{t("selfdev.detail.created", { date: formatDate(request.created_at) })}</span>
        </div>

        {(request.status === "awaiting_plan_approval" || request.status === "awaiting_deploy_approval") && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">{t("selfdev.detail.waitingForAdmin")}</span>{" "}
            {request.status === "awaiting_plan_approval"
              ? t("selfdev.detail.waitingPlanBody")
              : t("selfdev.detail.waitingDeployBody")}
          </div>
        )}
        {request.error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="font-semibold">{t("common.error")}:</span> {request.error}
          </div>
        ) : null}
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

        <ActionBar
          status={request.status}
          risk={request.risk_level}
          busy={busy}
          canCancel={canCancel}
          ackCritical={ackCritical}
          setAckCritical={setAckCritical}
          confirmDeploy={confirmDeploy}
          setConfirmDeploy={setConfirmDeploy}
          confirmRollback={confirmRollback}
          setConfirmRollback={setConfirmRollback}
          onAction={submit}
        />

        <PromptBlock prompt={request.prompt} />

        {request.plan ? <PlanBlock plan={request.plan} /> : null}
        {request.review ? <ReviewBlock review={request.review} /> : null}

        {data.changes.length > 0 ? (
          <Section title={t("selfdev.changes.sectionTitle")} subtitle={t("selfdev.changes.sectionSubtitle")}>
            <div className="divide-y divide-slate-200">
              {data.changes.map((change) => (
                <div key={change.id}>
                  <div className="py-1">
                    <ChangeRow change={change} />
                    <button
                      type="button"
                      onClick={() => setExpandedDiff(expandedDiff === change.id ? null : change.id)}
                      className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
                    >
                      {expandedDiff === change.id ? t("common.hideDiff") : t("common.showDiff")}
                    </button>
                  </div>
                  {expandedDiff === change.id ? (
                    <div className="mb-3 overflow-hidden rounded-lg border border-slate-700">
                      <UnifiedDiff diff={change.diff} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title={t("selfdev.timeline.sectionTitle")} subtitle={t("selfdev.timeline.sectionSubtitle")}>
          {data.steps.length === 0 ? (
            <p className="text-sm text-slate-500">{t("selfdev.timeline.empty")}</p>
          ) : (
            <ol className="space-y-2">
              {data.steps.map((step) => (
                <li key={step.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {STEP_KIND_LABELS[step.stage] ? t(STEP_KIND_LABELS[step.stage]) : step.stage}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">{step.stage}</span>
                      <SelfDevelopmentStepBadge status={step.status} />
                    </div>
                    <span className="text-[11px] tabular-nums text-slate-400">{formatDate(step.completed_at ?? step.started_at)}</span>
                  </div>
                  {step.output_head ? (
                    <p className="mt-1.5 text-xs text-slate-500">
                      {step.output_head}
                      {step.output_truncated ? "…" : ""}
                    </p>
                  ) : null}
                  {step.error ? <p className="mt-1 text-xs text-red-600">{step.error}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </Section>
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

// ------------------------------------------------------------------
// Action buttons (gate-aware)
// ------------------------------------------------------------------

const TITLES: Record<SelfDevelopmentAction, TranslationKey> = {
  "start-planning": "selfdev.actions.startPlanning",
  "approve-plan": "selfdev.actions.approvePlan",
  "reject-plan": "selfdev.actions.rejectPlan",
  run: "selfdev.actions.run",
  "approve-deploy": "selfdev.actions.approveDeploy",
  cancel: "selfdev.actions.cancel",
  rollback: "selfdev.actions.rollback",
};

const ACTION_DESCRIPTIONS: Record<SelfDevelopmentAction, TranslationKey> = {
  "start-planning": "selfdev.actions.descStartPlanning",
  "approve-plan": "selfdev.actions.descApprovePlan",
  "reject-plan": "selfdev.actions.descRejectPlan",
  run: "selfdev.actions.descRun",
  "approve-deploy": "selfdev.actions.descApproveDeploy",
  cancel: "selfdev.actions.descCancel",
  rollback: "selfdev.actions.descRollback",
};

function ActionBar(props: {
  status: string;
  risk: "low" | "medium" | "high" | "critical";
  busy: string | null;
  canCancel: boolean;
  ackCritical: boolean;
  setAckCritical: (v: boolean) => void;
  confirmDeploy: boolean;
  setConfirmDeploy: (v: boolean) => void;
  confirmRollback: boolean;
  setConfirmRollback: (v: boolean) => void;
  onAction: (action: SelfDevelopmentAction) => void;
}) {
  const {
    status,
    risk,
    busy,
    canCancel,
    ackCritical,
    setAckCritical,
    confirmDeploy,
    setConfirmDeploy,
    confirmRollback,
    setConfirmRollback,
    onAction,
  } = props;
  const { t } = useAdminI18n();
  const critical = risk === "critical";

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {status === "draft" ? (
        <ActionRow>
          <PrimaryAction label={t("selfdev.actions.buttonStartPlanning")} busy={busy === "start-planning"} onClick={() => onAction("start-planning")} />
        </ActionRow>
      ) : null}

      {status === "workspace_preparing" ? (
        <ActionRow>
          <PrimaryAction label={t("selfdev.actions.buttonRun")} busy={busy === "run"} onClick={() => onAction("run")} />
          {canCancel ? <SecondaryAction label={t("common.cancel")} onClick={() => onAction("cancel")} /> : null}
        </ActionRow>
      ) : null}

      {status === "awaiting_plan_approval" ? (
        <ActionRow>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryAction label={t("selfdev.actions.buttonApprovePlan")} busy={busy === "approve-plan"} onClick={() => onAction("approve-plan")} />
            <SecondaryAction label={t("selfdev.actions.buttonRejectPlan")} busy={busy === "reject-plan"} onClick={() => onAction("reject-plan")} />
            <SecondaryAction label={t("common.cancel")} onClick={() => onAction("cancel")} />
          </div>
          {critical ? (
            <Acknowledgement
              label={t("selfdev.detail.ackPlanCritical")}
              checked={ackCritical}
              onChange={setAckCritical}
            />
          ) : null}
        </ActionRow>
      ) : null}

      {status === "awaiting_deploy_approval" ? (
        <ActionRow>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryAction label={t("selfdev.actions.buttonApproveDeploy")} busy={busy === "approve-deploy"} onClick={() => onAction("approve-deploy")} />
            <SecondaryAction label={t("common.cancel")} onClick={() => onAction("cancel")} />
          </div>
          <div className="mt-2 space-y-2">
            <Acknowledgement
              label={t("selfdev.detail.confirmDeployLabel")}
              checked={confirmDeploy}
              onChange={setConfirmDeploy}
            />
            {critical ? (
              <Acknowledgement
                label={t("selfdev.detail.ackDeployCritical")}
                checked={ackCritical}
                onChange={setAckCritical}
              />
            ) : null}
          </div>
        </ActionRow>
      ) : null}

      {(status === "completed" || status === "failed") ? (
        <ActionRow>
          <DangerAction label={t("selfdev.actions.buttonRollback")} busy={busy === "rollback"} onClick={() => onAction("rollback")} />
          <div className="mt-2">
            <Acknowledgement
              label={t("selfdev.detail.confirmRollbackLabel")}
              checked={confirmRollback}
              onChange={setConfirmRollback}
            />
          </div>
        </ActionRow>
      ) : null}

      {canCancel && !["workspace_preparing", "awaiting_plan_approval", "awaiting_deploy_approval", "completed", "failed"].includes(status) ? (
        <ActionRow>
          <SecondaryAction label={t("common.cancel")} onClick={() => onAction("cancel")} />
        </ActionRow>
      ) : null}

      {TERMINAL.has(status) && status !== "failed" ? (
        <p className="text-xs text-slate-400">{t("selfdev.detail.finishedNotice")}</p>
      ) : null}
    </div>
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function PrimaryAction({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) {
  const { t } = useAdminI18n();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="me-2 mb-2 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? t("common.working") : label}
    </button>
  );
}

function SecondaryAction({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) {
  const { t } = useAdminI18n();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="me-2 mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? t("common.working") : label}
    </button>
  );
}

function DangerAction({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) {
  const { t } = useAdminI18n();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="me-2 mb-2 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? t("common.working") : label}
    </button>
  );
}

function Acknowledgement({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span>{label}</span>
    </label>
  );
}

// ------------------------------------------------------------------
// Content sections
// ------------------------------------------------------------------

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function PromptBlock({ prompt }: { prompt: string }) {
  const { t } = useAdminI18n();
  return (
    <Section title={t("selfdev.prompt")} subtitle={t("selfdev.detail.promptSubtitle")}>
      <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">{prompt}</p>
    </Section>
  );
}

function PlanBlock({
  plan,
}: {
  plan: {
    goal: string;
    currentArchitecture: string;
    affectedFiles: string[];
    affectedSystems: string[];
    requiredChanges: string;
    potentialRisks: string;
    databaseChanges: string;
    apiChanges: string;
    uiChanges: string;
    securityImpact: string;
    testingStrategy: string;
    deploymentImpact: string;
    rollbackStrategy: string;
  };
}) {
  const { t } = useAdminI18n();
  return (
    <Section title={t("selfdev.plans.title")} subtitle={t("selfdev.plans.subtitle")}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("selfdev.plans.goal")} value={plan.goal} />
        <Field label={t("selfdev.plans.currentArchitecture")} value={plan.currentArchitecture} />
      </div>
      <Chips label={t("selfdev.plans.affectedFiles")} items={plan.affectedFiles} />
      <Chips label={t("selfdev.plans.affectedSystems")} items={plan.affectedSystems} />
      <Field label={t("selfdev.plans.requiredChanges")} value={plan.requiredChanges} full />
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t("selfdev.plans.database")} value={plan.databaseChanges} />
        <Field label={t("selfdev.plans.api")} value={plan.apiChanges} />
        <Field label={t("selfdev.plans.ui")} value={plan.uiChanges} />
      </div>
      <Field label={t("selfdev.plans.potentialRisks")} value={plan.potentialRisks} />
      <Field label={t("selfdev.plans.securityImpact")} value={plan.securityImpact} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("selfdev.plans.testingStrategy")} value={plan.testingStrategy} />
        <Field label={t("selfdev.plans.deploymentImpact")} value={plan.deploymentImpact} />
      </div>
      <Field label={t("selfdev.plans.rollbackStrategy")} value={plan.rollbackStrategy} full />
    </Section>
  );
}

function ReviewBlock({
  review,
}: {
  review: {
    result: string;
    summary: string;
    security: string;
    correctness: string;
    architecture: string;
    regressionRisk: string;
    performance: string;
    codeQuality: string;
    tests: string;
    databaseImpact: string;
    authImpact: string;
    deploymentImpact: string;
    reviewedAt: string;
  };
}) {
  const { t } = useAdminI18n();
  return (
    <Section title={t("selfdev.reviews.title")} subtitle={t("selfdev.reviews.subtitle")}>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ${
            review.result === "approved"
              ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
              : review.result === "blocked"
                ? "bg-red-100 text-red-700 ring-red-200"
                : "bg-amber-100 text-amber-800 ring-amber-200"
          }`}
        >
          {REVIEW_RESULT_LABELS[review.result] ? t(REVIEW_RESULT_LABELS[review.result]) : review.result.replace(/_/g, " ")}
        </span>
        <span className="text-[11px] text-slate-400">{formatDate(review.reviewedAt)}</span>
      </div>
      <Field label={t("selfdev.reviews.summary")} value={review.summary} full />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("selfdev.reviews.security")} value={review.security} />
        <Field label={t("selfdev.reviews.correctness")} value={review.correctness} />
        <Field label={t("selfdev.reviews.architecture")} value={review.architecture} />
        <Field label={t("selfdev.reviews.regressionRisk")} value={review.regressionRisk} />
        <Field label={t("selfdev.reviews.performance")} value={review.performance} />
        <Field label={t("selfdev.reviews.codeQuality")} value={review.codeQuality} />
        <Field label={t("selfdev.reviews.tests")} value={review.tests} />
        <Field label={t("selfdev.reviews.databaseImpact")} value={review.databaseImpact} />
        <Field label={t("selfdev.reviews.authImpact")} value={review.authImpact} />
        <Field label={t("selfdev.plans.deploymentImpact")} value={review.deploymentImpact} />
      </div>
    </Section>
  );
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-full" : ""}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{value || "—"}</dd>
    </div>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-4">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1.5 flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-sm text-slate-400">—</span>
        ) : (
          items.map((item) => (
            <code key={item} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
              {item}
            </code>
          ))
        )}
      </dd>
    </div>
  );
}