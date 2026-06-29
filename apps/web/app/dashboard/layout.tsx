import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
