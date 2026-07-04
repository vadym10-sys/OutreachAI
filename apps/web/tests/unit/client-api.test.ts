import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "../../lib/client-api";
import { containsSensitiveTechnicalInfo, sanitizeUserMessage } from "../../lib/safe-errors";

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

  it("uses a safe fallback for unknown raw technical failures", () => {
    expect(sanitizeUserMessage("Traceback: SQLAlchemy failed with HTTP 500", "Please try again.")).toBe("Please try again.");
  });
});
