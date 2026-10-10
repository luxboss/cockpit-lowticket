import { getToken, removeToken } from './auth';
import type {
  SearchParams,
  SearchResponse,
  AdDetail,
  FilterMeta,
  Keyword,
  CollectRun,
  SystemStatus,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  runId?: number;

  constructor(message: string, status: number, code: string, runId?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.runId = runId;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    removeToken();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?msg=sessao_expirada';
    }
    throw new ApiError('Sessão expirada ou token inválido. Faça login novamente.', 401, 'unauthorized');
  }

  if (res.status === 503) {
    let errCode = 'service_unavailable';
    try {
      const errJson = await res.json();
      if (errJson && errJson.error) errCode = errJson.error;
    } catch {}
    if (errCode === 'app_token_required') {
      throw new ApiError('Servidor requer configuração do token de acesso (APP_TOKEN).', 503, 'app_token_required');
    }
    throw new ApiError('Serviço temporariamente indisponível.', 503, errCode);
  }

  if (!res.ok) {
    let errCode = `http_${res.status}`;
    let runId: number | undefined;
    try {
      const errJson = await res.json();
      if (errJson && errJson.error) errCode = errJson.error;
      if (errJson && errJson.runId) runId = errJson.runId;
    } catch {}
    throw new ApiError(`Erro na requisição (${errCode})`, res.status, errCode, runId);
  }

  return (await res.json()) as T;
}

export async function searchAds(params: SearchParams = {}): Promise<SearchResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.field && params.field !== 'all') sp.set('field', params.field);
  if (params.country) sp.set('country', params.country);
  if (params.language) sp.set('language', params.language);
  if (params.format) sp.set('format', params.format);
  if (params.cta) sp.set('cta', params.cta);
  if (params.checkout) sp.set('checkout', params.checkout);
  if (params.infoOnly === '1') sp.set('infoOnly', '1');
  if (params.minDays) sp.set('minDays', String(params.minDays));
  if (params.maxDays) sp.set('maxDays', String(params.maxDays));
  if (params.createdFrom) sp.set('createdFrom', params.createdFrom);
  if (params.createdTo) sp.set('createdTo', params.createdTo);
  if (params.seenWithin) sp.set('seenWithin', params.seenWithin);
  if (params.minDup) sp.set('minDup', String(params.minDup));
  if (params.status && params.status !== 'active') sp.set('status', params.status);
  if (params.sort && params.sort !== 'score') sp.set('sort', params.sort);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  if (params.pageSize && params.pageSize !== 24) sp.set('pageSize', String(params.pageSize));

  const queryStr = sp.toString();
  const url = `/api/v2/search${queryStr ? '?' + queryStr : ''}`;
  return request<SearchResponse>(url);
}

export async function getAdDetail(id: string): Promise<AdDetail> {
  const res = await request<{ ok: boolean; ad: AdDetail }>(`/api/v2/ads/${encodeURIComponent(id)}`);
  return res.ad;
}

export async function getFilters(): Promise<FilterMeta> {
  return request<FilterMeta>('/api/v2/filters');
}

export async function getKeywords(): Promise<Keyword[]> {
  const res = await request<{ ok: boolean; keywords: Keyword[] }>('/api/v2/keywords');
  return res.keywords;
}

export async function addKeyword(term: string, country: string = 'BR'): Promise<Keyword> {
  const res = await request<{ ok: boolean; keyword: Keyword }>('/api/v2/keywords', {
    method: 'POST',
    body: JSON.stringify({ term, country }),
  });
  return res.keyword;
}

export async function updateKeyword(id: number, active: boolean): Promise<Keyword> {
  const res = await request<{ ok: boolean; keyword: Keyword }>(`/api/v2/keywords/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
  return res.keyword;
}

export async function deleteKeyword(id: number): Promise<void> {
  await request<{ ok: boolean }>(`/api/v2/keywords/${id}`, { method: 'DELETE' });
}

export async function collectNow(term: string, country: string = 'BR'): Promise<{ runId: number }> {
  return request<{ ok: boolean; runId: number }>('/api/v2/collect/now', {
    method: 'POST',
    body: JSON.stringify({ term, country }),
  });
}

export async function getCollectRun(id: number): Promise<CollectRun> {
  const res = await request<{ ok: boolean; run: CollectRun }>(`/api/v2/collect/runs/${id}`);
  return res.run;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/api/v2/status');
}

export async function downloadMedia(id: string, kind: string, index: number = 0): Promise<Blob> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api/v2/media/${encodeURIComponent(id)}/${encodeURIComponent(kind)}/${index}`, { headers });
  if (res.status === 410) {
    throw new ApiError('Mídia expirada nos servidores da Meta.', 410, 'media_expired');
  }
  if (!res.ok) {
    throw new ApiError(`Erro ao baixar mídia (${res.status})`, res.status, `http_${res.status}`);
  }
  return res.blob();
}
