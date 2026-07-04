const sensitivePattern = /\b(openai|google maps|google places|places api|hunter|apollo|resend|clerk|postgres|postgresql|railway|vercel|sentry|posthog|logrocket|stripe|sqlalchemy|sql|python|javascript|traceback|stack trace|bearer token|api key|database_url|environment variable|\/api\/[a-z0-9/_{}.-]+|https?:\/\/\S+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|401|402|403|404|408|429|500|502|503|504)\b/i;
const rawErrorPattern = /request_failed|http|json|unexpected token|failed to fetch|load failed|networkerror|exception|timeout|timed out|quota|rate limit|invalid token|missing bearer|unauthorized|forbidden|database|connection failed|webhook|signature|provider|model|api|endpoint/i;

export const genericErrorMessage = "Something went wrong while processing your request. Please try again.";

export function containsSensitiveTechnicalInfo(value: string) {
  return sensitivePattern.test(value);
}

export function sanitizeUserMessage(value: unknown, fallback = genericErrorMessage) {
  const raw = String(value || "").replace(/^REQUEST_FAILED:/, "").trim();
  const lower = raw.toLowerCase();

  if (!raw) return fallback;
  if (/traceback|sqlalchemy|stack trace|database_url|environment variable|api key|http\s?\d|json|\/api\//i.test(raw)) {
    if (!/(openai|google|hunter|apollo|resend|stripe|clerk|postgres|postgresql)/i.test(raw)) {
      return fallback;
    }
  }
  if (lower.includes("no companies") || lower.includes("no matching")) {
    return "No companies were found. Try a broader location, industry, or company size.";
  }
  if (lower.includes("sign in") || lower.includes("session") || lower.includes("token") || lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("access denied")) {
    return "Your session has expired. Please sign in again.";
  }
  if (lower.includes("rate limit") || lower.includes("quota") || lower.includes("too many")) {
    return "This action is temporarily limited. Please try again later.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "This is taking longer than expected. Please try again with a smaller request.";
  }
  if (lower.includes("approve at least one email draft before launching this campaign")) {
    return "Approve at least one email draft before launching this campaign.";
  }
  if (lower.includes("add at least one lead before launching this campaign")) {
    return "Add at least one lead before launching this campaign.";
  }
  if (lower.includes("lead") || lower.includes("company") || lower.includes("places") || lower.includes("maps") || lower.includes("apollo") || lower.includes("hunter")) {
    return "Lead search is temporarily unavailable. Please try again later.";
  }
  if (/\bai\b/i.test(raw) || lower.includes("openai") || lower.includes("model") || lower.includes("analysis") || lower.includes("draft") || lower.includes("email generated")) {
    return "AI analysis is temporarily unavailable. Please try again in a moment.";
  }
  if (lower.includes("email") || lower.includes("resend") || lower.includes("send")) {
    return "Email sending is temporarily unavailable. Please try again later.";
  }
  if (lower.includes("billing") || lower.includes("checkout") || lower.includes("stripe") || lower.includes("subscription") || lower.includes("payment")) {
    return "Billing is temporarily unavailable. Please try again in a moment.";
  }
  if (lower.includes("database") || lower.includes("postgres") || lower.includes("sql") || lower.includes("workspace")) {
    return "We couldn’t load your data right now. Please refresh the page.";
  }
  if (containsSensitiveTechnicalInfo(raw) || rawErrorPattern.test(raw)) {
    return fallback;
  }
  return raw.length <= 160 ? raw : fallback;
}
