// Dados de simulação para a API v2 da SPEC-008
import { ADS_PART1 } from './ads_part1.js';
import { ADS_PART2 } from './ads_part2.js';

export const MOCK_STATUS = {
  ok: true,
  db: 'connected',
  search: { fts: true },
  apify: {
    configured: true,
    todayAds: 142,
    dailyLimit: 500,
    nowTodayAds: 28,
    nowDailyLimit: 150,
  },
  worker: {
    alive: true,
    lastBeatAt: new Date().toISOString(),
  },
  totals: {
    ads: 12450,
    activeAds: 8930,
    advertisers: 2140,
    domains: 1680,
  },
  importedFromV1: true,
};

export const MOCK_FILTERS = {
  ok: true,
  countries: [
    { id: 'BR', count: 180 },
    { id: 'PT', count: 24 },
    { id: 'US', count: 18 },
    { id: 'ES', count: 12 },
  ],
  languages: ['pt', 'es', 'en'],
  formats: ['IMAGE', 'VIDEO', 'CAROUSEL'],
  ctas: [
    'Saiba mais',
    'Compre agora',
    'Obter oferta',
    'Cadastre-se',
    'Assinar',
    'Fale conosco',
    'Baixar',
  ],
  checkouts: ['Hotmart', 'Kiwify', 'Eduzz', 'Cakto', 'Monetizze', 'Braip'],
};

export const INITIAL_KEYWORDS = [
  {
    id: 1,
    term: 'low ticket',
    country: 'BR',
    active: true,
    lastRunAt: '2026-10-09T18:00:00Z',
    lastStatus: 'succeeded',
    adsTotal: 86,
    new24h: 7,
  },
  {
    id: 2,
    term: 'emagrecimento',
    country: 'BR',
    active: true,
    lastRunAt: '2026-10-09T14:30:00Z',
    lastStatus: 'succeeded',
    adsTotal: 215,
    new24h: 18,
  },
  {
    id: 3,
    term: 'energia solar',
    country: 'BR',
    active: false,
    lastRunAt: '2026-10-08T22:15:00Z',
    lastStatus: 'succeeded',
    adsTotal: 42,
    new24h: 0,
  },
  {
    id: 4,
    term: 'inteligência artificial',
    country: 'BR',
    active: true,
    lastRunAt: '2026-10-09T20:00:00Z',
    lastStatus: 'succeeded',
    adsTotal: 130,
    new24h: 12,
  },
];

export const MOCK_ADS = [...ADS_PART1, ...ADS_PART2];
