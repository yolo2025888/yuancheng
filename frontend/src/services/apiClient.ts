type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
};

const API_BASE_URL = '/api';

export async function apiClient<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body } = options;

  void body;

  return Promise.resolve({} as T);
}

export function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

export const apiPlaceholderNote =
  '当前页面使用本地 mock 数据。接入后端时，请在此处补充 fetch/鉴权/错误处理逻辑。';
