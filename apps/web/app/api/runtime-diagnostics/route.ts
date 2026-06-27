import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

  return NextResponse.json({
    stripe_publishable_key_loaded: Boolean(stripePublishableKey),
    stripe_publishable_key_live: stripePublishableKey.startsWith('pk_live_')
  });
}
