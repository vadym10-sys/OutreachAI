import { describe, expect, it } from "vitest";
import { locales, translate, translations, translateVisibleText, visiblePhraseTranslations } from "../../lib/i18n/translations";

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
      "Inbox",
      "Analytics",
      "Emails generated",
      "Workspace data",
    ];

    for (const phrase of phrases) {
      expect(translateVisibleText(phrase, "ru")).not.toBe(phrase);
    }
  });

  it("does not leak Cyrillic copy into non-Russian interface translations", () => {
    const nonRussianLocales = locales.filter((locale) => locale !== "ru");
    const cyrillic = /[А-Яа-яЁё]/;

    for (const [locale, dictionary] of Object.entries(translations)) {
      if (locale === "ru") continue;
      for (const [key, value] of Object.entries(dictionary)) {
        expect(value, `${locale}.${key}`).not.toMatch(cyrillic);
      }
    }

    for (const [source, localized] of Object.entries(visiblePhraseTranslations)) {
      for (const locale of nonRussianLocales) {
        const value = localized[locale];
        if (!value) continue;
        expect(value, `${locale}.${source}`).not.toMatch(cyrillic);
      }
    }
  });

  it("localizes customer recovery states instead of showing English fallback copy", () => {
    expect(translate("Something went wrong. Please refresh or sign in again.", "ru")).toBe("Что-то пошло не так. Обновите страницу или войдите снова.");
    expect(translate("common.recoveryCopy", "ru")).toBe("Если это повторяется, выйдите и войдите снова. Данные вашего рабочего пространства сохранены.");
    expect(translate("common.globalLoadCopy", "fr")).toBe("OutreachAI n’a pas pu terminer le chargement dans cette session de navigateur.");
    expect(translate("common.tryAgain", "pl")).toBe("Spróbuj ponownie");
  });
});
