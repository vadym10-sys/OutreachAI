import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasClerkRuntimeConfig } from "@/lib/env";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/admin(.*)"]);

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
    await auth.protect();
  }

  return res;
});

export default process.env.CLERK_E2E_BYPASS === "true"
  ? bypassMiddleware
  : hasClerkRuntimeConfig
    ? protectedMiddleware
    : missingClerkMiddleware;

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"]
};
