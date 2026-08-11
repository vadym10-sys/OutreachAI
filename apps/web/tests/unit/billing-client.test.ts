import { describe, expect, it } from "vitest";

import { billingAlreadyActive } from "@/components/billing-client";
import type { BillingStatus } from "@/lib/types";

const baseStatus: BillingStatus = {
  plan: "Starter",
  price: 49,
  status: "inactive",
  all_features_enabled: false,
  entitlement_source: "none",
  test_entitlement: false,
  trial_end: null,
  current_period_end: null,
  trial_days_remaining: 0,
  stripe_customer_id: "",
  stripe_subscription_id: "",
  limits: {},
  usage: {},
  sales_employees_used: 0,
  workspaces_used: 0,
};

describe("billingAlreadyActive", () => {
  it("blocks checkout creation for server-authoritative active states", () => {
    expect(billingAlreadyActive({ ...baseStatus, entitlement_source: "stripe", status: "trialing" })).toBe(true);
    expect(billingAlreadyActive({ ...baseStatus, entitlement_source: "stripe", status: "active" })).toBe(true);
    expect(billingAlreadyActive({ ...baseStatus, entitlement_source: "owner_granted_test", test_entitlement: true })).toBe(true);
  });

  it("does not treat query or local pending state as billing authority", () => {
    expect(billingAlreadyActive(baseStatus)).toBe(false);
    expect(billingAlreadyActive({ ...baseStatus, entitlement_source: "none", status: "inactive" })).toBe(false);
  });
});
