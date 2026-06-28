"use client";

import posthog, { type Properties } from "posthog-js";
import { hasPostHog, posthogHost, posthogKey } from "@/lib/env";

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

export function posthogEnabled() {
  return hasPostHog && typeof window !== "undefined";
}

function release() {
  return process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0";
}

function environment() {
  return process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development";
}

export function initializePostHog() {
  if (!posthogEnabled()) {
    return false;
  }

  if (initialized || posthog.__loaded) {
    initialized = true;
    return true;
  }

  posthog.init(posthogKey, {
    api_host: posthogHost,
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
  if (!initializePostHog() || !userId) {
    return;
  }

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
}

export function resetPostHogUser() {
  if (!initializePostHog()) {
    return;
  }

  posthog.reset();
}

export function trackEvent(name: string, properties: Properties = {}) {
  if (!initializePostHog()) {
    return;
  }

  posthog.capture(name, {
    ...properties,
    current_route: typeof window !== "undefined" ? window.location.pathname : "",
    release: release(),
    environment: environment()
  });
}

export function trackPageView(pathname: string) {
  if (!initializePostHog()) {
    return;
  }

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
  });
}

export function capturePostHogException(error: unknown, properties: Properties = {}) {
  if (!initializePostHog()) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error || "Unknown client error");
  const stack = error instanceof Error ? error.stack : undefined;

  if (ignoredErrorPatterns.some((pattern) => pattern.test(message) || (stack ? pattern.test(stack) : false))) {
    return;
  }

  posthog.startSessionRecording();
  posthog.capture("$exception", {
    ...properties,
    $exception_message: message,
    $exception_stack_trace_raw: stack,
    current_route: typeof window !== "undefined" ? window.location.pathname : "",
    release: release(),
    environment: environment()
  });
}
