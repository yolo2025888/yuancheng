import { getStoredAccessToken } from './authStorage';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type ResponseType = 'auto' | 'text' | 'blob' | 'response';

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  auth?: 'include' | 'omit';
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
  const {
    method = 'GET',
    body,
    signal,
    headers: customHeaders,
    responseType = 'auto',
    auth = 'include'
  } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = buildApiUrl(path);
  const headers = new Headers(customHeaders);
  const token = auth === 'include' ? getStoredAccessToken() : null;

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const requestBody = buildRequestBody(body, headers);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method,
      headers: hasHeaders(headers) ? headers : undefined,
      body: requestBody,
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

    if (responseType === 'response') {
      return response as T;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (responseType === 'blob') {
      return (await response.blob()) as T;
    }

    if (responseType === 'text') {
      return (await response.text()) as T;
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

export async function fetchApiAssetObjectUrl(uri: string) {
  const blob = await apiClient<Blob>(uri, { responseType: 'blob' });
  return URL.createObjectURL(blob);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown API error';
}

function buildRequestBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return JSON.stringify(body);
}

function hasHeaders(headers: Headers) {
  return Array.from(headers.keys()).length > 0;
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
