"use client";

import { clientApi } from "@/lib/client-api";
import { shouldUseHeavyClientTelemetry } from "@/lib/client-runtime";
import { logRocketAppId } from "@/lib/env";

type RuntimeConfig = {
  session_replay?: {
    enabled?: boolean;
    app_id?: string;
  };
  logrocket?: {
    enabled?: boolean;
    app_id?: string;
  };
  app?: {
    environment?: string;
    release?: string;
  };
};

type LogRocketProperties = Record<string, string | number | boolean | null | undefined>;
type LogRocketRequest = {
  url: string;
  headers: Record<string, string | null | undefined>;
  body?: string;
};
type LogRocketResponse = {
  body?: string;
};
type LogRocketClient = {
  init: (
    appId: string,
    options: {
      release: string;
      rootHostname?: string;
      console: { shouldAggregateConsoleErrors: boolean };
      network: {
        requestSanitizer: (request: LogRocketRequest) => LogRocketRequest;
        responseSanitizer: (response: LogRocketResponse) => LogRocketResponse;
      };
      dom: {
        inputSanitizer: boolean;
        textSanitizer: boolean;
        privateClassNameBlocklist: string[];
        baseHref?: string;
      };
    }
  ) => void;
  track: (name: string, properties: LogRocketProperties) => void;
  identify: (userId: string, traits: Record<string, string | number | boolean>) => void;
  captureException: (
    error: Error,
    options: { tags: Record<string, string | number | boolean>; extra: LogRocketProperties }
  ) => void;
};

const ignoredErrorPatterns = [
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-extension:\/\//i,
  /network\s?error/i,
  /the internet connection appears to be offline/i,
  /adblock/i,
  /blocked by client/i
];

let initialized = false;
let runtimeAppId = logRocketAppId;
let runtimeRelease = process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0";
let runtimeEnvironment = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development";
let configPromise: Promise<boolean> | null = null;
let logRocketClient: LogRocketClient | null = null;
let logRocketClientPromise: Promise<LogRocketClient | null> | null = null;

declare global {
  interface Window {
    __OUTREACHAI_LOGROCKET__?: {
      enabled: boolean;
      appId: string | null;
      loaded: boolean;
      release: string;
      environment: string;
    };
  }
}

function sanitizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((_, key) => {
      if (/token|secret|key|password|session|auth|code/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

function isBenignRuntimeConfigFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /abort|cancelled|load failed|failed to fetch|network\s?error/i.test(message);
}

async function loadRuntimeConfig() {
  if (runtimeAppId || typeof window === "undefined") {
    return Boolean(runtimeAppId);
  }

  try {
    const config = await clientApi<RuntimeConfig>("/api/client-config", null, {
      cache: "no-store",
      direct: true,
      headers: { Accept: "application/json" },
      telemetry: false
    });
    const sessionReplay = config.session_replay || config.logrocket;
    if (sessionReplay?.enabled && sessionReplay.app_id) {
      runtimeAppId = sessionReplay.app_id;
      runtimeRelease = config.app?.release || runtimeRelease;
      runtimeEnvironment = config.app?.environment || runtimeEnvironment;
      window.__OUTREACHAI_LOGROCKET__ = {
        enabled: true,
        appId: runtimeAppId,
        loaded: false,
        release: runtimeRelease,
        environment: runtimeEnvironment
      };
      return true;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && !isBenignRuntimeConfigFailure(error)) {
      console.error("Session replay runtime config could not be loaded", error);
    }
  }
  return false;
}

async function loadLogRocketClient() {
  if (!shouldUseHeavyClientTelemetry()) return null;
  if (logRocketClient) return logRocketClient;
  if (!logRocketClientPromise) {
    logRocketClientPromise = import("logrocket")
      .then((module) => {
        const candidate = module as unknown as { default?: LogRocketClient } & LogRocketClient;
        logRocketClient = candidate.default || candidate;
        return logRocketClient;
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== "production" && !isBenignRuntimeConfigFailure(error)) {
          console.error("Session replay client could not be loaded", error);
        }
        return null;
      });
  }
  return logRocketClientPromise;
}

export function bootLogRocket() {
  if (typeof window === "undefined" || !shouldUseHeavyClientTelemetry()) {
    return Promise.resolve(false);
  }

  if (!configPromise) {
    configPromise = initializeLogRocket().then((ready) => {
      if (ready) return true;
      return loadRuntimeConfig().then(() => initializeLogRocket());
    });
  }

  return configPromise;
}

export async function initializeLogRocket() {
  if (typeof window === "undefined" || !runtimeAppId) {
    return false;
  }

  if (!shouldUseHeavyClientTelemetry()) {
    window.__OUTREACHAI_LOGROCKET__ = {
      enabled: false,
      appId: runtimeAppId,
      loaded: false,
      release: runtimeRelease,
      environment: runtimeEnvironment
    };
    return false;
  }

  if (initialized) {
    return true;
  }

  const LogRocket = await loadLogRocketClient();
  if (!LogRocket) return false;

  LogRocket.init(runtimeAppId, {
    release: runtimeRelease,
    rootHostname: typeof window !== "undefined" ? window.location.hostname : undefined,
    console: {
      shouldAggregateConsoleErrors: true
    },
    network: {
      requestSanitizer: (request) => {
        request.url = sanitizeUrl(request.url);
        request.headers = {
          ...request.headers,
          authorization: request.headers.authorization ? "[redacted]" : request.headers.authorization,
          cookie: request.headers.cookie ? "[redacted]" : request.headers.cookie
        };
        if (request.body && /password|secret|token|api[_-]?key/i.test(String(request.body))) {
          request.body = "[redacted]";
        }
        return request;
      },
      responseSanitizer: (response) => {
        if (response.body && /password|secret|token|api[_-]?key/i.test(String(response.body))) {
          response.body = "[redacted]";
        }
        return response;
      }
    },
    dom: {
      inputSanitizer: true,
      textSanitizer: false,
      privateClassNameBlocklist: ["ph-mask", "lr-mask"],
      baseHref: typeof window !== "undefined" ? window.location.origin : undefined
    }
  });

  initialized = true;
  LogRocket.track("logrocket_loaded", {
    current_route: window.location.pathname,
    release: runtimeRelease,
    environment: runtimeEnvironment
  });
  window.__OUTREACHAI_LOGROCKET__ = {
    enabled: true,
    appId: runtimeAppId,
    loaded: true,
    release: runtimeRelease,
    environment: runtimeEnvironment
  };
  return true;
}

export function identifyLogRocketUser({
  userId,
  email,
  workspaceId
}: {
  userId: string;
  email?: string;
  workspaceId?: string;
}) {
  if (!userId) return;
  void bootLogRocket().then((ready) => {
    if (!ready) return;
    const LogRocket = logRocketClient;
    if (!LogRocket) return;
    LogRocket.identify(userId, {
      email: email || "",
      workspace_id: workspaceId || "unknown-workspace",
      release: runtimeRelease,
      environment: runtimeEnvironment
    });
  });
}

export function trackLogRocketEvent(name: string, properties: LogRocketProperties = {}) {
  void bootLogRocket().then((ready) => {
    if (!ready) return;
    const LogRocket = logRocketClient;
    if (!LogRocket) return;
    LogRocket.track(name, {
      ...properties,
      current_route: typeof window !== "undefined" ? window.location.pathname : "",
      release: runtimeRelease,
      environment: runtimeEnvironment
    });
  });
}

export function captureLogRocketException(error: unknown, properties: LogRocketProperties = {}) {
  const message = error instanceof Error ? error.message : String(error || "Unknown client error");
  const stack = error instanceof Error ? error.stack || "" : "";
  if (ignoredErrorPatterns.some((pattern) => pattern.test(message) || pattern.test(stack))) return;
  void bootLogRocket().then((ready) => {
    if (!ready) return;
    const LogRocket = logRocketClient;
    if (!LogRocket) return;
    const exception = error instanceof Error ? error : new Error(message);
    LogRocket.captureException(exception, {
      tags: {
        area: String(properties.area || "frontend"),
        current_route: typeof window !== "undefined" ? window.location.pathname : "",
        environment: runtimeEnvironment
      },
      extra: {
        ...properties,
        release: runtimeRelease
      }
    });
  });
}

export function trackLogRocketPage(pathname: string) {
  trackLogRocketEvent("page_view", { current_route: pathname });
}

export function trackLogRocketApiFailure(path: string, status: number, detail: string) {
  trackLogRocketEvent("api_request_failed", {
    endpoint: sanitizeUrl(path),
    status,
    detail: detail.slice(0, 500)
  });
}
