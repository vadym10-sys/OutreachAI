import { apiUrl } from '@/lib/env';
import * as Sentry from '@sentry/nextjs';
import { captureLogRocketException, trackLogRocketApiFailure } from '@/lib/logrocket';
import { trackEvent } from '@/lib/posthog';

const technicalErrorPattern = /api error|load failed|failed to fetch|networkerror|unexpected token|json|traceback|stack|500|502|503|504/i;

export function friendlyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (!error.message) return fallback;
  if (error.message.startsWith('REQUEST_FAILED:')) {
    return error.message.replace('REQUEST_FAILED:', '').trim() || fallback;
  }
  if (technicalErrorPattern.test(error.message)) return fallback;
  return error.message;
}

async function logApiFailure(path: string, response: Response) {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    detail = 'Response body could not be read.';
  }
  console.error('OutreachAI API request failed', {
    path,
    status: response.status,
    detail
  });
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
  trackEvent('api_request_failed', {
    endpoint: path,
    status: response.status,
    provider: providerFromPath(path)
  });
  return detail;
}

function providerFromPath(path: string) {
  if (path.includes('apollo')) return 'apollo';
  if (path.includes('hunter')) return 'hunter';
  if (path.includes('leads/find')) return 'google_maps';
  if (path.includes('analyze') || path.includes('draft-email') || path.includes('copilot') || path.includes('follow-ups')) return 'openai';
  if (path.includes('billing') || path.includes('stripe')) return 'stripe';
  return 'outreachai_api';
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
  if (status === 401 || lower.includes('invalid token') || lower.includes('missing bearer')) return 'Please sign in again before searching leads.';
  if (status === 403 || lower.includes('forbidden') || lower.includes('permission')) return 'Unauthorized session. Your account does not have access to this workspace.';
  if (status === 402) return 'Choose an active plan before searching leads.';
  if (status === 429 || lower.includes('rate limit')) return 'Rate limit exceeded. Please wait a minute and try again.';
  if (lower.includes('database unavailable') || lower.includes('database schema') || lower.includes('database connection') || lower.includes('could not connect')) return 'Database unavailable. Please try again in a moment.';
  if (lower.includes('workspace not found')) return 'Workspace not found. Please create or select a workspace before continuing.';
  if (lower.includes('google maps rejected') || lower.includes('google maps key') || lower.includes('places api access')) return 'Google Maps connection failed. Please verify the Google Maps API key and Places API access.';
  if (lower.includes('google maps is not connected')) return 'Google Maps is not connected. Ask the owner to connect Google Maps before searching companies.';
  if (lower.includes('google maps is temporarily unavailable')) return 'Google Maps is temporarily unavailable. Please try again in a few minutes.';
  if (lower.includes('apollo rejected') || lower.includes('apollo key') || lower.includes('invalid api key')) return 'Apollo connection failed. Please verify the Apollo API key and account access.';
  if (lower.includes('apollo is not connected')) return 'Apollo is not connected. Please connect Apollo before searching leads.';
  if (lower.includes('apollo is temporarily unavailable') || lower.includes('apollo unavailable')) return 'Apollo is temporarily unavailable. Please try again in a few minutes.';
  if (lower.includes('hunter rejected') || lower.includes('hunter key')) return 'Hunter connection failed. Companies can be found, but verified emails need Hunter access.';
  if (lower.includes('hunter is temporarily unavailable') || lower.includes('hunter unavailable')) return 'Hunter is temporarily unavailable. Companies were searched, but email verification may be incomplete.';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'Lead search timed out. Try a smaller search or broader filters.';
  if (lower.includes('no matching') || lower.includes('no companies')) return 'No companies found. Try a broader industry, larger company size, or remove the city filter.';
  if (status === 408 || status === 504) return 'API timeout. Please try again with a smaller request.';
  if (status >= 500) return 'Internal server error. The request could not be completed.';
  return backendDetail && backendDetail.length < 240 ? backendDetail : 'Connection failed. Please adjust the filters and try again.';
}

export async function clientApi<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { area: 'api-client', api_status: 'network-error' },
      extra: { path }
    });
    captureLogRocketException(error, {
      area: 'api-client',
      endpoint: path,
      api_status: 'network-error'
    });
    trackEvent('api_network_error', {
      endpoint: path,
      provider: providerFromPath(path)
    });
    throw error;
  }

  if (!response.ok) {
    const detail = await logApiFailure(path, response);
    throw new Error(`REQUEST_FAILED:${safeApiMessage(response.status, detail)}`);
  }

  return response.json() as Promise<T>;
}

export function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
