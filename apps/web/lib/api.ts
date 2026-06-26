import { auth } from "@clerk/nextjs/server";
import { apiUrl } from "@/lib/env";

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export type DashboardMetrics = {
  leads: number;
  campaigns: number;
  emails_sent: number;
  delivered: number;
  opened: number;
  replies: number;
  bounces: number;
  open_rate: number;
  reply_rate: number;
  conversion_rate: number;
  meetings: number;
  revenue: number;
  mrr: number;
};
