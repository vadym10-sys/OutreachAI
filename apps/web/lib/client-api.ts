import * as Sentry from '@sentry/nextjs';
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

function trackApiEvent(name: string, properties: Record<string, string | number | boolean>) {
  void import('@/lib/posthog').then(({ trackEvent }) => trackEvent(name, properties)).catch(() => undefined);
}

function trackApiLogRocketFailure(path: string, status: number, detail: string) {
  void import('@/lib/logrocket').then(({ trackLogRocketApiFailure }) => trackLogRocketApiFailure(path, status, detail)).catch(() => undefined);
}

function captureApiLogRocketException(error: unknown, properties: Record<string, string | number | boolean>) {
  void import('@/lib/logrocket').then(({ captureLogRocketException }) => captureLogRocketException(error, properties)).catch(() => undefined);
}

async function logApiFailure(path: string, response: Response, requestId: string, telemetry: boolean) {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    detail = 'Response body could not be read.';
  }
  if (!isProduction && debugApiLogging) {
    console.info('OutreachAI API request failed', { path, status: response.status, request_id: requestId });
  }
  if (telemetry) {
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
    trackApiLogRocketFailure(path, response.status, `${detail}\nrequest_id=${requestId}`);
    trackApiEvent('api_request_failed', { area: 'customer_action', request_id: requestId, status: response.status });
  }
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
  if (status === 403) return 'You do not have permission to perform this action in this workspace.';
  if (status === 402) return 'Your plan needs attention before you can continue.';
  if (status === 429 || lower.includes('rate limit')) return 'This action is temporarily limited. Please try again later.';
  return sanitizeUserMessage(backendDetail, 'Something went wrong while processing your request. Please try again.');
}

export type ClientApiInit = RequestInit & {
  timeoutMs?: number;
  direct?: boolean;
  retries?: number;
  retryDelayMs?: number;
  telemetry?: boolean;
};

function isProtectedApiPath(path: string) {
  return path.startsWith('/api/') && path !== '/api/health' && path !== '/api/live' && path !== '/api/ready';
}

async function resolveBrowserClerkToken() {
  if (typeof window === 'undefined') return null;
  const clerk = (window as unknown as { Clerk?: { session?: { getToken?: () => Promise<string | null> } } }).Clerk;
  if (!clerk?.session?.getToken) return null;
  try {
    return await clerk.session.getToken();
  } catch {
    return null;
  }
}

function requestMethod(init: ClientApiInit) {
  return String(init.method || 'GET').toUpperCase();
}

function defaultRetriesForMethod(method: string) {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 1 : 0;
}

function transientStatus(status: number | undefined) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function clientApi<T>(path: string, token: string | null, init: ClientApiInit = {}): Promise<T> {
  const method = requestMethod(init);
  const retries = typeof init.retries === 'number' ? init.retries : defaultRetriesForMethod(method);
  const retryDelayMs = typeof init.retryDelayMs === 'number' ? init.retryDelayMs : 750;
  const effectiveToken = token || (isProtectedApiPath(path) ? await resolveBrowserClerkToken() : null);
  if (isProtectedApiPath(path) && !effectiveToken) {
    const authError = new Error('REQUEST_FAILED:Your session has expired. Please sign in again.') as Error & { status?: number };
    authError.status = 401;
    throw authError;
  }
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= retries) {
    try {
      return await clientApiOnce<T>(path, effectiveToken, init, attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? Number((error as { status?: unknown }).status)
        : undefined;
      const retryable =
        attempt < retries
        && !init.signal?.aborted
        && (
          transientStatus(status)
          ||
          message.includes('REQUEST_FAILED:This request took too long')
          || message.includes('REQUEST_FAILED:Something went wrong while processing your request')
          || message.includes('REQUEST_FAILED:This action is temporarily limited')
          || message.includes('REQUEST_FAILED:We could not finish this action')
          || message.includes('REQUEST_FAILED:Lead search is temporarily unavailable')
          || message.includes('REQUEST_FAILED:AI analysis is temporarily unavailable')
        );
      if (!retryable) break;
      await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)));
      attempt += 1;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('REQUEST_FAILED:Something went wrong while processing your request. Please try again.');
}

export async function clientApiBlob(path: string, token: string | null, init: ClientApiInit = {}): Promise<Blob> {
  const method = requestMethod(init);
  const retries = typeof init.retries === 'number' ? init.retries : defaultRetriesForMethod(method);
  const retryDelayMs = typeof init.retryDelayMs === 'number' ? init.retryDelayMs : 750;
  const effectiveToken = token || (isProtectedApiPath(path) ? await resolveBrowserClerkToken() : null);
  if (isProtectedApiPath(path) && !effectiveToken) {
    const authError = new Error('REQUEST_FAILED:Your session has expired. Please sign in again.') as Error & { status?: number };
    authError.status = 401;
    throw authError;
  }
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= retries) {
    try {
      const response = await clientApiResponse(path, effectiveToken, init, attempt);
      return await response.blob();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? Number((error as { status?: unknown }).status)
        : undefined;
      const retryable =
        attempt < retries
        && !init.signal?.aborted
        && (
          transientStatus(status)
          ||
          message.includes('REQUEST_FAILED:This request took too long')
          || message.includes('REQUEST_FAILED:Something went wrong while processing your request')
          || message.includes('REQUEST_FAILED:This action is temporarily limited')
        );
      if (!retryable) break;
      await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)));
      attempt += 1;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('REQUEST_FAILED:Something went wrong while processing your request. Please try again.');
}

async function clientApiResponse(path: string, token: string | null, init: ClientApiInit = {}, attempt = 0): Promise<Response> {
  let response: Response;
  const { timeoutMs = 30000, signal, direct = false, retries: _retries, retryDelayMs: _retryDelayMs, telemetry = true, ...requestInit } = init;
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
  let abortedByCaller = false;
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => {
    abortedByCaller = true;
    controller.abort();
  };
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
    if (telemetry) {
      Sentry.captureException(error, {
        tags: { area: 'api-client', api_status: timedOut ? 'timeout' : (abortedByCaller ? 'caller-abort' : 'network-error'), request_id: requestId },
        extra: { path: requestPath, timeout_ms: timeoutMs, request_id: requestId, attempt }
      });
      captureApiLogRocketException(error, {
        area: 'api-client',
        endpoint: requestPath,
        api_status: timedOut ? 'timeout' : (abortedByCaller ? 'caller-abort' : 'network-error'),
        request_id: requestId
      });
      trackApiEvent(timedOut ? 'api_request_timeout' : (abortedByCaller ? 'api_request_aborted' : 'api_network_error'), {
        area: 'customer_action',
        request_id: requestId
      });
    }
    throw new Error(timedOut ? 'REQUEST_FAILED:This request took too long. Please try again in a moment.' : 'REQUEST_FAILED:Something went wrong while processing your request. Please try again.');
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response.ok) {
    const detail = await logApiFailure(requestPath, response, requestId, telemetry);
    const requestError = new Error(`REQUEST_FAILED:${safeApiMessage(response.status, detail)}`) as Error & { status?: number };
    requestError.status = response.status;
    throw requestError;
  }

  return response;
}

async function clientApiOnce<T>(path: string, token: string | null, init: ClientApiInit = {}, attempt = 0): Promise<T> {
  const response = await clientApiResponse(path, token, init, attempt);
  const raw = await response.text();
  if (!raw.trim()) {
    // Some upstream providers intermittently return 200 with an empty body.
    // Treat it as an empty payload so UI can recover instead of getting stuck in loading state.
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const invalidPayloadError = new Error('REQUEST_FAILED:Received an invalid response from the server. Please try again.') as Error & { status?: number };
    invalidPayloadError.status = 502;
    throw invalidPayloadError;
  }
}

export function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
