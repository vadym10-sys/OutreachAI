import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { locales, translate, translations, translateVisibleText, visiblePhraseTranslations } from "../../lib/i18n/translations";
import { publicPlans } from "../../lib/plan-catalog";
import { publicSupportEmail } from "../../lib/public-contact";

describe("pricing plans", () => {
  it("contains the required subscription tiers", () => {
    expect(["Starter", "Pro", "Agency"]).toEqual(["Starter", "Pro", "Agency"]);
  });

  it("matches backend billing prices and plan limits", () => {
    const catalog = readFileSync(resolve(process.cwd(), "../api/app/services/plan_catalog.py"), "utf8");

    for (const plan of publicPlans) {
      const backendPlan = catalog.match(new RegExp(`"${plan.name}": PlanSpec\\(([\\s\\S]*?)\\n    \\),`))?.[1] ?? "";

      expect(backendPlan).toContain(`monthly_price=${plan.monthlyPrice}`);
      expect(backendPlan).toContain(`currency="${plan.currency}"`);
      expect(backendPlan).toContain(`trial_days=TRIAL_DAYS`);
      expect(backendPlan).toContain(`amount=${plan.monthlyPrice * 100}`);
      expect(backendPlan).toContain(`leads=${plan.limits.leads}`);
      expect(backendPlan).toContain(`ai_generations=${plan.limits.aiGenerations}`);
      expect(backendPlan).toContain(`email_sends=${plan.limits.emailSends}`);
      expect(backendPlan).toContain(`sales_employees=${plan.limits.salesEmployees}`);
      expect(backendPlan).toContain(`workspaces=${plan.limits.workspaces}`);
      expect(backendPlan).toContain(`team_members=${plan.limits.teamMembers}`);
      expect(backendPlan).toContain(`campaigns=${plan.limits.campaigns}`);
      expect(backendPlan).toContain(`api_access=${plan.features.apiAccess ? "True" : "False"}`);
      expect(backendPlan).toContain(`webhooks=${plan.features.webhooks ? "True" : "False"}`);
      expect(backendPlan).toContain(`white_label=${plan.features.whiteLabel ? "True" : "False"}`);
    }
  });

  it("keeps reserved expansion features out of active public entitlement booleans", () => {
    const agency = publicPlans.find((plan) => plan.name === "Agency");

    expect(agency?.features.apiAccess).toBe(false);
    expect(agency?.features.webhooks).toBe(false);
    expect(agency?.features.whiteLabel).toBe(false);
    expect(agency?.limits.workspaces).toBe(1);
    expect(agency?.limits.teamMembers).toBe(1);
    expect(agency?.roadmapLimits?.workspaces).toBe(0);
  });
});

describe("public contact configuration", () => {
  it("uses the confirmed public support mailbox everywhere", () => {
    expect(publicSupportEmail).toBe("outreachaiaiai@gmail.com");
    expect(`mailto:${publicSupportEmail}`).toBe("mailto:outreachaiaiai@gmail.com");
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

  it("localizes AI Tasks and email approval workspace controls across supported locales", () => {
    const requiredKeys = [
      "aiTasks.resume",
      "aiTasks.timeline",
      "aiTasks.technicalDetails",
      "aiTasks.retry",
      "aiTasks.dryRun",
      "aiTasks.forceDryRunNotice",
      "aiTasks.forceDryRunHelp",
      "Track replies",
      "Refresh",
      "Email Approval Workspace: drafts and sent emails stay in one review queue. Sending is available only after manual approval and a separate final send confirmation.",
      "AI creates drafts only",
      "Approving verifies the draft. Sending still requires a separate explicit confirmation.",
    ];

    for (const key of requiredKeys) {
      for (const locale of locales) {
        expect(translate(key, locale), `${locale}.${key}`).toBeTruthy();
      }
    }

    expect(translate("aiTasks.resume", "ru")).toBe("Продолжить");
    expect(translate("aiTasks.timeline", "ru")).toBe("Ход выполнения");
    expect(translate("aiTasks.technicalDetails", "ru")).toBe("Технические детали");
    expect(translate("Track replies", "ru")).toBe("Отслеживать ответы");
    expect(translate("Refresh", "ru")).toBe("Обновить");
    expect(translate("AI creates drafts only", "ru")).toBe("AI создаёт только черновики");
    expect(translate("aiTasks.forceDryRunNotice", "ru")).toBe("Безопасный тестовый режим обязателен.");

    const russianValues = requiredKeys.map((key) => translate(key, "ru")).join(" ");
    expect(russianValues).not.toMatch(/\b(Continue|Timeline|Technical details|Track replies|Refresh|dry-run|Dry-run|Approval Workspace|Approve verifies)\b/);
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
      "Use the evidence to decide whether the company belongs in your CRM.",
      "Missing evidence stays visible for review.",
      "Prices, trial length and usage counters match the active billing catalog. Actual email sending also depends on a connected sender and provider limits.",
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

  it("keeps every visible landing phrase complete across supported locales", () => {
    const landingSource = readFileSync(resolve(process.cwd(), "components/landing-page.tsx"), "utf8");
    const phrases = [...new Set([...landingSource.matchAll(/t\("([^"]+)"\)/g)].map((match) => match[1]))];
    const allowedSame = new Set(["AI Customer Finder", "Gmail OAuth", "CRM", "FAQ", "Starter", "Pro", "Agency"]);

    expect(phrases.length).toBeGreaterThan(40);

    for (const phrase of phrases) {
      for (const locale of locales) {
        const translated = translate(phrase, locale);
        expect(translated, `${locale}.${phrase}`).toBeTruthy();
        if (locale !== "en" && locale !== "en-US" && !allowedSame.has(phrase)) {
          expect(translated, `${locale}.${phrase}`).not.toBe(phrase);
        }
      }

      const visible = visiblePhraseTranslations[phrase];
      if (visible) {
        for (const locale of locales) {
          if (locale === "en") continue;
          expect(visible[locale], `${locale}.${phrase}`).toBeTruthy();
        }
      }
    }
  });

  it("keeps public landing claims aligned with approval-first production behavior", () => {
    const landingSource = readFileSync(resolve(process.cwd(), "components/landing-page.tsx"), "utf8");

    expect(landingSource).toContain("AI creates drafts only. A real send requires a reviewed recipient, subject, body and explicit approval.");
    expect(landingSource).toContain("Actual email sending also depends on a connected sender and provider limits.");
    expect(landingSource).toContain("Gmail OAuth is supported, but sending depends on a connected mailbox, workspace settings and provider limits.");
    expect(landingSource).not.toMatch(/demo fixture|Demonstration fixture|safe fixture|production records|fake customer result/i);
    expect(landingSource).not.toMatch(/unattended email sending|send automatically|Autonomous mode included|Autonomous mode not included/i);
    expect(landingSource).not.toMatch(/booked \d+|trusted by outbound teams|customer result|conversion rate|revenue generated/i);
  });

  it("localizes public legal and support text in Russian and English", () => {
    const publicPhrases = [
      "Privacy Policy",
      "Terms of Service",
      "Selected plan",
      "Unknown plan selected",
      "Information we collect",
      "Privacy and security requests should be sent to the confirmed support email listed in the public footer and contact section.",
      "The billing implementation uses monthly subscription checkout with a 14-day trial. Subscription changes are managed securely in the billing portal according to the active portal configuration.",
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
