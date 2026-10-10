import http from 'http';
import { URL } from 'url';
import { MOCK_STATUS, MOCK_FILTERS, INITIAL_KEYWORDS, MOCK_ADS } from './data.js';
import {
  handleHome,
  handleKeywordOverview,
  handleOfferDetail,
  handleAdvertiserDetail,
  handleCompare,
} from './semrush_routes.js';
import { handleOffers, handleOffersCsv } from './semrush_routes_offers.js';

const PORT = 3551;
let keywords = [...INITIAL_KEYWORDS];
let runs = new Map();
let nextRunId = 200;
let nextKeywordId = 10;

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function toAdCard(ad) {
  return {
    id: ad.id,
    advertiser: ad.advertiser,
    thumbUrl: ad.thumbUrl,
    format: ad.format,
    hasVideo: ad.hasVideo,
    body: (ad.body || '').slice(0, 280),
    title: ad.title,
    cta: ad.cta,
    domain: ad.domain,
    linkUrl: ad.linkUrl,
    countries: ad.countries,
    language: ad.language,
    startDate: ad.startDate,
    lastSeenAt: ad.lastSeenAt,
    daysRunning: ad.daysRunning,
    isActive: ad.isActive,
    duplicates: ad.duplicates,
    checkout: ad.checkout,
    score: ad.score,
    offerScaled: Boolean(ad.score >= 60 && ad.duplicates >= 3),
  };
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = reqUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    });
    return res.end();
  }

  if (pathname === '/healthz') {
    return sendJson(res, 200, { ok: true });
  }

  // Checagem de Auth para /api/v2/*
  if (pathname.startsWith('/api/v2')) {
    const auth = req.headers['authorization'] || '';
    if (!auth || !auth.startsWith('Bearer ')) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    const token = auth.slice(7).trim();
    if (token === 'invalid_token') {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    if (token === 'app_token_missing') {
      return sendJson(res, 503, { ok: false, error: 'app_token_required' });
    }
  }

  // SPEC-009: Novas rotas Semrush
  if (req.method === 'GET' && pathname === '/api/v2/home') {
    return handleHome(req, res, keywords);
  }

  if (req.method === 'GET' && pathname === '/api/v2/keyword-overview') {
    return handleKeywordOverview(req, res, reqUrl, keywords);
  }

  if (req.method === 'GET' && pathname === '/api/v2/offers') {
    return handleOffers(req, res, reqUrl);
  }

  if (req.method === 'GET' && pathname === '/api/v2/offers.csv') {
    return handleOffersCsv(req, res, reqUrl);
  }

  const offerMatch = pathname.match(/^\/api\/v2\/offers\/([^/]+)$/);
  if (req.method === 'GET' && offerMatch) {
    return handleOfferDetail(req, res, offerMatch[1], reqUrl);
  }

  const advertiserMatch = pathname.match(/^\/api\/v2\/advertisers\/([^/]+)$/);
  if (req.method === 'GET' && advertiserMatch) {
    return handleAdvertiserDetail(req, res, advertiserMatch[1], reqUrl);
  }

  if (req.method === 'GET' && pathname === '/api/v2/compare') {
    return handleCompare(req, res, reqUrl);
  }

  // Rotas da API v2
  if (req.method === 'GET' && pathname === '/api/v2/status') {
    return sendJson(res, 200, MOCK_STATUS);
  }

  if (req.method === 'GET' && pathname === '/api/v2/filters') {
    return sendJson(res, 200, MOCK_FILTERS);
  }

  if (req.method === 'GET' && pathname === '/api/v2/keywords') {
    return sendJson(res, 200, { ok: true, keywords });
  }

  if (req.method === 'POST' && pathname === '/api/v2/keywords') {
    const body = await parseJsonBody(req);
    const term = (body.term || '').trim();
    const country = (body.country || 'BR').toUpperCase();
    if (term.length < 2 || term.length > 80) {
      return sendJson(res, 400, { ok: false, error: 'invalid_term' });
    }
    if (keywords.length >= 50) {
      return sendJson(res, 400, { ok: false, error: 'keyword_limit' });
    }
    const exists = keywords.some((k) => k.term.toLowerCase() === term.toLowerCase() && k.country === country);
    if (exists) {
      return sendJson(res, 409, { ok: false, error: 'keyword_exists' });
    }
    const newKw = {
      id: nextKeywordId++,
      term,
      country,
      active: true,
      lastRunAt: new Date().toISOString(),
      lastStatus: 'succeeded',
      adsTotal: 0,
      new24h: 0,
    };
    keywords.unshift(newKw);
    return sendJson(res, 201, { ok: true, keyword: newKw });
  }

  const patchKwMatch = pathname.match(/^\/api\/v2\/keywords\/(\d+)$/);
  if (req.method === 'PATCH' && patchKwMatch) {
    const id = parseInt(patchKwMatch[1], 10);
    const body = await parseJsonBody(req);
    const kw = keywords.find((k) => k.id === id);
    if (!kw) return sendJson(res, 404, { ok: false, error: 'not_found' });
    if (typeof body.active === 'boolean') kw.active = body.active;
    return sendJson(res, 200, { ok: true, keyword: kw });
  }

  if (req.method === 'DELETE' && patchKwMatch) {
    const id = parseInt(patchKwMatch[1], 10);
    const idx = keywords.findIndex((k) => k.id === id);
    if (idx === -1) return sendJson(res, 404, { ok: false, error: 'not_found' });
    keywords.splice(idx, 1);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/v2/collect/now') {
    const body = await parseJsonBody(req);
    const term = (body.term || '').toLowerCase();
    if (term.includes('limite')) {
      return sendJson(res, 429, { ok: false, error: 'daily_limit' });
    }
    if (term.includes('ocupado')) {
      return sendJson(res, 409, { ok: false, error: 'run_in_progress', runId: 99 });
    }
    if (term.includes('sem_apify')) {
      return sendJson(res, 503, { ok: false, error: 'apify_not_configured' });
    }
    const runId = nextRunId++;
    const willFail = term.includes('falha');
    const run = {
      id: runId,
      status: 'running',
      received: 0,
      inserted: 0,
      error: null,
      createdAt: Date.now(),
      willFail,
    };
    runs.set(runId, run);
    setTimeout(() => {
      const r = runs.get(runId);
      if (r) {
        if (r.willFail) {
          r.status = 'failed';
          r.error = 'apify_actor_failed';
        } else {
          r.status = 'succeeded';
          r.received = 24;
          r.inserted = 18;
        }
      }
    }, 2500);
    return sendJson(res, 202, { ok: true, runId });
  }

  const runMatch = pathname.match(/^\/api\/v2\/collect\/runs\/(\d+)$/);
  if (req.method === 'GET' && runMatch) {
    const runId = parseInt(runMatch[1], 10);
    const r = runs.get(runId);
    if (!r) return sendJson(res, 404, { ok: false, error: 'not_found' });
    return sendJson(res, 200, { ok: true, run: r });
  }

  const mediaMatch = pathname.match(/^\/api\/v2\/media\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (req.method === 'GET' && mediaMatch) {
    const adId = mediaMatch[1];
    if (adId === 'ad_media_expired') {
      return sendJson(res, 410, { ok: false, error: 'media_expired' });
    }
    const ad = MOCK_ADS.find((a) => a.id === adId);
    if (!ad) return sendJson(res, 404, { ok: false, error: 'not_found' });
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="creative-${adId}.mp4"`,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(Buffer.from('mock binary media stream'));
  }

  const adMatch = pathname.match(/^\/api\/v2\/ads\/([^/]+)$/);
  if (req.method === 'GET' && adMatch) {
    const id = adMatch[1];
    const ad = MOCK_ADS.find((a) => a.id === id);
    if (!ad) return sendJson(res, 404, { ok: false, error: 'not_found' });
    const siblings = MOCK_ADS.filter((a) => a.domain === ad.domain && a.id !== ad.id).slice(0, 12).map(toAdCard);
    return sendJson(res, 200, { ok: true, ad: { ...ad, siblings } });
  }

  if (req.method === 'GET' && pathname === '/api/v2/search') {
    const q = (reqUrl.searchParams.get('q') || '').trim().toLowerCase();
    const field = reqUrl.searchParams.get('field') || 'all';
    const country = reqUrl.searchParams.get('country') || '';
    const language = reqUrl.searchParams.get('language') || '';
    const format = reqUrl.searchParams.get('format') || '';
    const cta = reqUrl.searchParams.get('cta') || '';
    const checkout = reqUrl.searchParams.get('checkout') || '';
    const infoOnly = reqUrl.searchParams.get('infoOnly') || '0';
    const status = reqUrl.searchParams.get('status') || 'active';
    const sort = reqUrl.searchParams.get('sort') || 'score';
    const minDays = parseInt(reqUrl.searchParams.get('minDays') || '0', 10);
    const maxDays = parseInt(reqUrl.searchParams.get('maxDays') || '0', 10);
    const minDup = parseInt(reqUrl.searchParams.get('minDup') || '0', 10);
    const page = Math.max(1, parseInt(reqUrl.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(60, Math.max(1, parseInt(reqUrl.searchParams.get('pageSize') || '24', 10)));

    let items = [...MOCK_ADS];

    if (q) {
      items = items.filter((a) => {
        const bodyTxt = (a.body || '').toLowerCase();
        const titleTxt = (a.title || '').toLowerCase();
        const advTxt = ((a.advertiser && a.advertiser.name) || '').toLowerCase();
        const domTxt = (a.domain || '').toLowerCase();
        const urlTxt = (a.linkUrl || '').toLowerCase();
        const landTxt = ((a.landing && a.landing.excerpt) || '').toLowerCase();

        if (field === 'text') return bodyTxt.includes(q) || titleTxt.includes(q);
        if (field === 'advertiser') return advTxt.includes(q);
        if (field === 'domain') return domTxt.includes(q);
        if (field === 'url') return urlTxt.includes(q);
        if (field === 'landing') return landTxt.includes(q);
        return (
          bodyTxt.includes(q) ||
          titleTxt.includes(q) ||
          advTxt.includes(q) ||
          domTxt.includes(q) ||
          urlTxt.includes(q) ||
          landTxt.includes(q)
        );
      });
    }

    if (country) items = items.filter((a) => a.countries && a.countries.includes(country));
    if (language) items = items.filter((a) => a.language === language);
    if (format) items = items.filter((a) => a.format === format);
    if (cta) items = items.filter((a) => a.cta === cta);
    if (checkout) {
      const coList = checkout.split(',').map((c) => c.trim().toLowerCase());
      items = items.filter((a) => a.checkout && coList.includes((a.checkout.platform || '').toLowerCase()));
    }
    if (infoOnly === '1') items = items.filter((a) => a.checkout !== null);
    if (status === 'active') items = items.filter((a) => a.isActive);
    if (minDays > 0) items = items.filter((a) => a.daysRunning >= minDays);
    if (maxDays > 0) items = items.filter((a) => a.daysRunning <= maxDays);
    if (minDup > 0) items = items.filter((a) => a.duplicates >= minDup);

    if (sort === 'longest') items.sort((a, b) => b.daysRunning - a.daysRunning);
    else if (sort === 'last_seen') items.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    else if (sort === 'newest') items.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    else if (sort === 'duplicates') items.sort((a, b) => b.duplicates - a.duplicates);
    else items.sort((a, b) => b.score - a.score);

    const total = items.length;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize).map(toAdCard);

    return sendJson(res, 200, { ok: true, total, page, pageSize, items: paged });
  }

  return sendJson(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Mock Server v2] Escutando em http://127.0.0.1:${PORT}`);
});
