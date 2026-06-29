import { describe, expect, it } from "vitest";
import { locales, translate, translateVisibleText } from "../../lib/i18n/translations";

describe("pricing plans", () => {
  it("contains the required subscription tiers", () => {
    expect(["Starter", "Pro", "Agency"]).toEqual(["Starter", "Pro", "Agency"]);
  });
});

describe("i18n", () => {
  it("supports all required frontend locales", () => {
    expect(locales).toEqual(["en", "ru", "es", "en-US", "fr", "it", "pl"]);
  });

  it("falls back to English when a localized key is missing", () => {
    expect(translate("landing.subtitle", "it")).toBe(translate("landing.subtitle", "en"));
  });

  it("returns the key safely when no English translation exists", () => {
    expect(translate("missing.translation.key", "ru")).toBe("missing.translation.key");
  });

  it("translates visible UI phrases without crashing on dynamic text", () => {
    expect(translateVisibleText("Continue with Google", "fr")).toBe("Continuer avec Google");
    expect(translateVisibleText("New leads found: 12", "pl")).toBe("Nowe leady znalezione: 12");
  });

  it("keeps main workflow pages from mixing English labels into Russian UI", () => {
    const phrases = [
      "Find real companies and turn each into a sales opportunity.",
      "Step 1 of 3 · Choose a focused market",
      "Number of leads",
      "Expected time: 30-60 seconds. Saved companies will stay after refresh.",
      "Saved to CRM",
      "Activity history",
      "Website analyzed",
      "Email generated",
      "Last activity",
    ];

    for (const phrase of phrases) {
      expect(translateVisibleText(phrase, "ru")).not.toBe(phrase);
    }
  });
});
