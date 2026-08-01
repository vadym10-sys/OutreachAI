import { describe, expect, it } from "vitest";
import { commandToCriteria, missingQuestion } from "@/components/ai-first-workspace";

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
  it("keeps local service companies as the requested audience", () => {
    const criteria = commandToCriteria(
      "Find 5 real local service companies in Poland, such as cleaning companies, accounting firms, and construction services.",
      blankAdvanced
    );

    expect(criteria.targetIndustry).toBe("Local services");
    expect(criteria.desiredCustomers).toContain("real local service companies in Poland");
    expect(criteria.desiredCustomers).toContain("cleaning companies");
    expect(criteria.desiredCustomers).not.toContain("B2B SaaS companies");
  });

  it("keeps an explicitly requested country", () => {
    const criteria = commandToCriteria("Find 5 real local service companies in Poland", blankAdvanced);

    expect(criteria.targetCountry).toBe("Poland");
    expect(criteria.desiredCustomers).toContain("in Poland");
  });

  it("uses the requested number of companies", () => {
    const criteria = commandToCriteria("Find 5 real local service companies in Poland", blankAdvanced);

    expect(criteria.maxResults).toBe(5);
  });

  it("still recognizes an actual SaaS search as SaaS", () => {
    const criteria = commandToCriteria("Find 8 B2B SaaS companies in Germany that sell CRM software", blankAdvanced);

    expect(criteria.targetCountry).toBe("Germany");
    expect(criteria.targetIndustry).toBe("B2B SaaS");
    expect(criteria.desiredCustomers).toContain("B2B SaaS companies in Germany");
    expect(criteria.maxResults).toBe(8);
  });

  it("asks for more context when the command is empty or too short", () => {
    expect(missingQuestion("")).toBeTruthy();
    expect(missingQuestion("SaaS")).toBeTruthy();
  });
});
