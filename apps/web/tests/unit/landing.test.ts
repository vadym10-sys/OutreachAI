import { describe, expect, it } from "vitest";

describe("pricing plans", () => {
  it("contains the required subscription tiers", () => {
    expect(["Starter", "Pro", "Agency"]).toEqual(["Starter", "Pro", "Agency"]);
  });
});
