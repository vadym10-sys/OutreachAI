import * as Sentry from "@sentry/nextjs";
import { sentryEnvironment, shouldDropSentryEvent } from "@/lib/sentry-common";

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn || process.env.NODE_ENV !== "production") {
    return;
  }

  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return shouldDropSentryEvent(event) ? null : event;
    }
  });
}

export const onRequestError = Sentry.captureRequestError;
