import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { backendApiUrl } from "@/lib/backend-url";

export const dynamic = "force-dynamic";

const backendUrl = backendApiUrl();
const timeoutMs = 35000;
const hopByHopHeaders = new Set(["connection", "content-encoding", "content-length", "keep-alive", "transfer-encoding", "upgrade"]);

export async function POST(request: NextRequest) {
  const url = `${backendUrl.replace(/\/$/, "")}/api/leads/find`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("accept-encoding", "identity");

  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "lead-finder-proxy",
        endpoint: "/api/leads/find",
        failure_type: didTimeout ? "timeout" : "network"
      },
      extra: {
        timeout_ms: timeoutMs
      }
    });

    return NextResponse.json(
      { detail: didTimeout ? "Lead search took too long. Try a smaller area or fewer filters." : "Lead search is temporarily unavailable. Please try again later." },
      { status: didTimeout ? 504 : 503, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
