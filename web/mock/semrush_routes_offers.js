// Rotas de exploração de ofertas e exportação CSV para Mock Server (SPEC-009)
import { MOCK_OFFERS } from './semrush_data.js';

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

export function filterOffers(reqUrl) {
  const q = (reqUrl.searchParams.get('q') || '').trim().toLowerCase();
  const field = reqUrl.searchParams.get('field') || 'all';
  const termCluster = (reqUrl.searchParams.get('term') || '').trim().toLowerCase();
  const include = (reqUrl.searchParams.get('include') || '').trim().toLowerCase();
  const exclude = (reqUrl.searchParams.get('exclude') || '').trim().toLowerCase();
  const checkout = reqUrl.searchParams.get('checkout') || '';
  const minActive = parseInt(reqUrl.searchParams.get('minActive') || '0', 10);
  const minDup = parseInt(reqUrl.searchParams.get('minDup') || '0', 10);
  const minDays = parseInt(reqUrl.searchParams.get('minDays') || '0', 10);
  const maxDays = parseInt(reqUrl.searchParams.get('maxDays') || '0', 10);
  const scaled = reqUrl.searchParams.get('scaled');
  const infoOnly = reqUrl.searchParams.get('infoOnly');
  const sort = reqUrl.searchParams.get('sort') || 'score';
  const order = reqUrl.searchParams.get('order') || 'desc';

  let items = [...MOCK_OFFERS];

  if (q) {
    items = items.filter((o) => {
      const d = o.domain.toLowerCase();
      const landT = (o.landing && o.landing.title.toLowerCase()) || '';
      const landE = (o.landing && o.landing.excerpt.toLowerCase()) || '';
      const advs = o.advertisers.map((a) => a.name.toLowerCase()).join(' ');
      if (field === 'domain') return d.includes(q);
      if (field === 'advertiser') return advs.includes(q);
      if (field === 'landing') return landT.includes(q) || landE.includes(q);
      return d.includes(q) || landT.includes(q) || landE.includes(q) || advs.includes(q);
    });
  }

  if (termCluster) {
    const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const tNorm = norm(termCluster);
    items = items.filter((o) => {
      const allText = `${o.domain} ${(o.landing && o.landing.title) || ''} ${(o.landing && o.landing.excerpt) || ''}`;
      return norm(allText).includes(tNorm);
    });
  }

  if (include) {
    items = items.filter((o) => {
      const allText = `${o.domain} ${(o.landing && o.landing.title) || ''} ${(o.landing && o.landing.excerpt) || ''}`.toLowerCase();
      return allText.includes(include);
    });
  }

  if (exclude) {
    items = items.filter((o) => {
      const allText = `${o.domain} ${(o.landing && o.landing.title) || ''} ${(o.landing && o.landing.excerpt) || ''}`.toLowerCase();
      return !allText.includes(exclude);
    });
  }

  if (checkout) {
    const cos = checkout.split(',').map((c) => c.trim().toLowerCase());
    items = items.filter((o) => o.checkout && cos.includes(o.checkout.platform.toLowerCase()));
  }

  if (infoOnly === '1') {
    items = items.filter((o) => o.checkout !== null);
  }

  if (minActive > 0) items = items.filter((o) => o.activeAds >= minActive);
  if (minDup > 0) items = items.filter((o) => o.dupMax >= minDup);
  if (minDays > 0) items = items.filter((o) => o.daysMax >= minDays);
  if (maxDays > 0) items = items.filter((o) => o.daysMax <= maxDays);
  if (scaled === '1') items = items.filter((o) => o.scaled);
  if (scaled === '0') items = items.filter((o) => !o.scaled);

  items.sort((a, b) => {
    let diff = 0;
    if (sort === 'score') diff = a.score - b.score;
    else if (sort === 'active') diff = a.activeAds - b.activeAds;
    else if (sort === 'growth') diff = a.growth7d - b.growth7d;
    else if (sort === 'duplicates') diff = a.dupMax - b.dupMax;
    else if (sort === 'days') diff = a.daysMax - b.daysMax;
    else if (sort === 'price') diff = (a.checkout ? a.checkout.priceMin : 0) - (b.checkout ? b.checkout.priceMin : 0);
    else if (sort === 'newest') diff = new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
    else diff = a.score - b.score;

    return order === 'asc' ? diff : -diff;
  });

  return items;
}

export function handleOffers(req, res, reqUrl) {
  const q = (reqUrl.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(reqUrl.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(reqUrl.searchParams.get('pageSize') || '50', 10)));

  const filtered = filterOffers(reqUrl);
  const total = filtered.length;

  const totalActives = filtered.reduce((s, o) => s + o.activeAds, 0);
  const scaledOffersCount = filtered.filter((o) => o.scaled).length;
  const avgScore = total > 0 ? Math.round(filtered.reduce((s, o) => s + o.score, 0) / total) : 0;

  const summary = {
    offers: total,
    activeAds: totalActives,
    scaledOffers: scaledOffersCount,
    avgScore,
  };

  let clusters = undefined;
  if (q) {
    if (q.includes('croch')) {
      clusters = [
        { term: 'passo', count: 1 },
        { term: 'receitas', count: 1 },
        { term: 'amigurumi', count: 1 },
        { term: 'iniciar', count: 1 },
      ];
    } else {
      clusters = [
        { term: 'método', count: Math.min(12, total) },
        { term: 'guia', count: Math.min(9, total) },
        { term: 'curso', count: Math.min(8, total) },
        { term: 'manual', count: Math.min(6, total) },
        { term: 'passo', count: Math.min(5, total) },
      ];
    }
  }

  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  return sendJson(res, 200, {
    ok: true,
    total,
    page,
    pageSize,
    summary,
    clusters,
    items: paged,
  });
}

export function handleOffersCsv(req, res, reqUrl) {
  const filtered = filterOffers(reqUrl);

  const headers = [
    'Domínio',
    'Nota',
    'Escalada',
    'Anúncios Ativos',
    'Total de Anúncios',
    'Crescimento 7d',
    'Máx Duplicados',
    'Dias no Ar',
    'Checkout',
    'Preço Mínimo',
    'Anunciantes',
    'Primeiro Visto',
    'Último Visto',
  ];

  const rows = filtered.map((o) => [
    o.domain,
    o.score,
    o.scaled ? 'Sim' : 'Não',
    o.activeAds,
    o.totalAds,
    o.growth7d,
    o.dupMax,
    o.daysMax,
    o.checkout ? o.checkout.platform : 'Sem checkout',
    o.checkout ? `R$ ${o.checkout.priceMin}` : '-',
    o.advertisers.map((a) => a.name).join(' | '),
    o.firstSeenAt,
    o.lastSeenAt,
  ]);

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="ofertas.csv"',
    'Access-Control-Allow-Origin': '*',
  });
  return res.end(csvContent);
}
