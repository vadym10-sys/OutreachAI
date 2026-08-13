import { afterEach, describe, expect, it, vi } from "vitest";
import { authSessionPendingMessage, clientApi, clientApiBlob, clientApiWithHeaders, friendlyErrorMessage } from "../../lib/client-api";
import { containsSensitiveTechnicalInfo, sanitizeUserMessage } from "../../lib/safe-errors";
import { scrubSentryEvent } from "../../lib/sentry-common";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client API errors", () => {
  it("hides provider names, status codes, endpoints, and secrets from user messages", () => {
    const unsafeMessages = [
      "REQUEST_FAILED:Google Places API quota exceeded on /api/leads/find with HTTP 429",
      "REQUEST_FAILED:OpenAI timeout while calling model gpt-5.5",
      "REQUEST_FAILED:401 Missing Bearer Token",
      "REQUEST_FAILED:PostgreSQL connection failed for DATABASE_URL",
      "REQUEST_FAILED:Resend returned HTTP 500",
      "REQUEST_FAILED:{\"detail\":\"Hunter rejected the backend API key\"}",
    ];

    for (const message of unsafeMessages) {
      const safe = friendlyErrorMessage(new Error(message), "Something went wrong while processing your request. Please try again.");
      expect(containsSensitiveTechnicalInfo(safe)).toBe(false);
      expect(safe).not.toMatch(/api|http|openai|google|hunter|resend|postgres|bearer|database_url|\/api|401|429|500|json/i);
    }
  });

  it("keeps no-results guidance visible to the user", () => {
    const error = new Error("REQUEST_FAILED:No companies found. Try a broader industry, larger company size, or remove the city filter.");
    expect(friendlyErrorMessage(error, "Lead search could not be completed.")).toBe(
      "No companies were found. Try a broader location, industry, or company size."
    );
  });

  it("keeps campaign readiness guidance instead of replacing it with a generic AI error", () => {
    const error = new Error("REQUEST_FAILED:Approve at least one email draft before launching this campaign.");
    expect(friendlyErrorMessage(error, "Campaign status could not be updated.")).toBe(
      "Approve at least one email draft before launching this campaign."
    );
  });

  it("keeps recipient validation guidance instead of replacing it with a provider error", () => {
    const error = new Error("REQUEST_FAILED:Use a real recipient email before sending.");
    expect(friendlyErrorMessage(error, "Email could not be sent.")).toBe("Use a real recipient email before sending.");
  });

  it("maps structured plan limits to buyer-friendly upgrade copy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "plan_limit_exceeded",
            metric: "leads",
            plan: "Starter",
            limit: 500,
            current: 500,
            requested: 1
          }
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    );

    await expect(clientApi("/api/workspace-app/leads/search", "token", { method: "POST" })).rejects.toMatchObject({
      message: "REQUEST_FAILED:You've used all 500 of 500 leads included in Starter. Upgrade to continue finding and saving new leads.",
      status: 402
    });
  });

  it("maps usage state conflicts to a no-charge message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "usage_reservation_state_error", message: "Reserved usage cannot be finalized twice." } }),
        { status: 409, headers: { "content-type": "application/json" } }
      )
    );

    await expect(clientApi("/api/workspace-app/emails/email_1/send", "token", { method: "POST" })).rejects.toMatchObject({
      message: "REQUEST_FAILED:This action was not completed, and your usage was not charged. Please try again in a moment.",
      status: 409
    });
  });

  it("uses ambiguity-safe copy for uncertain email delivery", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Email delivery could not be confirmed. Check mailbox before retry." }),
        { status: 503, headers: { "content-type": "application/json" } }
      )
    );

    await expect(clientApi("/api/workspace-app/emails/email_1/send", "token", { method: "POST" })).rejects.toMatchObject({
      message: "REQUEST_FAILED:Email delivery could not be confirmed. Check the mailbox before recovering or sending again.",
      status: 503
    });
  });

  it("uses a safe fallback for unknown raw technical failures", () => {
    expect(sanitizeUserMessage("Traceback: SQLAlchemy failed with HTTP 500", "Please try again.")).toBe("Please try again.");
  });

  it("routes customer API calls through the same-origin proxy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(clientApi<{ ok: boolean }>("/api/workspace-app/leads/search", "token", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/backend/api/workspace-app/leads/search");
  });

  it("does not classify a missing protected-route token as a signed-out session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(clientApi("/api/workspace/me", null)).rejects.toMatchObject({
      message: `REQUEST_FAILED:${authSessionPendingMessage}`,
      status: 425
    });
    await expect(clientApiWithHeaders("/api/workspace/me", null)).rejects.toMatchObject({
      message: `REQUEST_FAILED:${authSessionPendingMessage}`,
      status: 425
    });
    await expect(clientApiBlob("/api/workspace/me", null)).rejects.toMatchObject({
      message: `REQUEST_FAILED:${authSessionPendingMessage}`,
      status: 425
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a transient opportunity completion timeout once", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: "We could not finish this action in time. Your company is saved. Please retry the missing steps.",
            request_id: "req-timeout"
          }),
          {
            status: 504,
            headers: { "content-type": "application/json", "x-request-id": "req-timeout" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    await expect(
      clientApi<{ ok: boolean }>("/api/workspace-app/companies/company_1/complete-opportunity", "token", {
        method: "POST",
        retries: 1,
        retryDelayMs: 0
      })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/backend/api/workspace-app/companies/company_1/complete-opportunity");
  });

  it("retries transient GET failures once by default", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: "Something went wrong while processing your request. Please try again." }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    await expect(clientApi<{ ok: boolean }>("/api/dashboard", "token", { retryDelayMs: 0 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("scrubs Sentry request, extra, context, and user data before telemetry leaves the browser", () => {
    const event = scrubSentryEvent({
      message: "Failed to send message to customer@example.com with Bearer token",
      exception: {
        values: [
          { value: "Email draft for prospect@example.com contains private content" }
        ]
      },
      breadcrumbs: [
        {
          category: "api",
          message: "POST /api/workspace-app/emails with customer@example.com",
          data: { authorization: "Bearer token", safe_id: "req_1" }
        }
      ],
      request: {
        headers: { authorization: "Bearer token", cookie: "sid=secret", "x-request-id": "req_1" },
        cookies: { sid: "secret" },
        data: { email_body: "Hi person@example.com" }
      },
      extra: {
        response_detail: "customer@example.com",
        status: 500
      },
      contexts: {
        outreachai: { body: "private email content", endpoint: "/api/workspace-app/emails" }
      },
      user: {
        email: "customer@example.com",
        id: "user_1"
      }
    });

    expect(event.message).toBe("[Filtered]");
    expect(event.exception?.values?.[0]?.value).toBe("[Filtered]");
    expect(event.breadcrumbs?.[0]?.message).toBe("[Filtered]");
    expect(event.breadcrumbs?.[0]?.data).toMatchObject({ authorization: "[Filtered]", safe_id: "req_1" });
    expect(event.request?.headers?.authorization).toBe("[Filtered]");
    expect(event.request?.headers?.cookie).toBe("[Filtered]");
    expect(event.request?.headers?.["x-request-id"]).toBe("req_1");
    expect(event.request?.cookies).toEqual({ filtered: "[Filtered]" });
    expect(event.request?.data).toBe("[Filtered]");
    expect(event.extra?.response_detail).toBe("[Filtered]");
    expect(event.contexts?.outreachai).toMatchObject({ body: "[Filtered]", endpoint: "/api/workspace-app/emails" });
    expect(event.user?.email).toBe("[Filtered]");
    expect(event.user?.id).toBe("user_1");
  });
});
