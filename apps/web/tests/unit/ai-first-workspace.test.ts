import { describe, expect, it } from "vitest";
import { commandToCriteria } from "@/components/ai-first-workspace";

const blankAdvanced = {
  targetCountry: "",
  targetIndustry: "",
  companySize: "",
  contactTitles: [],
  keywords: [],
  exclusions: [],
  maxResults: 10
};

describe("AI first workspace command parsing", () => {
  it("keeps a natural-language customer search as the requested audience", () => {
    const criteria = commandToCriteria(
      "E2E_TEST_20260729_qa_owner_2 Find 5 real local service companies in Poland, such as marketing agencies, cleaning companies, accounting firms, and construction services, that need more B2B clients and could use OutreachAI for customer finding and personalized email outreach.",
      blankAdvanced
    );

    expect(criteria.targetCountry).toBe("Poland");
    expect(criteria.targetIndustry).toBe("Local services");
    expect(criteria.desiredCustomers).toContain("real local service companies in Poland");
    expect(criteria.desiredCustomers).toContain("marketing agencies");
    expect(criteria.desiredCustomers).not.toContain("B2B SaaS companies in Poland with public timing");
  });
});
