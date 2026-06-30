"use client";

import posthog, { type Properties } from "posthog-js";
import { posthogHost, posthogKey } from "@/lib/env";

const ignoredErrorPatterns = [
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-extension:\/\//i,
  /network\s?error/i,
  /failed to fetch/i,
  /load failed/i,
  /the internet connection appears to be offline/i,
  /adblock/i,
  /blocked by client/i
];

let initialized = false;
let runtimePostHogKey = posthogKey;
let runtimePostHogHost = posthogHost;
let runtimeRelease = process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0";
let runtimeEnvironment = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development";
let configPromise: Promise<boolean> | null = null;
let appLoadedCaptured = false;

declare global {
  interface Window {
    __OUTREACHAI_POSTHOG__?: {
      enabled: boolean;
      host: string | null;
      loaded: boolean;
      release: string;
      environment: string;
    };
  }
}

type ClientConfig = {
  posthog?: {
    enabled?: boolean;
    key?: string;
    host?: string;
  };
  app?: {
    environment?: string;
    release?: string;
  };
};

export function posthogEnabled() {
  return Boolean(runtimePostHogKey) && typeof window !== "undefined";
}

function release() {
  return runtimeRelease;
}

function environment() {
  return runtimeEnvironment;
}

async function loadRuntimeConfig() {
  if (runtimePostHogKey || typeof window === "undefined") {
    return Boolean(runtimePostHogKey);
  }

  try {
    const response = await fetch("/api/client-config", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      return false;
    }

    const config = (await response.json()) as ClientConfig;
    if (config.posthog?.enabled && config.posthog.key) {
      runtimePostHogKey = config.posthog.key;
      runtimePostHogHost = config.posthog.host || runtimePostHogHost;
      runtimeRelease = config.app?.release || runtimeRelease;
      runtimeEnvironment = config.app?.environment || runtimeEnvironment;
      window.__OUTREACHAI_POSTHOG__ = {
        enabled: true,
        host: runtimePostHogHost,
        loaded: false,
        release: runtimeRelease,
        environment: runtimeEnvironment
      };
      return true;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Product analytics runtime config could not be loaded", error);
    }
  }

  return false;
}

export function bootPostHog() {
  if (initializePostHog()) {
    return Promise.resolve(true);
  }

  if (!configPromise) {
    configPromise = loadRuntimeConfig().then(() => initializePostHog());
  }

  return configPromise;
}

export function initializePostHog() {
  if (!posthogEnabled()) {
    return false;
  }

  if (initialized || posthog.__loaded) {
    initialized = true;
    return true;
  }

  posthog.init(runtimePostHogKey, {
    api_host: runtimePostHogHost,
    defaults: "2025-05-24",
    autocapture: {
      dom_event_allowlist: ["click", "change", "submit"],
      element_allowlist: ["a", "button", "form", "input", "select", "textarea"],
      css_selector_ignorelist: [".ph-no-capture", "[data-ph-no-capture]"]
    },
    capture_pageview: false,
    capture_pageleave: true,
    capture_performance: {
      web_vitals: true,
      network_timing: true
    },
    capture_heatmaps: true,
    capture_exceptions: true,
    disable_session_recording: true,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: {
        password: true,
        email: true,
        tel: true
      },
      maskTextSelector: "[data-private], .ph-mask",
      blockSelector: "[data-ph-no-capture], .ph-no-capture"
    },
    mask_all_element_attributes: true,
    loaded: (client) => {
      client.register({
        app: "outreachai-web",
        release: release(),
        environment: environment()
      });
    }
  });

  initialized = true;
  window.__OUTREACHAI_POSTHOG__ = {
    enabled: true,
    host: runtimePostHogHost,
    loaded: true,
    release: release(),
    environment: environment()
  };
  if (!appLoadedCaptured) {
    appLoadedCaptured = true;
    posthog.capture("app_loaded", {
      current_route: typeof window !== "undefined" ? window.location.pathname : "",
      release: release(),
      environment: environment()
    }, {
      send_instantly: true,
      transport: "fetch"
    });
  }
  return true;
}

export function identifyPostHogUser({
  userId,
  email,
  workspaceId
}: {
  userId: string;
  email?: string;
  workspaceId?: string;
}) {
  if (!userId) {
    return;
  }

  void bootPostHog().then((ready) => {
    if (!ready) return;
    const safeWorkspaceId = workspaceId || "unknown-workspace";
    posthog.identify(userId, {
      email,
      workspace_id: safeWorkspaceId
    });
    posthog.group("workspace", safeWorkspaceId);
    posthog.register({
      user_id: userId,
      workspace_id: safeWorkspaceId,
      current_route: typeof window !== "undefined" ? window.location.pathname : "",
      release: release(),
      environment: environment()
    });
  });
}

export function trackEvent(name: string, properties: Properties = {}) {
  void bootPostHog().then((ready) => {
    if (!ready) return;
    posthog.capture(name, {
      ...properties,
      current_route: typeof window !== "undefined" ? window.location.pathname : "",
      release: release(),
      environment: environment()
    }, {
      send_instantly: true,
      transport: "fetch"
    });
  });
}

export function trackPageView(pathname: string) {
  void bootPostHog().then((ready) => {
    if (!ready) return;
    posthog.register({
      current_route: pathname,
      release: release(),
      environment: environment()
    });

    posthog.capture("$pageview", {
      current_url: typeof window !== "undefined" ? window.location.href : pathname,
      current_route: pathname,
      release: release(),
      environment: environment()
    }, {
      send_instantly: true,
      transport: "fetch"
    });
  });
}

export function capturePostHogException(error: unknown, properties: Properties = {}) {
  const message = error instanceof Error ? error.message : String(error || "Unknown client error");
  const stack = error instanceof Error ? error.stack : undefined;

  if (ignoredErrorPatterns.some((pattern) => pattern.test(message) || (stack ? pattern.test(stack) : false))) {
    return;
  }

  void bootPostHog().then((ready) => {
    if (!ready) return;
    posthog.startSessionRecording();
    posthog.capture("$exception", {
      ...properties,
      $exception_message: message,
      $exception_stack_trace_raw: stack,
      current_route: typeof window !== "undefined" ? window.location.pathname : "",
      release: release(),
      environment: environment()
    }, {
      send_instantly: true,
      transport: "fetch"
    });
  });
}

export function isPostHogFeatureEnabled(flag: string, fallback = false): Promise<boolean> {
  return bootPostHog().then((ready) => {
    if (!ready) return fallback;
    try {
      return posthog.isFeatureEnabled(flag) ?? fallback;
    } catch {
      return fallback;
    }
  });
}
