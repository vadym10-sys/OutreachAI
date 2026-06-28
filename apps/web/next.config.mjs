import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"]
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true
});
