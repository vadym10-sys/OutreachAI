import { apiUrl } from '@/lib/env';

const technicalErrorPattern = /api error|load failed|failed to fetch|networkerror|unexpected token|json|traceback|stack|500|502|503|504/i;

export function friendlyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (!error.message || technicalErrorPattern.test(error.message)) return fallback;
  return fallback;
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
    await logApiFailure(path, response);
    throw new Error('REQUEST_FAILED');
  }

  return response.json() as Promise<T>;
}

export function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
