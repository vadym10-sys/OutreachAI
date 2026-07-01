import * as Sentry from '@sentry/nextjs';
import { captureLogRocketException, trackLogRocketApiFailure } from '@/lib/logrocket';
import { trackEvent } from '@/lib/posthog';
import { apiProxyUrl } from '@/lib/env';
import { sanitizeUserMessage } from '@/lib/safe-errors';

const isProduction = process.env.NODE_ENV === 'production';

export function friendlyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (!error.message) return fallback;
  if (error.message.startsWith('REQUEST_FAILED:')) {
    return sanitizeUserMessage(error.message, fallback);
  }
  return sanitizeUserMessage(error.message, fallback);
}

async function logApiFailure(path: string, response: Response) {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    detail = 'Response body could not be read.';
  }
  if (!isProduction) {
    console.error('OutreachAI API request failed', { path, status: response.status, detail });
  }
  Sentry.addBreadcrumb({
    category: 'api',
    level: 'error',
    message: 'OutreachAI API request failed',
    data: {
      path,
      status: response.status
    }
  });
  Sentry.captureException(new Error(`API request failed: ${response.status} ${path}`), {
    tags: {
      area: 'api-client',
      api_status: String(response.status)
    },
    extra: {
      path,
      status: response.status,
      response_detail: detail.slice(0, 1000)
    }
  });
  trackLogRocketApiFailure(path, response.status, detail);
  trackEvent('api_request_failed', { area: 'customer_action' });
  return detail;
}

function safeApiMessage(status: number, detail: string) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = null;
  }
  const backendDetail = parsed && typeof parsed === 'object' && 'detail' in parsed ? String((parsed as { detail?: unknown }).detail || '') : detail;
  const lower = backendDetail.toLowerCase();
  if (status === 401 || lower.includes('invalid token') || lower.includes('missing bearer')) return 'Your session has expired. Please sign in again.';
  if (status === 403 || lower.includes('forbidden') || lower.includes('permission')) return 'Your session has expired. Please sign in again.';
  if (status === 402) return 'Your plan needs attention before you can continue.';
  if (status === 429 || lower.includes('rate limit')) return 'This action is temporarily limited. Please try again later.';
  return sanitizeUserMessage(backendDetail, 'Something went wrong while processing your request. Please try again.');
}

export type ClientApiInit = RequestInit & {
  timeoutMs?: number;
  direct?: boolean;
};

export async function clientApi<T>(path: string, token: string | null, init: ClientApiInit = {}): Promise<T> {
  let response: Response;
  const { timeoutMs = 30000, signal, direct = false, ...requestInit } = init;
  const requestPath = direct ? path : `${apiProxyUrl}${path}`;
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    response = await fetch(requestPath, {
      ...requestInit,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...requestInit.headers
      },
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = didTimeout;
    Sentry.captureException(error, {
      tags: { area: 'api-client', api_status: timedOut ? 'timeout' : 'network-error' },
      extra: { path: requestPath, timeout_ms: timeoutMs }
    });
    captureLogRocketException(error, {
      area: 'api-client',
      endpoint: requestPath,
      api_status: timedOut ? 'timeout' : 'network-error'
    });
    trackEvent(timedOut ? 'api_request_timeout' : 'api_network_error', {
      area: 'customer_action'
    });
    throw new Error(timedOut ? 'REQUEST_FAILED:This request took too long. Please try again with a smaller search.' : 'REQUEST_FAILED:Something went wrong while processing your request. Please try again.');
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response.ok) {
    const detail = await logApiFailure(requestPath, response);
    throw new Error(`REQUEST_FAILED:${safeApiMessage(response.status, detail)}`);
  }

  return response.json() as Promise<T>;
}

export function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
