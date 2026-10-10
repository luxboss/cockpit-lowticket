'use strict';
// Explorar Ofertas (GET /api/v2/offers e offers.csv): parametros, lista paginada de spy.offer_stats, resumo e grupos de termos.
// Sem busca de texto le so offer_stats. Com q, term, include ou exclude primeiro acha os dominios dos anuncios ativos que casam
// (agrupados por dominio) e junta com offer_stats; os numeros da oferta continuam sendo os da oferta inteira.
const { parseContext, adContextConds, offerContextConds } = require('../lib/params');
const { textCondition, likeEsc } = require('../search');
const { buildClusters } = require('../lib/clusters');
const { fetchOfferRows } = require('./rows');

const FIELDS = ['all', 'text', 'advertiser', 'domain', 'url', 'landing'];
const SORTS = {
  score: 'f.score', active: 'f.active_ads', growth: 'f.growth_7d', duplicates: 'f.dup_max', days: 'f.days_max', price: 'f.price_min', newest: 'f.first_seen_at'
};
const MAX_OFFSET = 10000;
const SAMPLE = 3000;

/** URLSearchParams -> {p} ou {error}. csv=true ignora page/pageSize (o CSV vai ate 5 mil linhas). */
function parseOffersParams(sp, csv) {
  const ctx = parseContext(sp);
  if (ctx.error) return { error: ctx.error };
  const p = Object.assign({ q: '', field: 'all', term: '', include: '', exclude: '', checkout: [], sort: 'score', order: 'desc', page: 1, pageSize: 50 }, ctx.c);
  const text = (k, max) => {
    let v = sp.get(k);
    if (v === null) return true;
    v = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (v.length > max) return false;
    p[k] = v;
    return true;
  };
  if (!text('q', 200)) return { error: 'q' };
  if (!text('term', 80)) return { error: 'term' };
  if (!text('include', 200)) return { error: 'include' };
  if (!text('exclude', 200)) return { error: 'exclude' };
  let v = sp.get('field');
  if (v !== null && v !== '') { if (!FIELDS.includes(v)) return { error: 'field' }; p.field = v; }
  v = sp.get('checkout');
  if (v !== null && v !== '') {
    const list = v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!list.length || list.length > 20 || list.some((x) => !/^[a-z0-9_-]{1,30}$/.test(x))) return { error: 'checkout' };
    p.checkout = list;
  }
  for (const k of ['minActive', 'minDup', 'minDays', 'maxDays']) {
    v = sp.get(k);
    if (v !== null && v !== '') { if (!/^\d{1,7}$/.test(v)) return { error: k }; p[k] = parseInt(v, 10); }
  }
  if (p.minDays !== undefined && p.maxDays !== undefined && p.minDays > p.maxDays) return { error: 'maxDays' };
  v = sp.get('scaled');
  if (v !== null && v !== '') { if (v !== '0' && v !== '1') return { error: 'scaled' }; p.scaled = v === '1'; }
  v = sp.get('sort');
  if (v !== null && v !== '') { if (!SORTS[v]) return { error: 'sort' }; p.sort = v; }
  v = sp.get('order');
  if (v !== null && v !== '') { if (v !== 'desc' && v !== 'asc') return { error: 'order' }; p.order = v; }
  if (csv) { p.page = 1; p.pageSize = 5000; return { p }; }
  v = sp.get('page');
  if (v !== null && v !== '') { if (!/^\d{1,6}$/.test(v) || parseInt(v, 10) < 1) return { error: 'page' }; p.page = parseInt(v, 10); }
  v = sp.get('pageSize');
  if (v !== null && v !== '') { if (!/^\d{1,3}$/.test(v) || parseInt(v, 10) < 1 || parseInt(v, 10) > 100) return { error: 'pageSize' }; p.pageSize = parseInt(v, 10); }
  if ((p.page - 1) * p.pageSize > MAX_OFFSET) return { error: 'page' };
  return { p };
}

/** include (todas as palavras) / exclude (qualquer uma) sobre o texto do anuncio. */
function wordCond(str, any, negate, fts, push) {
  const words = (str.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 10);
  if (!words.length) return null;
  let c;
  if (fts) {
    c = `a.search_tsv @@ websearch_to_tsquery('spy.pt', ${push(words.join(any ? ' or ' : ' '))})`;
  } else {
    const one = (w) => { const n = push('%' + likeEsc(w) + '%'); return `(a.body ILIKE ${n} OR a.title ILIKE ${n} OR a.caption ILIKE ${n})`; };
    c = '(' + words.map(one).join(any ? ' OR ' : ' AND ') + ')';
  }
  return negate ? `NOT (${c})` : c;
}

/** Condicoes sobre os anuncios ativos que casam com a busca. false = nada pode casar. null = sem busca de texto. */
async function adLevelConds(pool, p, fts, push) {
  if (!p.q && !p.term && !p.include && !p.exclude) return null;
  const conds = ['a.is_active', "a.dest_type = 'offer'", 'a.domain IS NOT NULL'];
  if (p.q) {
    const c = await textCondition(pool, { q: p.q, field: p.field }, fts, push);
    if (c === false) return false;
    conds.push(c);
  }
  if (p.term) { const c = wordCond(p.term, false, false, fts, push); if (c) conds.push(c); }
  if (p.include) { const c = wordCond(p.include, false, false, fts, push); if (c) conds.push(c); }
  if (p.exclude) { const c = wordCond(p.exclude, true, true, fts, push); if (c) conds.push(c); }
  for (const c of adContextConds(p, push)) conds.push(c);
  return conds;
}

/** Executa. Retorna {total, summary, clusters (so com q), items:[OfferRow]}. */
async function runOffers(pool, p, fts) {
  const params = [];
  const push = (v) => { params.push(v); return '$' + params.length; };
  const adConds = await adLevelConds(pool, p, fts, push);
  const empty = { total: 0, summary: { offers: 0, activeAds: 0, scaledOffers: 0, avgScore: 0 }, clusters: p.q ? [] : undefined, items: [] };
  if (adConds === false) return empty;
  const adParams = params.slice(); // so o que as condicoes de anuncio usam (a amostra de termos roda com elas)

  const conds = ['o.active_ads >= ' + Math.max(1, p.minActive || 0)];
  if (!adConds) for (const c of offerContextConds(p, push)) conds.push(c);
  if (p.minDup !== undefined) conds.push('o.dup_max >= ' + p.minDup);
  if (p.minDays !== undefined) conds.push('o.days_max >= ' + p.minDays);
  if (p.maxDays !== undefined) conds.push('o.days_max <= ' + p.maxDays);
  if (p.scaled) conds.push('o.scaled');
  if (p.checkout.length) conds.push(`l.checkout_platform = ANY(${push(p.checkout)}::text[])`);
  const sortExpr = SORTS[p.sort];
  const dir = p.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(p.pageSize, 5000);
  const offset = (p.page - 1) * p.pageSize;

  const sql = `
    ${adConds ? `WITH m AS MATERIALIZED (SELECT a.domain, COUNT(*)::int AS c FROM spy.ads a WHERE ${adConds.join(' AND ')} GROUP BY a.domain),` : 'WITH'}
    f AS MATERIALIZED (
      SELECT o.domain, o.score, o.scaled, o.active_ads, o.growth_7d, o.dup_max, o.days_max, o.first_seen_at, l.price_min,
             ${adConds ? 'm.c' : 'o.active_ads'} AS shown_ads
        FROM spy.offer_stats o LEFT JOIN spy.landings l ON l.domain = o.domain ${adConds ? 'JOIN m ON m.domain = o.domain' : ''}
       WHERE ${conds.join(' AND ')})
    SELECT (SELECT jsonb_build_object('offers', COUNT(*), 'activeAds', COALESCE(SUM(shown_ads), 0), 'scaledOffers', COUNT(*) FILTER (WHERE scaled), 'avgScore', COALESCE(AVG(score), 0)) FROM f) AS summary,
           (SELECT COALESCE(array_agg(domain ORDER BY rn), '{}') FROM (
              SELECT domain, ROW_NUMBER() OVER (ORDER BY ${sortExpr} ${dir} NULLS LAST, domain ASC) AS rn FROM f ORDER BY rn LIMIT ${limit} OFFSET ${offset}) t) AS domains`;

  const sampleP = adConds && p.q ? pool.query(
    `SELECT a.domain, left(a.body, 600) || ' ' || a.title AS t FROM spy.ads a WHERE ${adConds.join(' AND ')} ORDER BY a.score DESC, a.ad_archive_id LIMIT ${SAMPLE}`, adParams) : null;
  const [main, sample] = await Promise.all([pool.query(sql, params), sampleP]);
  const row = main.rows[0];
  const s = row.summary;
  const items = await fetchOfferRows(pool, row.domains);
  return {
    total: s.offers,
    summary: { offers: s.offers, activeAds: Number(s.activeAds), scaledOffers: s.scaledOffers, avgScore: Math.round(Number(s.avgScore) * 10) / 10 },
    clusters: p.q ? buildClusters(sample ? sample.rows : [], [p.q, p.term, p.include].join(' ')) : undefined, // termos ja usados na busca nao voltam como grupo
    items
  };
}

module.exports = { parseOffersParams, runOffers };
