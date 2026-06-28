import { apiUrl } from '@/lib/env';

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
  if (status === 401 || lower.includes('invalid token') || lower.includes('missing bearer')) return 'Please sign in again before searching leads.';
  if (status === 402) return 'Choose an active plan before searching leads.';
  if (status === 429 || lower.includes('rate limit')) return 'Rate limit exceeded. Please wait a minute and try again.';
  if (lower.includes('apollo rejected') || lower.includes('apollo key') || lower.includes('invalid api key')) return 'Apollo connection failed. Please verify the Apollo API key and account access.';
  if (lower.includes('apollo is not connected')) return 'Apollo is not connected. Please connect Apollo before searching leads.';
  if (lower.includes('apollo is temporarily unavailable') || lower.includes('apollo unavailable')) return 'Apollo is temporarily unavailable. Please try again in a few minutes.';
  if (lower.includes('hunter rejected') || lower.includes('hunter key')) return 'Hunter connection failed. Companies can be found, but verified emails need Hunter access.';
  if (lower.includes('hunter is temporarily unavailable') || lower.includes('hunter unavailable')) return 'Hunter is temporarily unavailable. Companies were searched, but email verification may be incomplete.';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'Lead search timed out. Try a smaller search or broader filters.';
  if (lower.includes('no matching') || lower.includes('no companies')) return 'No companies found. Try a broader industry, larger company size, or remove the city filter.';
  if (status >= 500) return 'Connection failed. The lead search service could not complete the request.';
  return backendDetail && backendDetail.length < 240 ? backendDetail : 'Connection failed. Please adjust the filters and try again.';
}

export async function clientApi<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });

  if (!response.ok) {
    const detail = await logApiFailure(path, response);
    throw new Error(`REQUEST_FAILED:${safeApiMessage(response.status, detail)}`);
  }

  return response.json() as Promise<T>;
}

export function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
