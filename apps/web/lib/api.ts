import { auth } from "@clerk/nextjs/server";
import { backendApiUrl } from "@/lib/backend-url";

const backendUrl = backendApiUrl();

function isProtectedApiPath(path: string) {
  return path.startsWith('/api/') && path !== '/api/health' && path !== '/api/live' && path !== '/api/ready';
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  if (isProtectedApiPath(path) && !token) {
    throw new Error('REQUEST_FAILED');
  }
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    },
    cache: "no-store"
  });

  if (!response.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.error("OutreachAI server API request failed", { path, status: response.status });
    }
    throw new Error("REQUEST_FAILED");
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
