import * as Sentry from '@sentry/nextjs';
import { captureLogRocketException, trackLogRocketApiFailure } from '@/lib/logrocket';
import { trackEvent } from '@/lib/posthog';
import { apiProxyUrl } from '@/lib/env';
import { sanitizeUserMessage } from '@/lib/safe-errors';

const isProduction = process.env.NODE_ENV === 'production';
const debugApiLogging = process.env.NEXT_PUBLIC_DEBUG_API === 'true';
const localeStorageKey = 'outreachai.locale';

export function friendlyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (!error.message) return fallback;
  if (error.message.startsWith('REQUEST_FAILED:')) {
    return sanitizeUserMessage(error.message, fallback);
  }
  return sanitizeUserMessage(error.message, fallback);
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function currentLocaleHeader() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(localeStorageKey) || document.documentElement.lang || '';
  } catch {
    return document.documentElement.lang || '';
  }
}

async function logApiFailure(path: string, response: Response, requestId: string) {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    detail = 'Response body could not be read.';
  }
  if (!isProduction && debugApiLogging) {
    console.info('OutreachAI API request failed', { path, status: response.status, request_id: requestId });
  }
  Sentry.addBreadcrumb({
    category: 'api',
    level: 'error',
    message: 'OutreachAI API request failed',
    data: {
      path,
      status: response.status,
      request_id: requestId
    }
  });
  Sentry.captureException(new Error(`API request failed: ${response.status} ${path}`), {
    tags: {
      area: 'api-client',
      api_status: String(response.status),
      request_id: requestId
    },
    extra: {
      path,
      status: response.status,
      request_id: requestId,
      response_request_id: response.headers.get('x-request-id') || '',
      response_detail: detail.slice(0, 1000)
    }
  });
  trackLogRocketApiFailure(path, response.status, `${detail}\nrequest_id=${requestId}`);
  trackEvent('api_request_failed', { area: 'customer_action', request_id: requestId, status: response.status });
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
  const requestId = createRequestId();
  const headers = new Headers(requestInit.headers);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  headers.set('X-Request-ID', headers.get('X-Request-ID') || requestId);
  const locale = currentLocaleHeader();
  if (locale && !headers.has('X-OutreachAI-Locale')) {
    headers.set('X-OutreachAI-Locale', locale);
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
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
      headers,
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = didTimeout;
    Sentry.captureException(error, {
      tags: { area: 'api-client', api_status: timedOut ? 'timeout' : 'network-error', request_id: requestId },
      extra: { path: requestPath, timeout_ms: timeoutMs, request_id: requestId }
    });
    captureLogRocketException(error, {
      area: 'api-client',
      endpoint: requestPath,
      api_status: timedOut ? 'timeout' : 'network-error',
      request_id: requestId
    });
    trackEvent(timedOut ? 'api_request_timeout' : 'api_network_error', {
      area: 'customer_action',
      request_id: requestId
    });
    throw new Error(timedOut ? 'REQUEST_FAILED:This request took too long. Please try again with a smaller search.' : 'REQUEST_FAILED:Something went wrong while processing your request. Please try again.');
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response.ok) {
    const detail = await logApiFailure(requestPath, response, requestId);
    throw new Error(`REQUEST_FAILED:${safeApiMessage(response.status, detail)}`);
  }

  return response.json() as Promise<T>;
}

export function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
