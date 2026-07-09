import * as Sentry from "@sentry/nextjs";
import { sentryEnvironment, shouldDropSentryEvent } from "@/lib/sentry-common";
import { shouldUseHeavyClientTelemetry } from "@/lib/client-runtime";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const heavyTelemetryEnabled = shouldUseHeavyClientTelemetry();

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    release: process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0",
    enabled: Boolean(dsn),
    tracesSampleRate: heavyTelemetryEnabled ? 0.2 : 0.02,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: heavyTelemetryEnabled ? 1.0 : 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      ...(heavyTelemetryEnabled
        ? [
            Sentry.replayIntegration({
              maskAllText: true,
              blockAllMedia: true
            })
          ]
        : [])
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
