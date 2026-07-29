const ignoredMessages = [
  /extension context invalidated/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-web-extension:\/\//i,
  /adblock/i,
  /ad blocker/i,
  /network request failed/i,
  /networkerror/i,
  /failed to fetch/i,
  /load failed/i,
  /the internet connection appears to be offline/i,
  /cancelled/i,
  /aborterror/i
];

const ignoredSources = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  "extensions/"
];

const sensitiveValuePattern = /(authorization|cookie|password|secret|token|api[_-]?key|database_url|dsn|email_body|body|message|content|sk_live_|sk_test_|bearer\s+[a-z0-9._-]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

type SentryLikeEvent = {
  message?: string;
  exception?: { values?: Array<{ value?: string; stacktrace?: { frames?: Array<{ filename?: string }> } }> };
  breadcrumbs?: unknown[];
  request?: { url?: string; headers?: Record<string, unknown>; cookies?: unknown; data?: unknown };
  extra?: unknown;
  contexts?: unknown;
  user?: unknown;
};

export function scrubSentryEvent<T extends object>(event: T): T {
  const scrubRecord = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrubRecord);
    if (!value || typeof value !== "object") return typeof value === "string" && sensitiveValuePattern.test(value) ? "[Filtered]" : value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitiveValuePattern.test(key) ? "[Filtered]" : scrubRecord(item)
      ])
    );
  };

  const next = event as SentryLikeEvent;
  if (next.message) next.message = scrubRecord(next.message) as string;
  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((exception) => ({
        ...exception,
        value: exception.value ? scrubRecord(exception.value) as string : exception.value
      }))
    };
  }
  if (next.breadcrumbs) next.breadcrumbs = scrubRecord(next.breadcrumbs) as unknown[];
  if (next.request) {
    next.request = {
      ...next.request,
      headers: scrubRecord(next.request.headers || {}) as Record<string, unknown>,
      cookies: next.request.cookies ? { filtered: "[Filtered]" } : undefined,
      data: next.request.data ? "[Filtered]" : undefined
    };
  }
  if (next.extra) next.extra = scrubRecord(next.extra);
  if (next.contexts) next.contexts = scrubRecord(next.contexts);
  if (next.user) next.user = scrubRecord(next.user);
  return event;
}

export function scrubSentryBreadcrumb<T extends object | null | undefined>(breadcrumb: T): T {
  if (!breadcrumb || typeof breadcrumb !== "object") return breadcrumb;
  return scrubSentryEvent({ breadcrumbs: [breadcrumb] }).breadcrumbs?.[0] as T;
}

export function shouldDropSentryEvent(event: SentryLikeEvent) {
  const message = [
    event.message,
    ...(event.exception?.values || []).map((exception) => exception.value)
  ].filter(Boolean).join(" ");

  if (ignoredMessages.some((pattern) => pattern.test(message))) {
    return true;
  }

  const frameSources = (event.exception?.values || [])
    .flatMap((exception) => exception.stacktrace?.frames || [])
    .map((frame) => frame.filename || "");
  const sources = [event.request?.url || "", ...frameSources];

  return sources.some((source) => ignoredSources.some((ignoredSource) => source.includes(ignoredSource)));
}

export function sentryEnvironment() {
  return process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development";
}
