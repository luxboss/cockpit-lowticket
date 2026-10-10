import { request, ApiError } from './client';
import { getToken } from './auth';
import type {
  HomeData,
  KeywordOverviewData,
  OffersResponse,
  OfferDetailData,
  AdvertiserDetailData,
  CompareData,
} from './types';

export interface GetOffersParams {
  q?: string;
  field?: 'all' | 'text' | 'advertiser' | 'domain' | 'url' | 'landing';
  term?: string;
  include?: string;
  exclude?: string;
  checkout?: string;
  minActive?: number;
  minDup?: number;
  minDays?: number;
  maxDays?: number;
  scaled?: '0' | '1';
  infoOnly?: '0' | '1';
  country?: string;
  sort?: 'score' | 'active' | 'growth' | 'duplicates' | 'days' | 'price' | 'newest';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function buildOffersQuery(params: GetOffersParams = {}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.field && params.field !== 'all') sp.set('field', params.field);
  if (params.term) sp.set('term', params.term);
  if (params.include) sp.set('include', params.include);
  if (params.exclude) sp.set('exclude', params.exclude);
  if (params.checkout) sp.set('checkout', params.checkout);
  if (params.minActive) sp.set('minActive', String(params.minActive));
  if (params.minDup) sp.set('minDup', String(params.minDup));
  if (params.minDays) sp.set('minDays', String(params.minDays));
  if (params.maxDays) sp.set('maxDays', String(params.maxDays));
  if (params.scaled) sp.set('scaled', params.scaled);
  if (params.infoOnly === '1') sp.set('infoOnly', '1');
  if (params.country) sp.set('country', params.country);
  if (params.sort && params.sort !== 'score') sp.set('sort', params.sort);
  if (params.order && params.order !== 'desc') sp.set('order', params.order);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  if (params.pageSize && params.pageSize !== 50) sp.set('pageSize', String(params.pageSize));

  const str = sp.toString();
  return str ? `?${str}` : '';
}

export async function getHome(country?: string, infoOnly?: '0' | '1'): Promise<HomeData> {
  const sp = new URLSearchParams();
  if (country) sp.set('country', country);
  if (infoOnly === '1') sp.set('infoOnly', '1');
  const qs = sp.toString();
  return request<HomeData>(`/api/v2/home${qs ? `?${qs}` : ''}`);
}

export async function getKeywordOverview(
  q: string,
  period: string = '30d',
  country?: string,
  infoOnly?: '0' | '1'
): Promise<KeywordOverviewData> {
  const sp = new URLSearchParams();
  sp.set('q', q);
  if (period) sp.set('period', period);
  if (country) sp.set('country', country);
  if (infoOnly === '1') sp.set('infoOnly', '1');
  return request<KeywordOverviewData>(`/api/v2/keyword-overview?${sp.toString()}`);
}

export async function getOffers(params: GetOffersParams = {}): Promise<OffersResponse> {
  const qs = buildOffersQuery(params);
  return request<OffersResponse>(`/api/v2/offers${qs}`);
}

export async function downloadOffersCsv(params: GetOffersParams = {}): Promise<Blob> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const qs = buildOffersQuery(params);
  const res = await fetch(`/api/v2/offers.csv${qs}`, { headers });
  if (!res.ok) {
    throw new ApiError(`Erro ao baixar CSV (${res.status})`, res.status, `http_${res.status}`);
  }
  return res.blob();
}

export async function getOfferDetail(
  domain: string,
  period: string = '30d',
  country?: string,
  infoOnly?: '0' | '1'
): Promise<OfferDetailData> {
  const sp = new URLSearchParams();
  if (period) sp.set('period', period);
  if (country) sp.set('country', country);
  if (infoOnly === '1') sp.set('infoOnly', '1');
  const qs = sp.toString();
  return request<OfferDetailData>(`/api/v2/offers/${encodeURIComponent(domain)}${qs ? `?${qs}` : ''}`);
}

export async function getAdvertiserDetail(
  pageId: string,
  period: string = '30d',
  country?: string,
  infoOnly?: '0' | '1'
): Promise<AdvertiserDetailData> {
  const sp = new URLSearchParams();
  if (period) sp.set('period', period);
  if (country) sp.set('country', country);
  if (infoOnly === '1') sp.set('infoOnly', '1');
  const qs = sp.toString();
  return request<AdvertiserDetailData>(`/api/v2/advertisers/${encodeURIComponent(pageId)}${qs ? `?${qs}` : ''}`);
}

export async function getCompare(
  domains: string[],
  period: string = '30d',
  country?: string,
  infoOnly?: '0' | '1'
): Promise<CompareData> {
  const sp = new URLSearchParams();
  sp.set('domains', domains.join(','));
  if (period) sp.set('period', period);
  if (country) sp.set('country', country);
  if (infoOnly === '1') sp.set('infoOnly', '1');
  return request<CompareData>(`/api/v2/compare?${sp.toString()}`);
}
