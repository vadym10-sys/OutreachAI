import type { BillingPlan, BillingStatus, PlanLimits } from "@/lib/types";

export type UsageMetricKey =
  | "leads"
  | "ai_generations"
  | "email_sends"
  | "sales_employees"
  | "team_members"
  | "workspaces"
  | "advanced_analytics";

export type UsageMetricState = "normal" | "warning" | "reached";

export type UsageMetricView = {
  key: UsageMetricKey;
  label: string;
  used: number | null;
  limit: number | boolean | null;
  remaining: number | null;
  percentage: number | null;
  state: UsageMetricState;
  included: boolean;
};

export type UsageActionKind = "upgrade" | "manage_billing" | "contact_support";

export type UsageAction = {
  kind: UsageActionKind;
  label: string;
  plan?: string;
};

export type PlanLimitErrorDetail = {
  code?: string;
  metric?: string;
  plan?: string;
  limit?: number;
  current?: number;
  requested?: number;
  message?: string;
};

const metricLabels: Record<UsageMetricKey, string> = {
  leads: "leads",
  ai_generations: "AI generations",
  email_sends: "reviewed email sends",
  sales_employees: "AI sales employees",
  team_members: "workspace members",
  workspaces: "workspaces",
  advanced_analytics: "advanced analytics"
};

const metricUpgradeReasons: Partial<Record<UsageMetricKey, string>> = {
  leads: "Upgrade to continue finding and saving new leads.",
  ai_generations: "Upgrade to continue generating AI research and drafts.",
  email_sends: "Upgrade to continue sending reviewed emails.",
  sales_employees: "Upgrade to add another AI sales employee.",
  team_members: "Upgrade to add more workspace members.",
  workspaces: "Contact support to expand workspace access safely.",
  advanced_analytics: "Upgrade to use advanced analytics."
};

export function usageMetricLabel(metric: string | undefined) {
  const key = String(metric || "") as UsageMetricKey;
  return metricLabels[key] || String(metric || "this feature").replaceAll("_", " ");
}

export function usageMetricUpgradeReason(metric: string | undefined) {
  const key = String(metric || "") as UsageMetricKey;
  return metricUpgradeReasons[key] || "Upgrade to continue.";
}

function countableMetric(key: UsageMetricKey, status: BillingStatus): UsageMetricView {
  const usedByKey: Partial<Record<UsageMetricKey, number>> = {
    leads: Number(status.usage.leads || 0),
    ai_generations: Number(status.usage.ai_generations || 0),
    email_sends: Number(status.usage.email_sends || 0),
    sales_employees: Number(status.sales_employees_used || 0),
    team_members: Number(status.workspaces_used || 0),
    workspaces: Number(status.workspaces_used || 0)
  };
  const rawLimit = status.limits[key];
  const limit = typeof rawLimit === "number" || typeof rawLimit === "boolean" ? rawLimit : null;
  const used = usedByKey[key] ?? 0;
  const cappedLimit = typeof limit === "number" && limit > 0 ? limit : null;
  const percentage = cappedLimit ? Math.min(100, Math.round((used / cappedLimit) * 100)) : null;
  const remaining = cappedLimit ? Math.max(0, cappedLimit - used) : null;
  const state: UsageMetricState = percentage === null
    ? "normal"
    : percentage >= 100
      ? "reached"
      : percentage >= 80
        ? "warning"
        : "normal";
  return {
    key,
    label: metricLabels[key],
    used,
    limit,
    remaining,
    percentage,
    state,
    included: limit !== false
  };
}

export function canonicalUsageMetrics(status: BillingStatus): UsageMetricView[] {
  const countable: UsageMetricKey[] = ["leads", "ai_generations", "email_sends", "sales_employees", "team_members"];
  const analyticsIncluded = status.limits.advanced_analytics === true;
  return [
    ...countable.map((key) => countableMetric(key, status)),
    {
      key: "advanced_analytics",
      label: metricLabels.advanced_analytics,
      used: null,
      limit: analyticsIncluded,
      remaining: null,
      percentage: analyticsIncluded ? 100 : 0,
      state: analyticsIncluded ? "normal" : "reached",
      included: analyticsIncluded
    }
  ];
}

export function highestReachedMetric(metrics: UsageMetricView[]) {
  return metrics.find((metric) => metric.state === "reached") || metrics.find((metric) => metric.state === "warning") || null;
}

export function higherActivePlan(plans: BillingPlan[], status: BillingStatus | null | undefined) {
  if (!status) return null;
  const currentPlan = plans.find((plan) => plan.name === status.plan);
  const upgradeNames = currentPlan?.upgrade_to || [];
  return upgradeNames.map((name) => plans.find((plan) => plan.name === name)).find(Boolean) || null;
}

export function chooseUsageAction(plans: BillingPlan[], status: BillingStatus | null | undefined): UsageAction {
  if (!status) return { kind: "contact_support", label: "Contact support" };
  const lifecycle = String(status.status || "").toLowerCase();
  if (["inactive", "past_due", "incomplete", "unpaid", "canceled", "cancelled"].includes(lifecycle)) {
    return status.stripe_customer_id
      ? { kind: "manage_billing", label: "Manage billing" }
      : { kind: "contact_support", label: "Contact support" };
  }
  const nextPlan = higherActivePlan(plans, status);
  if (nextPlan) return { kind: "upgrade", label: `Upgrade to ${nextPlan.name}`, plan: nextPlan.name };
  if (status.stripe_customer_id) return { kind: "manage_billing", label: "Manage billing" };
  return { kind: "contact_support", label: "Contact support" };
}

export function planLimitExceededMessage(detail: PlanLimitErrorDetail) {
  const metric = usageMetricLabel(detail.metric);
  const plan = detail.plan || "your plan";
  const limit = Number(detail.limit || 0);
  const used = Number(detail.current || 0);
  const countText = limit > 0 ? `${used.toLocaleString()} of ${limit.toLocaleString()}` : "the allowance";
  return `You've used all ${countText} ${metric} included in ${plan}. ${usageMetricUpgradeReason(detail.metric)}`;
}

export function actionNotChargedMessage() {
  return "This action was not completed, and your usage was not charged. Please try again in a moment.";
}

export function emailAmbiguitySafeMessage() {
  return "Email delivery could not be confirmed. Check the mailbox before recovering or sending again.";
}

export function limitFromCatalog(limits: PlanLimits, key: UsageMetricKey) {
  return limits[key];
}
