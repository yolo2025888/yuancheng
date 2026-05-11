type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
};

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8010';
const REQUEST_TIMEOUT_MS = 5000;

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || DEFAULT_API_BASE_URL;

export class ApiClientError extends Error {
  status?: number;
  url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.url = url;
    this.status = status;
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = buildApiUrl(path);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await safeReadError(response);
      throw new ApiClientError(
        errorText || `Request failed with status ${response.status}`,
        url,
        response.status
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError('Request timed out', url);
    }

    throw new ApiClientError(getErrorMessage(error), url);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function buildApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveApiAssetUrl(uri?: string | null) {
  if (!uri) {
    return null;
  }

  if (/^https?:\/\//i.test(uri) || uri.startsWith('data:')) {
    return uri;
  }

  return `${API_BASE_URL}/${uri.replace(/^\/+/, '')}`;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown API error';
}

async function safeReadError(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { detail?: string };
      return payload.detail ?? JSON.stringify(payload);
    }

    return await response.text();
  } catch {
    return '';
  }
}
