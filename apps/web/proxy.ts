import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { clerkProxyPath, hasClerkRuntimeConfig, isClerkE2EBypass, shouldUseClerkProxyForHostname } from "@/lib/env";

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

function isDocumentNavigation(req: NextRequest) {
  const secFetchDest = req.headers.get("sec-fetch-dest") || "";
  const secFetchMode = req.headers.get("sec-fetch-mode") || "";
  if (secFetchDest.toLowerCase() === "document") return true;
  if (secFetchMode.toLowerCase() === "navigate") return true;
  return false;
}

function signInRedirect(req: NextRequest) {
  const redirectUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  const signInUrl = new URL("/sign-in", req.url);
  signInUrl.searchParams.set("redirect_url", redirectUrl);
  return NextResponse.redirect(signInUrl);
}

function signedOutBackgroundResponse(headers: Headers) {
  const response = new NextResponse(null, { status: 204, headers });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
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
    if (!hasClerkSessionCookie(req)) {
      if (isBackgroundRouteFetch(req) || !isDocumentNavigation(req)) {
        return signedOutBackgroundResponse(res.headers);
      }
      return signInRedirect(req);
    }

    const authState = await auth();
    if (!authState.userId && (isBackgroundRouteFetch(req) || !isDocumentNavigation(req))) {
      return signedOutBackgroundResponse(res.headers);
    }

    await auth.protect();
  }

  return res;
}, {
  frontendApiProxy: {
    enabled: (url) => shouldUseClerkProxyForHostname(url.hostname),
    path: clerkProxyPath
  },
  signInUrl: "/sign-in",
  signUpUrl: "/sign-up"
});

export default isClerkE2EBypass
  ? bypassMiddleware
  : hasClerkRuntimeConfig
    ? protectedMiddleware
    : missingClerkMiddleware;

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)", "/__clerk/(.*)"]
};
