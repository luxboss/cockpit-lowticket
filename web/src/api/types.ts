export type AdFormat = 'IMAGE' | 'VIDEO' | 'CAROUSEL';

export interface Advertiser {
  pageId: string;
  name: string;
  avatarUrl?: string;
}

export interface CheckoutInfo {
  platform: string;
  priceMin: number;
}

export interface AdCard {
  id: string;
  advertiser: Advertiser;
  thumbUrl: string;
  format: AdFormat;
  hasVideo: boolean;
  body: string;
  title: string;
  cta?: string;
  domain: string;
  linkUrl: string;
  countries: string[];
  language?: string;
  startDate: string;
  lastSeenAt: string;
  daysRunning: number;
  isActive: boolean;
  duplicates: number;
  checkout: CheckoutInfo | null;
  score: number;
  offerScaled?: boolean;
}

export interface AdMedia {
  kind: 'image' | 'video';
  index: number;
  url: string;
  previewUrl?: string;
}

export interface LandingInfo {
  finalUrl: string;
  title: string;
  excerpt: string;
  checkoutPlatform?: string;
  priceMin?: number;
  fetchedAt?: string;
}

export interface TimelineDay {
  day: string;
  isActive: boolean;
}

export interface AdTimeline {
  firstSeenAt: string;
  lastSeenAt: string;
  startDate: string;
  endDate?: string | null;
  days: TimelineDay[];
}

export interface AdDetail extends AdCard {
  caption?: string;
  platforms?: string[];
  media: AdMedia[];
  landing: LandingInfo | null;
  siblings: AdCard[];
  timeline: AdTimeline;
  libraryUrl: string;
}

export interface SearchParams {
  q?: string;
  field?: 'all' | 'text' | 'advertiser' | 'domain' | 'url' | 'landing';
  country?: string;
  language?: 'pt' | 'es' | 'en' | '';
  format?: AdFormat | '';
  cta?: string;
  checkout?: string; // separated by comma
  infoOnly?: '0' | '1';
  minDays?: number;
  maxDays?: number;
  createdFrom?: string;
  createdTo?: string;
  seenWithin?: '24h' | '3d' | '7d' | '30d' | '';
  minDup?: number;
  status?: 'active' | 'all';
  sort?: 'score' | 'longest' | 'last_seen' | 'newest' | 'duplicates';
  page?: number;
  pageSize?: number;
}

export interface SearchResponse {
  ok: boolean;
  total: number;
  page: number;
  pageSize: number;
  items: AdCard[];
}

export interface FilterCountry {
  id: string;
  count: number;
}

export interface FilterMeta {
  ok: boolean;
  countries: FilterCountry[];
  languages: string[];
  formats: AdFormat[];
  ctas: string[];
  checkouts: string[];
}

export interface Keyword {
  id: number;
  term: string;
  country: string;
  active: boolean;
  lastRunAt: string;
  lastStatus: 'succeeded' | 'failed' | 'running' | 'queued';
  adsTotal: number;
  new24h: number;
}

export interface CollectRun {
  id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  received: number;
  inserted: number;
  error?: string | null;
}

export interface SystemStatus {
  ok: boolean;
  db: string;
  search: { fts: boolean };
  apify: {
    configured: boolean;
    todayAds: number;
    dailyLimit: number;
    nowTodayAds: number;
    nowDailyLimit: number;
  };
  worker: {
    alive: boolean;
    lastBeatAt: string;
  };
  totals: {
    ads: number;
    activeAds: number;
    advertisers: number;
    domains: number;
  };
  importedFromV1: boolean;
}

// SPEC-009: Tipos da Estrutura Semrush
export interface OfferAdvertiser {
  pageId: string;
  name: string;
  avatarUrl?: string;
  activeAds?: number;
}

export interface OfferRow {
  domain: string;
  score: number;
  scaled: boolean;
  activeAds: number;
  totalAds: number;
  growth7d: number;
  spark: number[];
  dupMax: number;
  daysMax: number;
  checkout: CheckoutInfo | null;
  thumbUrl?: string;
  advertisersCount: number;
  advertisers: OfferAdvertiser[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface HomeKeyword {
  id: number;
  term: string;
  country: string;
  active: boolean;
  adsTotal: number;
  new24h: number;
  spark: number[];
}

export interface HomeLastRun {
  id: number;
  kind: string;
  term: string;
  status: string;
  inserted: number;
  finishedAt: string;
}

export interface HomeData {
  ok: boolean;
  kpis: {
    activeAds: number;
    offers: number;
    scaledOffers: number;
    new24h: number;
  };
  rising: OfferRow[];
  keywords: HomeKeyword[];
  lastRuns: HomeLastRun[];
}

export interface TrendPoint {
  day: string;
  activeAds: number;
}

export interface KeywordOverviewData {
  ok: boolean;
  q: string;
  kpis: {
    activeAds: number;
    offers: number;
    scaledOffers: number;
    advertisers: number;
    avgDaysRunning: number;
  };
  trend: TrendPoint[];
  countries: { id: string; count: number }[];
  formats: { id: string; count: number }[];
  checkouts: { id: string; count: number }[];
  topOffers: OfferRow[];
  monitored: { id: number } | null;
}

export interface OfferCluster {
  term: string;
  count: number;
}

export interface OffersSummary {
  offers: number;
  activeAds: number;
  scaledOffers: number;
  avgScore: number;
}

export interface OffersResponse {
  ok: boolean;
  total: number;
  page: number;
  pageSize: number;
  summary: OffersSummary;
  clusters?: OfferCluster[];
  items: OfferRow[];
}

export interface OfferDetailData {
  ok: boolean;
  offer: OfferRow & {
    landing: LandingInfo | null;
    trend: TrendPoint[];
    countries: { id: string; count: number }[];
    formats: { id: string; count: number }[];
    topAds: AdCard[];
    advertisers: { pageId: string; name: string; avatarUrl?: string; activeAds: number }[];
  };
}

export interface AdvertiserDetailData {
  ok: boolean;
  advertiser: {
    pageId: string;
    name: string;
    avatarUrl?: string;
    firstSeenAt: string;
    lastSeenAt: string;
    kpis: {
      activeAds: number;
      offers: number;
      totalAds: number;
    };
    trend: TrendPoint[];
    offers: OfferRow[];
    topAds: AdCard[];
  };
}

export interface CompareData {
  ok: boolean;
  items: (OfferRow & { trend: TrendPoint[] })[];
  missing: string[];
}

