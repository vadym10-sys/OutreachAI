import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function safeOrigin(value: string) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function GET() {
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || '';

  return NextResponse.json({
    stripe_publishable_key_loaded: Boolean(stripePublishableKey),
    stripe_publishable_key_live: stripePublishableKey.startsWith('pk_live_'),
    posthog_key_loaded: Boolean(posthogKey),
    posthog_key_format_valid: posthogKey.startsWith('phc_') || posthogKey.startsWith('phx_'),
    posthog_host_loaded: Boolean(posthogHost),
    posthog_host: safeOrigin(posthogHost)
  });
}
