import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@clerk/nextjs/server";
import { backendApiUrl } from "@/lib/backend-url";

export const dynamic = "force-dynamic";

const backendUrl = backendApiUrl();
const hopByHopHeaders = new Set(["connection", "content-encoding", "content-length", "keep-alive", "transfer-encoding", "upgrade"]);
const defaultProxyTimeoutMs = 30000;
const longRunningTimeoutMs = 35000;
const opportunityTimeoutMs = 90000;

function targetUrl(parts: string[]) {
  const base = backendUrl.replace(/\/$/, "");
  return `${base}/${parts.map(encodeURIComponent).join("/")}`;
}

function timeoutForPath(parts: string[]) {
  const endpoint = `/${parts.join("/")}`;
  if (
    endpoint.includes("/complete-opportunity")
  ) {
    return opportunityTimeoutMs;
  }
  if (
    endpoint === "/api/leads/find" ||
    endpoint === "/api/workspace-app/leads/search" ||
    endpoint === "/api/workspace-app/leads/command" ||
    endpoint.includes("/deep-contact-search") ||
    endpoint.includes("/email-draft") ||
    endpoint.includes("/ai-sales-analysis") ||
    endpoint.includes("/analyze") ||
    endpoint.includes("/draft-email")
  ) {
    return opportunityTimeoutMs;
  }
  return defaultProxyTimeoutMs;
}

function requiresWorkspaceAuthorization(parts: string[]) {
  const endpoint = `/${parts.join("/")}`;
  if (!endpoint.startsWith("/api/")) return false;
  return endpoint !== "/api/health" && endpoint !== "/api/live" && endpoint !== "/api/ready";
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const url = new URL(targetUrl(path || []));
  request.nextUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value));

  const headers = new Headers(request.headers);
  const requestId = headers.get("x-request-id") || crypto.randomUUID();
  headers.delete("host");
  headers.delete("content-length");
  headers.set("accept-encoding", "identity");
  headers.set("x-request-id", requestId);

  // Ensure protected backend requests are never forwarded without a bearer token.
  if (!headers.has("authorization") && requiresWorkspaceAuthorization(path || [])) {
    try {
      const { userId, getToken } = await auth();
      if (userId) {
        const token = await getToken();
        if (token) {
          headers.set("authorization", `Bearer ${token}`);
        }
      }
    } catch {
      // Keep existing behavior for anonymous requests; backend will return 401 when needed.
    }
  }

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  let response: Response;
  const timeoutMs = timeoutForPath(path || []);
  const controller = new AbortController();
  let didTimeout = false;
  let clientDisconnected = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortFromClient = () => {
    clientDisconnected = true;
    controller.abort();
  };
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = didTimeout;
    Sentry.captureException(error, {
      tags: {
        area: "api-proxy",
        endpoint: `/${(path || []).join("/")}`,
        failure_type: timedOut ? "timeout" : (clientDisconnected ? "client-abort" : "network"),
        request_id: requestId
      },
      extra: {
        timeout_ms: timeoutMs,
        request_id: requestId,
        target_url: url.pathname
      }
    });
    const isOpportunity = `/${(path || []).join("/")}`.includes("/complete-opportunity");
    return NextResponse.json(
      {
        detail: timedOut
          ? (isOpportunity ? "We could not finish this action in time. Your company is saved. Please retry the missing steps." : "This request took too long. Please try again with a smaller search.")
          : "We could not reach your workspace data right now. Please try again in a moment.",
        request_id: requestId
      },
      { status: timedOut ? 504 : 503, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } }
    );
  } finally {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
  }

  const responseHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  if (!responseHeaders.has("x-request-id")) {
    responseHeaders.set("X-Request-ID", requestId);
  }

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
