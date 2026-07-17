"use client";

import { friendlyErrorMessage } from "@/lib/client-api";

export type CustomerViewStatus = "loading" | "error" | "empty" | "success" | "retry" | "unauthorized" | "offline";

export type CustomerViewState<T> = {
  status: CustomerViewStatus;
  data: T | null;
  message: string;
  canRetry: boolean;
};

export function isOfflineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/offline|internet connection|network\s?error|failed to fetch|load failed/i.test(message)) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return false;
}

export function isUnauthorizedError(error: unknown) {
  const status = typeof (error as { status?: unknown })?.status === "number" ? Number((error as { status?: unknown }).status) : 0;
  const message = error instanceof Error ? error.message : String(error || "");
  return status === 401 || status === 403 || /session has expired|sign in again|unauthorized|forbidden/i.test(message);
}

export function isRetryableError(error: unknown) {
  const status = typeof (error as { status?: unknown })?.status === "number" ? Number((error as { status?: unknown }).status) : 0;
  const message = error instanceof Error ? error.message : String(error || "");
  return isOfflineError(error) || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 || /try again|too long|temporarily|timeout/i.test(message);
}

export function customerErrorStatus(error: unknown): Exclude<CustomerViewStatus, "loading" | "empty" | "success"> {
  if (isUnauthorizedError(error)) return "unauthorized";
  if (isOfflineError(error)) return "offline";
  if (isRetryableError(error)) return "retry";
  return "error";
}

export function createCustomerViewState<T>({
  loading,
  error,
  data,
  isEmpty,
  loadingMessage = "Loading...",
  emptyMessage = "Nothing to show yet.",
  errorFallback = "This view could not be loaded. Please refresh and try again."
}: {
  loading: boolean;
  error?: unknown;
  data: T | null;
  isEmpty?: (data: T) => boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  errorFallback?: string;
}): CustomerViewState<T> {
  if (loading) {
    return { status: "loading", data, message: loadingMessage, canRetry: false };
  }
  if (error) {
    const status = customerErrorStatus(error);
    return {
      status,
      data,
      message: friendlyErrorMessage(error, errorFallback),
      canRetry: status === "retry" || status === "offline"
    };
  }
  if (!data || (isEmpty && isEmpty(data))) {
    return { status: "empty", data, message: emptyMessage, canRetry: false };
  }
  return { status: "success", data, message: "", canRetry: false };
}

export function useCustomerViewState<T>(input: Parameters<typeof createCustomerViewState<T>>[0]) {
  return createCustomerViewState(input);
}
