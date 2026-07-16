import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasClerkRuntimeConfig, isClerkE2EBypass } from "@/lib/env";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/admin(.*)", "/onboarding(.*)"]);

function isBackgroundRouteFetch(req: NextRequest) {
  if (req.nextUrl.searchParams.has("_rsc")) return true;
  const purpose = req.headers.get("purpose") || "";
  const prefetch = req.headers.get("next-router-prefetch") || "";
  const accept = req.headers.get("accept") || "";
  return purpose.toLowerCase() === "prefetch" || prefetch === "1" || accept.includes("text/x-component");
}

function hasClerkSessionCookie(req: NextRequest) {
  const cookie = req.headers.get("cookie") || "";
  return cookie.includes("__session=") || cookie.includes("__client_uat=");
}

function securityHeaders() {
  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  return res;
}

function bypassMiddleware(_req: NextRequest) {
  return securityHeaders();
}

function missingClerkMiddleware(req: NextRequest) {
  if (isProtectedRoute(req)) {
    return NextResponse.redirect(new URL("/sign-in?error=clerk_not_configured", req.url));
  }

  return securityHeaders();
}

const protectedMiddleware = clerkMiddleware(async (auth, req) => {
  const res = securityHeaders();
  if (isProtectedRoute(req)) {
    if (isBackgroundRouteFetch(req) && !hasClerkSessionCookie(req)) {
      return new NextResponse(null, { status: 401, headers: res.headers });
    }
    await auth.protect();
  }

  return res;
});

export default isClerkE2EBypass
  ? bypassMiddleware
  : hasClerkRuntimeConfig
    ? protectedMiddleware
    : missingClerkMiddleware;

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"]
};
