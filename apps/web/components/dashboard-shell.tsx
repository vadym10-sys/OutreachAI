"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { BarChart3, Bot, CreditCard, Inbox, LayoutDashboard, Megaphone, Menu, Search, Settings, Shield, UserCircle, Users } from "lucide-react";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { CheckoutContinuation } from "@/components/billing-client";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/sales-employees", label: "AI Employees", icon: Bot },
  { href: "/dashboard/leads", label: "Lead Finder", icon: Search },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/crm", label: "CRM", icon: Users },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/profile", label: "Profile", icon: UserCircle },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: Shield }
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const primaryMobileNav = nav.slice(0, 4);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-slate-50">
      <CheckoutContinuation />
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <Link href="/dashboard" className="mb-8 block text-xl font-bold tracking-tight text-ink">OutreachAI</Link>
        <nav className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-teal-50 text-brand" : "text-slate-700 hover:bg-slate-100"}`}>
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur min-[360px]:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative lg:hidden">
              <button type="button" onClick={() => setMobileMenuOpen((open) => !open)} className="focus-ring grid size-11 place-items-center rounded-md border border-slate-300 bg-white text-slate-700" aria-label="Open navigation" aria-expanded={mobileMenuOpen}>
                <Menu size={20} aria-hidden="true" />
              </button>
              {mobileMenuOpen && <div className="absolute left-0 top-12 z-40 w-[min(82vw,19rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
                {nav.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-teal-50 text-brand" : "text-slate-700 hover:bg-slate-100"}`}>
                      <Icon size={18} aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>}
            </div>
            <span className="truncate text-sm font-semibold text-slate-600">Revenue workspace</span>
          </div>
          {hasClerkPublishableKey && !isClerkE2EBypass ? (
            <UserButton />
          ) : (
            <div className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600" aria-label="User profile">
              AI
            </div>
          )}
        </header>
        <main className="min-w-0 px-4 py-5 pb-28 min-[360px]:px-5 lg:p-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        {primaryMobileNav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-semibold ${active ? "bg-teal-50 text-brand" : "text-slate-600"}`}>
              <Icon size={18} aria-hidden="true" />
              <span className="max-w-full truncate">{item.label === "Lead Finder" ? "Leads" : item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
