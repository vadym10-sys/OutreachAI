import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { locales, translate, translations, translateVisibleText, visiblePhraseTranslations } from "../../lib/i18n/translations";
import { publicPlans } from "../../lib/plan-catalog";

describe("pricing plans", () => {
  it("contains the required subscription tiers", () => {
    expect(["Starter", "Pro", "Agency"]).toEqual(["Starter", "Pro", "Agency"]);
  });

  it("matches backend billing prices and plan limits", () => {
    const dto = readFileSync(resolve(process.cwd(), "../api/app/schemas/dto.py"), "utf8");
    const billing = readFileSync(resolve(process.cwd(), "../api/app/services/billing.py"), "utf8");

    for (const plan of publicPlans) {
      const backendPlan = dto.match(new RegExp(`"${plan.name}": \\{([\\s\\S]*?)\\n    \\}`))?.[1] ?? "";
      const stripePlan = billing.match(new RegExp(`"${plan.name}": \\{([\\s\\S]*?)\\n    \\}`))?.[1] ?? "";

      expect(stripePlan).toContain(`"amount": ${plan.monthlyPrice * 100}`);
      expect(stripePlan).toContain(`"currency": "${plan.currency.toLowerCase()}"`);
      expect(stripePlan).toContain("14-day free trial");
      expect(backendPlan).toContain(`"mrr": ${plan.monthlyPrice}`);
      expect(backendPlan).toContain(`"leads": ${plan.limits.leads}`);
      expect(backendPlan).toContain(`"ai_generations": ${plan.limits.aiGenerations}`);
      expect(backendPlan).toContain(`"email_sends": ${plan.limits.emailSends}`);
      expect(backendPlan).toContain(`"sales_employees": ${plan.limits.salesEmployees}`);
      expect(backendPlan).toContain(`"workspaces": ${plan.limits.workspaces}`);
      expect(backendPlan).toContain(`"team_members": ${plan.limits.teamMembers}`);
      expect(backendPlan).toContain(`"campaigns": ${plan.limits.campaigns}`);
    }
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
      "No critical improvement needed right now.",
    ];

    for (const phrase of phrases) {
      expect(translateVisibleText(phrase, "ru")).not.toBe(phrase);
    }
  });

  it("localizes the conversion preview and avoids public vendor names", () => {
    const phrases = [
      "Business description",
      "Company with evidence",
      "Manual confirmation",
      "Demo evidence uses safe fixture data, not customer production records.",
      "Insufficient data stays visible and is routed to manual review.",
      "Prices and limits come from the billing catalogue used by the application. All plans renew monthly after the 14-day trial unless canceled.",
      "Secure authentication",
      "Workspace billing",
      "Questions before signing up?",
      "Use the confirmed project contact for support, privacy or security questions.",
    ];

    for (const phrase of phrases) {
      expect(translateVisibleText(phrase, "ru"), phrase).not.toBe(phrase);
    }

    expect(translateVisibleText("Secure authentication", "ru")).not.toMatch(/Clerk/i);
    expect(translateVisibleText("Workspace billing", "ru")).not.toMatch(/Stripe/i);
  });

  it("localizes public legal and support text in Russian and English", () => {
    const publicPhrases = [
      "Privacy Policy",
      "Terms of Service",
      "Selected plan",
      "Unknown plan selected",
      "Information we collect",
      "Privacy and security requests should be sent to the confirmed support email listed in the public footer and contact section.",
      "The billing implementation uses monthly Stripe subscription checkout with a 14-day trial. Users can manage or cancel active subscriptions through the billing portal when a subscription is active.",
      "Generated emails are drafts first. Sending requires an approved email and a verified recipient path in the application.",
    ];

    for (const phrase of publicPhrases) {
      expect(translateVisibleText(phrase, "ru"), phrase).not.toBe(phrase);
      expect(translateVisibleText(translateVisibleText(phrase, "ru"), "en"), phrase).toBe(phrase);
    }
  });

  it("keeps AI company intelligence guidance fully Russian", () => {
    const phrases = [
      "The company matches the selected target market; verify the website and contact before outreach.",
      "Potential fit is not proven yet; verify the company website and decision maker before spending sales time.",
      "OutreachAI can turn the saved company profile into a researched, review-ready outreach path without manual tab switching.",
      "Useful starter brief; connect or verify the missing data before sending outreach.",
      "Company profile is saved and scoped to this workspace.",
      "AI research explains the sales angle.",
      "Selected decision maker role is available.",
      "Decision maker is not verified yet.",
      "Technology stack is unavailable until a technographic source is connected.",
      "Connect company enrichment to improve firmographics and decision-maker coverage.",
      "Connect technographic enrichment to personalize the sales angle by website stack.",
      "AI prepared the sales brief and draft. Add a known business email to approve and send safely.",
      "Finding decision makers and verified email...",
      "Data used for this brief",
    ];
    const forbidden = /\b(workspace|outreach|sales|brief|decision maker|technographic|firmographics|company enrichment)\b/i;

    for (const phrase of phrases) {
      const translated = translateVisibleText(phrase, "ru");
      expect(translated, phrase).not.toBe(phrase);
      expect(translated, phrase).not.toMatch(forbidden);
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
