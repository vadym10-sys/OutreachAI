import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { hasClerkPublishableKey } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://outreachai.example"),
  title: {
    default: "OutreachAI - AI outbound platform for B2B growth",
    template: "%s | OutreachAI"
  },
  description: "Find leads, analyze websites, generate personalized outbound, manage campaigns, and close deals from one AI-powered CRM.",
  openGraph: {
    title: "OutreachAI",
    description: "AI outbound platform for agencies, real estate, construction, consulting, and B2B services.",
    type: "website"
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (process.env.CLERK_E2E_BYPASS === "true" || !hasClerkPublishableKey) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
