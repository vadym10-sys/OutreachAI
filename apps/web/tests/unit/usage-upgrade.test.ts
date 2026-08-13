import { describe, expect, it } from "vitest";

import { canonicalUsageMetrics, chooseUsageAction, limitFromCatalog, planLimitExceededMessage } from "@/lib/usage-upgrade";
import { translate } from "@/lib/i18n/translations";
import type { BillingPlan, BillingStatus } from "@/lib/types";

const plans: BillingPlan[] = [
  { name: "Starter", price: 49, limits: { leads: 500 }, current: true, active_subscription: true, upgrade_to: ["Pro"] },
  { name: "Pro", price: 149, limits: { leads: 5000 }, current: false, active_subscription: true, upgrade_to: ["Agency"] },
  { name: "Agency", price: 499, limits: { leads: 50000 }, current: false, active_subscription: true, upgrade_to: [] }
];

function status(overrides: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "Starter",
    price: 49,
    status: "active",
    entitlement_source: "stripe",
    trial_end: "2026-08-20T00:00:00Z",
    current_period_end: "2026-09-01T00:00:00Z",
    trial_days_remaining: 7,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    limits: {
      leads: 500,
      ai_generations: 1000,
      email_sends: 1000,
      sales_employees: 1,
      team_members: 1,
      workspaces: 1,
      advanced_analytics: false
    },
    usage: { leads: 10, ai_generations: 100, email_sends: 100 },
    sales_employees_used: 0,
    workspaces_used: 1,
    ...overrides
  };
}

describe("usage upgrade UX helpers", () => {
  it("marks normal, warning, and reached usage states from canonical API data", () => {
    const metrics = canonicalUsageMetrics(status({
      usage: { leads: 50, ai_generations: 800, email_sends: 1000 },
      sales_employees_used: 1
    }));

    expect(metrics.find((metric) => metric.key === "leads")).toMatchObject({ state: "normal", remaining: 450, percentage: 10 });
    expect(metrics.find((metric) => metric.key === "ai_generations")).toMatchObject({ state: "warning", remaining: 200, percentage: 80 });
    expect(metrics.find((metric) => metric.key === "email_sends")).toMatchObject({ state: "reached", remaining: 0, percentage: 100 });
    expect(metrics.find((metric) => metric.key === "advanced_analytics")).toMatchObject({ state: "reached", included: false });
  });

  it("uses Starter, Pro, and Agency catalog entries for upgrade action selection", () => {
    expect(chooseUsageAction(plans, status({ plan: "Starter" }))).toMatchObject({ kind: "upgrade", plan: "Pro" });
    expect(chooseUsageAction(plans, status({ plan: "Pro" }))).toMatchObject({ kind: "upgrade", plan: "Agency" });
    expect(chooseUsageAction(plans, status({ plan: "Agency" }))).toMatchObject({ kind: "manage_billing" });
  });

  it("selects manage billing or support for inactive and canceled billing states", () => {
    expect(chooseUsageAction(plans, status({ status: "inactive", stripe_customer_id: "cus_1" }))).toMatchObject({ kind: "manage_billing" });
    expect(chooseUsageAction(plans, status({ status: "canceled", stripe_customer_id: "" }))).toMatchObject({ kind: "contact_support" });
  });

  it("keeps copy buyer-friendly and localizable in English and Polish", () => {
    const message = planLimitExceededMessage({ metric: "leads", plan: "Starter", limit: 500, current: 500, requested: 1 });
    expect(message).toContain("You've used all 500 of 500 leads included in Starter.");
    expect(message).not.toMatch(/reservation|row lock|idempotency|usage counter|migration/i);
    expect(translate("Limit reached", "pl")).toBe("Limit osiągnięty");
    expect(translate("Upgrade to continue finding and saving new leads.", "pl")).toBe("Zmień plan, aby dalej znajdować i zapisywać nowe leady.");
  });

  it("does not introduce hard-coded allowances outside catalog data", () => {
    const apiLimits = { leads: 1234, ai_generations: 5678 };
    expect(limitFromCatalog(apiLimits, "leads")).toBe(1234);
    expect(limitFromCatalog(apiLimits, "ai_generations")).toBe(5678);
  });
});
