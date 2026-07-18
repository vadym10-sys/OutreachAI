import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { AppProviders } from "@/components/app-providers";
import { appUrl, clerkPublishableKey, hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { isLocale } from "@/lib/i18n/translations";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "OutreachAI - Find customers, save CRM leads, write emails",
    template: "%s | OutreachAI"
  },
  description: "Find public-source B2B customer leads, save selected companies to CRM, create personalized draft emails, and send only after manual review.",
  openGraph: {
    title: "OutreachAI",
    description: "A focused AI customer finder for B2B teams: search, CRM, draft email, manual send.",
    type: "website"
  },
  robots: {
    index: true,
    follow: true
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("outreachai_locale")?.value;
  const initialLocale = isLocale(cookieLocale) ? cookieLocale : "en";

  return (
    <html lang={initialLocale} data-scroll-behavior="smooth">
      <body>
        <AppProviders clerkPublishableKey={clerkPublishableKey} clerkEnabled={!isClerkE2EBypass && hasClerkPublishableKey} initialLocale={initialLocale}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
