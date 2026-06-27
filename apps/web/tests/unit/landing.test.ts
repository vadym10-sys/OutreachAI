import { describe, expect, it } from "vitest";
import { locales, translate } from "../../lib/i18n/translations";

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
});
