import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function safeOrigin(value: string, fallback: string) {
  if (!value) return fallback;
  try {
    return new URL(value).origin;
  } catch {
    try {
      return new URL(`https://${value}`).origin;
    } catch {
      return fallback;
    }
  }
}

export function GET() {
  const analyticsEnabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true';
  const sessionReplayEnabled = process.env.NEXT_PUBLIC_SESSION_REPLAY_ENABLED === 'true';
  const posthogKey = analyticsEnabled ? process.env.NEXT_PUBLIC_POSTHOG_KEY || '' : '';
  const posthogHost = safeOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST || '', 'https://app.posthog.com');
  const logRocketAppId = sessionReplayEnabled ? process.env.NEXT_PUBLIC_LOGROCKET_APP_ID || '' : '';

  return NextResponse.json({
    app: {
      environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'development',
      release: process.env.NEXT_PUBLIC_RELEASE || 'outreachai-web@1.0.0'
    },
    analytics: {
      enabled: Boolean(analyticsEnabled && posthogKey),
      key: posthogKey,
      host: posthogHost
    },
    session_replay: {
      enabled: Boolean(sessionReplayEnabled && logRocketAppId),
      app_id: logRocketAppId
    }
  });
}
