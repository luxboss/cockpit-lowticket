// Rotas Semrush para Visões Gerais e Comparação (SPEC-009)
import { MOCK_OFFERS } from './semrush_data.js';
import { MOCK_ADS } from './data.js';

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

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function generateTrend(daysCount, baseActive, trendFactor = 0) {
  const points = [];
  const now = new Date('2026-10-10T00:00:00Z');
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dayStr = d.toISOString().slice(0, 10);
    const progress = (daysCount - 1 - i) / (daysCount || 1);
    const wave = Math.sin(i * 0.5) * 2;
    const value = Math.max(1, Math.round(baseActive - (1 - progress) * trendFactor + wave));
    points.push({ day: dayStr, activeAds: value });
  }
  return points;
}

export function handleHome(req, res, keywords) {
  const activeAdsTotal = MOCK_OFFERS.reduce((s, o) => s + o.activeAds, 0);
  const totalOffers = MOCK_OFFERS.length;
  const scaledOffersTotal = MOCK_OFFERS.filter((o) => o.scaled).length;

  const rising = [...MOCK_OFFERS]
    .sort((a, b) => b.growth7d - a.growth7d)
    .slice(0, 10);

  const homeKeywords = keywords.slice(0, 5).map((kw) => ({
    id: kw.id,
    term: kw.term,
    country: kw.country || 'BR',
    active: kw.active,
    adsTotal: kw.adsTotal || 45,
    new24h: kw.new24h || 5,
    spark: [12, 14, 15, 14, 16, 17, 18, 19, 19, 20, 21, 22, 23, 24],
  }));

  const lastRuns = [
    { id: 101, kind: 'scheduled', term: 'low ticket', status: 'completed', inserted: 14, finishedAt: '2026-10-09T22:30:00Z' },
    { id: 102, kind: 'scheduled', term: 'emagrecimento', status: 'completed', inserted: 28, finishedAt: '2026-10-09T20:15:00Z' },
    { id: 103, kind: 'manual', term: 'inteligência artificial', status: 'completed', inserted: 19, finishedAt: '2026-10-09T18:40:00Z' },
    { id: 104, kind: 'scheduled', term: 'marcenaria', status: 'completed', inserted: 8, finishedAt: '2026-10-09T16:00:00Z' },
    { id: 105, kind: 'scheduled', term: 'crochê', status: 'completed', inserted: 12, finishedAt: '2026-10-09T14:20:00Z' },
  ];

  return sendJson(res, 200, {
    ok: true,
    kpis: {
      activeAds: activeAdsTotal,
      offers: totalOffers,
      scaledOffers: scaledOffersTotal,
      new24h: 38,
    },
    rising,
    keywords: homeKeywords,
    lastRuns,
  });
}

export function handleKeywordOverview(req, res, reqUrl, keywords) {
  const q = (reqUrl.searchParams.get('q') || '').trim();
  if (!q || q.length < 2 || q.length > 80) {
    return sendJson(res, 400, { ok: false, error: 'invalid_param' });
  }

  const period = reqUrl.searchParams.get('period') || '30d';
  let daysCount = 30;
  if (period === '7d') daysCount = 7;
  else if (period === '90d') daysCount = 90;
  else if (period === 'all') daysCount = 120;

  const isFew = q.toLowerCase() === 'poucos' || q.toLowerCase() === 'raro';
  let filteredOffers = MOCK_OFFERS.filter((o) => {
    return o.domain.toLowerCase().includes(q.toLowerCase()) ||
           (o.landing && o.landing.title.toLowerCase().includes(q.toLowerCase())) ||
           (o.landing && o.landing.excerpt.toLowerCase().includes(q.toLowerCase()));
  });

  if (isFew) {
    filteredOffers = filteredOffers.slice(0, 2);
  } else if (filteredOffers.length === 0) {
    filteredOffers = MOCK_OFFERS.slice(0, 8);
  }

  const activeSum = filteredOffers.reduce((s, o) => s + o.activeAds, 0) || 45;
  const scaledSum = filteredOffers.filter((o) => o.scaled).length;
  const advCount = new Set(filteredOffers.flatMap((o) => o.advertisers.map((a) => a.pageId))).size || 12;
  const avgDays = Math.round(filteredOffers.reduce((s, o) => s + o.daysMax, 0) / (filteredOffers.length || 1)) || 25;

  const mon = keywords.find((k) => k.term.toLowerCase() === q.toLowerCase());

  return sendJson(res, 200, {
    ok: true,
    q,
    kpis: {
      activeAds: activeSum,
      offers: filteredOffers.length,
      scaledOffers: scaledSum,
      advertisers: advCount,
      avgDaysRunning: avgDays,
    },
    trend: generateTrend(daysCount, activeSum, 10),
    countries: [{ id: 'BR', count: activeSum }, { id: 'PT', count: Math.round(activeSum * 0.15) }],
    formats: [
      { id: 'Vídeo', count: Math.round(activeSum * 0.6) },
      { id: 'Imagem', count: Math.round(activeSum * 0.3) },
      { id: 'Carrossel', count: Math.round(activeSum * 0.1) },
    ],
    checkouts: [
      { id: 'Hotmart', count: 18 },
      { id: 'Kiwify', count: 15 },
      { id: 'Eduzz', count: 8 },
      { id: 'Monetizze', count: 4 },
      { id: 'Braip', count: 3 },
    ],
    topOffers: filteredOffers.slice(0, 10),
    monitored: mon ? { id: mon.id } : null,
  });
}

export function handleOfferDetail(req, res, domain, reqUrl) {
  const cleanDomain = decodeURIComponent(domain || '').trim().toLowerCase();
  const offer = MOCK_OFFERS.find((o) => o.domain.toLowerCase() === cleanDomain);
  if (!offer) {
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  const period = reqUrl.searchParams.get('period') || '30d';
  let daysCount = 30;
  if (period === '7d') daysCount = 7;
  else if (period === '90d') daysCount = 90;
  else if (period === 'all') daysCount = 120;

  const topAds = MOCK_ADS.filter((a) => a.domain && a.domain.toLowerCase() === cleanDomain).slice(0, 12).map(toAdCard);
  const sampleAds = topAds.length > 0 ? topAds : MOCK_ADS.slice(0, 6).map(toAdCard);

  const result = {
    ...offer,
    trend: generateTrend(daysCount, offer.activeAds, offer.growth7d),
    countries: [{ id: 'BR', count: offer.activeAds }, { id: 'PT', count: Math.round(offer.activeAds * 0.2) }],
    formats: [
      { id: 'Vídeo', count: Math.round(offer.activeAds * 0.65) },
      { id: 'Imagem', count: Math.round(offer.activeAds * 0.35) },
    ],
    topAds: sampleAds,
    advertisers: offer.advertisers.map((a) => ({
      pageId: a.pageId,
      name: a.name,
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80',
      activeAds: offer.activeAds,
    })),
  };

  return sendJson(res, 200, { ok: true, offer: result });
}

export function handleAdvertiserDetail(req, res, pageId, reqUrl) {
  const cleanPageId = decodeURIComponent(pageId || '').trim();
  const matchingOffers = MOCK_OFFERS.filter((o) => o.advertisers.some((a) => a.pageId === cleanPageId));

  if (matchingOffers.length === 0) {
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  const advName = matchingOffers[0].advertisers.find((a) => a.pageId === cleanPageId)?.name || 'Anunciante';
  const totalActives = matchingOffers.reduce((s, o) => s + o.activeAds, 0);
  const totalAds = matchingOffers.reduce((s, o) => s + o.totalAds, 0);

  const period = reqUrl.searchParams.get('period') || '30d';
  let daysCount = 30;
  if (period === '7d') daysCount = 7;
  else if (period === '90d') daysCount = 90;
  else if (period === 'all') daysCount = 120;

  const topAds = MOCK_ADS.filter((a) => a.advertiser && a.advertiser.pageId === cleanPageId).slice(0, 12).map(toAdCard);
  const sampleAds = topAds.length > 0 ? topAds : MOCK_ADS.slice(0, 6).map(toAdCard);

  return sendJson(res, 200, {
    ok: true,
    advertiser: {
      pageId: cleanPageId,
      name: advName,
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80',
      firstSeenAt: matchingOffers[0].firstSeenAt,
      lastSeenAt: matchingOffers[0].lastSeenAt,
      kpis: {
        activeAds: totalActives,
        offers: matchingOffers.length,
        totalAds,
      },
      trend: generateTrend(daysCount, totalActives, 8),
      offers: matchingOffers,
      topAds: sampleAds,
    },
  });
}

export function handleCompare(req, res, reqUrl) {
  const domainsParam = reqUrl.searchParams.get('domains') || reqUrl.searchParams.get('d') || '';
  const domainList = domainsParam.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

  if (domainList.length < 2 || domainList.length > 5) {
    return sendJson(res, 400, { ok: false, error: 'invalid_param' });
  }

  const period = reqUrl.searchParams.get('period') || '30d';
  let daysCount = 30;
  if (period === '7d') daysCount = 7;
  else if (period === '90d') daysCount = 90;
  else if (period === 'all') daysCount = 120;

  const items = [];
  const missing = [];

  for (const d of domainList) {
    const found = MOCK_OFFERS.find((o) => o.domain.toLowerCase() === d);
    if (found) {
      items.push({
        ...found,
        trend: generateTrend(daysCount, found.activeAds, found.growth7d),
      });
    } else {
      missing.push(d);
    }
  }

  return sendJson(res, 200, { ok: true, items, missing });
}
