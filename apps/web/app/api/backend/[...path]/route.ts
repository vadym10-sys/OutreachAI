import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

const backendUrl = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const hopByHopHeaders = new Set(["connection", "content-length", "keep-alive", "transfer-encoding", "upgrade"]);

function targetUrl(parts: string[]) {
  const base = backendUrl.replace(/\/$/, "");
  return `${base}/${parts.map(encodeURIComponent).join("/")}`;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const url = new URL(targetUrl(path || []));
  request.nextUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value));

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store"
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "api-proxy",
        endpoint: `/${(path || []).join("/")}`
      }
    });
    return NextResponse.json(
      { detail: "We could not reach your workspace data right now. Please try again in a moment." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const responseHeaders = new Headers(response.headers);
  for (const key of responseHeaders.keys()) {
    if (hopByHopHeaders.has(key.toLowerCase())) responseHeaders.delete(key);
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
