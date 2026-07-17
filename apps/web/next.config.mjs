import { withSentryConfig } from "@sentry/nextjs";

const clerkDomains = [
  "https://clerk.outreachaiaiai.com",
  "https://*.clerk.accounts.dev"
];

const stripeDomains = [
  "https://js.stripe.com",
  "https://checkout.stripe.com",
  "https://hooks.stripe.com",
  "https://api.stripe.com"
];

const analyticsDomains = [
  "https://app.posthog.com",
  "https://*.posthog.com",
  "https://cdn.logr-in.com",
  "https://*.logr-in.com",
  "https://*.logrocket.io",
  "https://*.logrocket.com",
  "https://*.lr-ingest.io",
  "wss://*.logrocket.io"
];

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://clerk.outreachaiaiai.com https://*.clerk.accounts.dev",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.outreachaiaiai.com https://*.clerk.accounts.dev https://js.stripe.com https://vercel.live https://va.vercel-scripts.com https://cdn.logr-in.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://outreachai-api-production.up.railway.app https://*.railway.app ${clerkDomains.join(" ")} ${stripeDomains.join(" ")} ${analyticsDomains.join(" ")} wss://clerk.outreachaiaiai.com wss://*.clerk.accounts.dev`,
  `frame-src 'self' ${clerkDomains.join(" ")} ${stripeDomains.join(" ")}`,
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests"
].join("; ");

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate"
          },
          {
            key: "Content-Security-Policy",
            value: csp
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "X-Frame-Options",
            value: "DENY"
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()"
          }
        ]
      }
    ];
  }
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true
});
