"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { BarChart3, CreditCard, Inbox, LayoutDashboard, Megaphone, Search, Shield, Users } from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/leads", label: "Lead Finder", icon: Search },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/crm", label: "CRM", icon: Users },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/admin", label: "Admin", icon: Shield }
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <Link href="/dashboard" className="mb-8 block text-xl font-bold tracking-tight text-ink">OutreachAI</Link>
        <nav className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur">
          <span className="text-sm font-semibold text-slate-600">Revenue workspace</span>
          {hasClerk ? (
            <UserButton />
          ) : (
            <div className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600" aria-label="User profile">
              AI
            </div>
          )}
        </header>
        <main className="p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
