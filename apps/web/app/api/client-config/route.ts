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
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
  const posthogHost = safeOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST || '', 'https://app.posthog.com');

  return NextResponse.json({
    posthog: {
      enabled: Boolean(posthogKey),
      key: posthogKey,
      host: posthogHost
    },
    app: {
      environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'development',
      release: process.env.NEXT_PUBLIC_RELEASE || 'outreachai-web@1.0.0'
    }
  });
}
