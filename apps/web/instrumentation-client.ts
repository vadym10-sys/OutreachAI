import * as Sentry from "@sentry/nextjs";
import { sentryEnvironment, shouldDropSentryEvent } from "@/lib/sentry-common";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    release: process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0",
    enabled: Boolean(dsn),
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true
      })
    ],
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
      "Non-Error promise rejection captured"
    ],
    beforeSend(event) {
      return shouldDropSentryEvent(event) ? null : event;
    }
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
