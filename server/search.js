'use strict';
// Busca de anuncios (GET /api/v2/search): validacao dos parametros, montagem do SQL parametrizado e AdCard.
const { INFO_PLATFORMS } = require('./lib/nonoffer');

const FIELDS = ['all', 'text', 'advertiser', 'domain', 'url', 'landing'];
const SORTS = ['longest', 'last_seen', 'newest', 'duplicates', 'score'];
const FORMATS = ['IMAGE', 'VIDEO', 'CAROUSEL'];
const SEEN = { '24h': '24 hours', '3d': '3 days', '7d': '7 days', '30d': '30 days' };
const MAX_OFFSET = 10000;
const SIDE_LIMIT = 3000; // dominios/paginas que casam com o texto e entram na consulta principal como lista

// Ordenacao por sort; col(a) devolve a expressao com o alias. Desempate sempre pelo id (estavel entre paginas).
const ORDER = {
  score: (a) => `${a}.score DESC, ${a}.ad_archive_id ASC`,
  longest: (a) => `${a}.start_date ASC NULLS LAST, ${a}.ad_archive_id ASC`,
  newest: (a) => `${a}.start_date DESC NULLS LAST, ${a}.ad_archive_id ASC`,
  last_seen: (a) => `${a}.last_seen_at DESC, ${a}.ad_archive_id ASC`,
  duplicates: (a) => `${a}.duplicates DESC, ${a}.ad_archive_id ASC`
};

const DAYS_SQL = (a) => `CASE WHEN ${a}.start_date IS NULL THEN NULL ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM
  (CASE WHEN ${a}.is_active THEN NOW() ELSE COALESCE(${a}.end_date, ${a}.last_seen_at) END - ${a}.start_date)) / 86400))::int END`;

/** Colunas do AdCard a partir de spy.ads (alias a): corpo cortado em 280, miniatura e flag de video ja calculados. */
const CARD_COLS = (a) => `${a}.ad_archive_id, ${a}.page_id, ${a}.domain, left(${a}.body, 280) AS body, ${a}.title, ${a}.cta_text, ${a}.link_url,
  ${a}.display_format, ${a}.countries, ${a}.language, ${a}.start_date, ${a}.end_date, ${a}.last_seen_at, ${a}.is_active, ${a}.duplicates, ${a}.score,
  COALESCE(NULLIF(${a}.media->'images'->>0, ''), NULLIF(${a}.media->'videos'->0->>'preview', '')) AS thumb_url,
  (jsonb_array_length(COALESCE(${a}.media->'videos', '[]'::jsonb)) > 0) AS has_video`;

/** Colunas extras do AdCard vindas dos joins (anunciante e landing) com os aliases adv e l. */
const CARD_JOIN_COLS = 'adv.name AS adv_name, adv.avatar_url AS adv_avatar, l.checkout_platform, l.price_min';

function cardFromRow(r) {
  return {
    id: r.ad_archive_id,
    advertiser: { pageId: r.page_id || null, name: r.adv_name || '', avatarUrl: r.adv_avatar || null },
    thumbUrl: r.thumb_url || null,
    format: r.display_format,
    hasVideo: !!r.has_video || r.display_format === 'VIDEO',
    body: r.body || '',
    title: r.title || '',
    cta: r.cta_text || '',
    domain: r.domain || null,
    linkUrl: r.link_url || '',
    countries: r.countries || [],
    language: r.language || null,
    startDate: r.start_date ? r.start_date.toISOString() : null,
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
    daysRunning: r.days_running === null || r.days_running === undefined ? null : r.days_running,
    isActive: !!r.is_active,
    duplicates: r.duplicates,
    checkout: r.checkout_platform ? { platform: r.checkout_platform, priceMin: r.price_min === null || r.price_min === undefined ? null : Number(r.price_min) } : null,
    score: Number(r.score)
  };
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** URLSearchParams -> {p} ou {error: nome do parametro}. Parametros desconhecidos sao ignorados. */
function parseSearchParams(sp) {
  const get = (k) => (sp.has(k) ? sp.get(k) : null);
  const p = { q: '', field: 'all', status: 'active', sort: 'score', page: 1, pageSize: 24, checkout: [], infoOnly: false };
  let v = get('q');
  if (v !== null) {
    v = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (v.length > 200) return { error: 'q' };
    p.q = v;
  }
  if ((v = get('field')) !== null && v !== '') { if (!FIELDS.includes(v)) return { error: 'field' }; p.field = v; }
  if ((v = get('country')) !== null && v !== '') { if (!/^[A-Za-z]{2}$/.test(v)) return { error: 'country' }; p.country = v.toUpperCase(); }
  if ((v = get('language')) !== null && v !== '') { if (!['pt', 'es', 'en'].includes(v)) return { error: 'language' }; p.language = v; }
  if ((v = get('format')) !== null && v !== '') { if (!FORMATS.includes(v.toUpperCase())) return { error: 'format' }; p.format = v.toUpperCase(); }
  if ((v = get('cta')) !== null && v !== '') { if (v.length > 100) return { error: 'cta' }; p.cta = v; }
  if ((v = get('checkout')) !== null && v !== '') {
    const list = v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!list.length || list.length > 20 || list.some((x) => !/^[a-z0-9_-]{1,30}$/.test(x))) return { error: 'checkout' };
    p.checkout = list;
  }
  if ((v = get('infoOnly')) !== null && v !== '') { if (v !== '0' && v !== '1') return { error: 'infoOnly' }; p.infoOnly = v === '1'; }
  for (const k of ['minDays', 'maxDays']) {
    if ((v = get(k)) !== null && v !== '') { if (!/^\d{1,4}$/.test(v)) return { error: k }; p[k] = parseInt(v, 10); }
  }
  if (p.minDays !== undefined && p.maxDays !== undefined && p.minDays > p.maxDays) return { error: 'maxDays' };
  for (const k of ['createdFrom', 'createdTo']) {
    if ((v = get(k)) !== null && v !== '') { if (!validDate(v)) return { error: k }; p[k] = v; }
  }
  if (p.createdFrom && p.createdTo && p.createdFrom > p.createdTo) return { error: 'createdTo' };
  if ((v = get('seenWithin')) !== null && v !== '') { if (!SEEN[v]) return { error: 'seenWithin' }; p.seenWithin = SEEN[v]; }
  if ((v = get('minDup')) !== null && v !== '') { if (!/^\d{1,7}$/.test(v) || parseInt(v, 10) < 1) return { error: 'minDup' }; p.minDup = parseInt(v, 10); }
  if ((v = get('status')) !== null && v !== '') { if (v !== 'active' && v !== 'all') return { error: 'status' }; p.status = v; }
  if ((v = get('sort')) !== null && v !== '') { if (!SORTS.includes(v)) return { error: 'sort' }; p.sort = v; }
  if ((v = get('page')) !== null && v !== '') { if (!/^\d{1,6}$/.test(v) || parseInt(v, 10) < 1) return { error: 'page' }; p.page = parseInt(v, 10); }
  if ((v = get('pageSize')) !== null && v !== '') { if (!/^\d{1,3}$/.test(v) || parseInt(v, 10) < 1 || parseInt(v, 10) > 60) return { error: 'pageSize' }; p.pageSize = parseInt(v, 10); }
  if ((p.page - 1) * p.pageSize > MAX_OFFSET) return { error: 'page' };
  return { p };
}

const likeEsc = (s) => s.replace(/[\\%_]/g, '\\$&');

/** Condicao de texto da barra de busca. Devolve a string SQL, ou false quando nada pode casar (resultado vazio sem consultar). */
async function textCondition(pool, p, fts, push) {
  const q = p.q;
  const like = '%' + likeEsc(q) + '%';
  const un = (e) => (fts ? `spy.f_unaccent(lower(${e}))` : `lower(${e})`);
  const tsq = () => `websearch_to_tsquery('spy.pt', ${push(q)})`;
  const sideAdvertisers = async () => {
    const r = await pool.query(`SELECT page_id FROM spy.advertisers WHERE ${un('name')} LIKE ${un('$1')} LIMIT ${SIDE_LIMIT}`, [like]);
    return r.rows.map((x) => x.page_id);
  };
  const sideLanding = async () => {
    const r = fts
      ? await pool.query(`SELECT domain FROM spy.landings WHERE text_tsv @@ websearch_to_tsquery('spy.pt', $1) LIMIT ${SIDE_LIMIT}`, [q])
      : await pool.query(`SELECT domain FROM spy.landings WHERE text ILIKE $1 OR title ILIKE $1 LIMIT ${SIDE_LIMIT}`, [like]);
    return r.rows.map((x) => x.domain);
  };
  const adText = () => (fts ? `a.search_tsv @@ ${tsq()}` : (() => { const n = push(like); return `(a.body ILIKE ${n} OR a.title ILIKE ${n} OR a.caption ILIKE ${n})`; })());
  const domainPattern = () => {
    const d = q.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    return '%' + likeEsc(d) + '%';
  };

  switch (p.field) {
    case 'text': return adText();
    case 'url': return `a.link_url ILIKE ${push(like)}`;
    case 'domain': return `a.domain ILIKE ${push(domainPattern())}`;
    case 'advertiser': {
      const pages = await sideAdvertisers();
      return pages.length ? `a.page_id = ANY(${push(pages)}::text[])` : false;
    }
    case 'landing': {
      const doms = await sideLanding();
      return doms.length ? `a.domain = ANY(${push(doms)}::text[])` : false;
    }
    default: { // all: texto do anuncio, anunciante, dominio e texto da landing
      const parts = [adText()];
      const [pages, doms] = await Promise.all([sideAdvertisers(), sideLanding()]);
      if (pages.length) parts.push(`a.page_id = ANY(${push(pages)}::text[])`);
      if (doms.length) parts.push(`a.domain = ANY(${push(doms)}::text[])`);
      if (q.length >= 3 && !/\s/.test(q)) parts.push(`a.domain ILIKE ${push(domainPattern())}`);
      return '(' + parts.join(' OR ') + ')';
    }
  }
}

/** Executa a busca. Retorna {total, items}. */
async function runSearch(pool, p, fts) {
  const params = [];
  const push = (v) => { params.push(v); return '$' + params.length; };
  const conds = [];
  if (p.status === 'active') conds.push('a.is_active');
  conds.push("a.dest_type = 'offer'"); // lojas de app, marketplaces e redes sociais ficam fora
  if (p.q) {
    const c = await textCondition(pool, p, fts, push);
    if (c === false) return { total: 0, items: [] };
    conds.push(c);
  }
  if (p.country) conds.push(`a.countries @> ARRAY[${push(p.country)}]::text[]`);
  if (p.language) conds.push(`a.language = ${push(p.language)}`);
  if (p.format) conds.push(`a.display_format = ${push(p.format)}`);
  if (p.cta) conds.push(`a.cta_text = ${push(p.cta)}`);
  if (p.infoOnly) conds.push(`a.domain IN (SELECT l.domain FROM spy.landings l WHERE l.checkout_platform = ANY(${push(INFO_PLATFORMS)}::text[]))`);
  if (p.checkout.length) conds.push(`a.domain IN (SELECT l.domain FROM spy.landings l WHERE l.checkout_platform = ANY(${push(p.checkout)}::text[]))`);
  // tempo no ar em dias: ativo conta ate agora; encerrado ate a data de fim (ou ultima vez visto)
  const endExpr = p.status === 'active' ? 'NOW()' : 'CASE WHEN a.is_active THEN NOW() ELSE COALESCE(a.end_date, a.last_seen_at) END';
  if (p.minDays !== undefined) conds.push(`a.start_date IS NOT NULL AND a.start_date <= ${endExpr} - (${push(p.minDays)}::int * INTERVAL '1 day')`);
  if (p.maxDays !== undefined) conds.push(`a.start_date IS NOT NULL AND a.start_date > ${endExpr} - ((${push(p.maxDays)}::int + 1) * INTERVAL '1 day')`);
  // datas YYYY-MM-DD valem em America/Sao_Paulo (o mesmo dia usado nas cotas), nao no fuso da sessao do banco
  if (p.createdFrom) conds.push(`a.start_date >= ${push(p.createdFrom)}::date::timestamp AT TIME ZONE 'America/Sao_Paulo'`);
  if (p.createdTo) conds.push(`a.start_date < (${push(p.createdTo)}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'`);
  if (p.seenWithin) conds.push(`a.last_seen_at >= NOW() - ${push(p.seenWithin)}::interval`);
  if (p.minDup) conds.push(`a.duplicates >= ${push(p.minDup)}`);

  const where = conds.join(' AND ');
  const limit = push(p.pageSize);
  const offset = push((p.page - 1) * p.pageSize);
  const order = ORDER[p.sort];
  const countParams = params.slice(0, params.length - 2);
  const [cnt, rows] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM spy.ads a WHERE ${where}`, countParams),
    pool.query(
      `WITH page AS MATERIALIZED (
         SELECT ${CARD_COLS('a')} FROM spy.ads a WHERE ${where} ORDER BY ${order('a')} LIMIT ${limit} OFFSET ${offset})
       SELECT a.*, ${DAYS_SQL('a')} AS days_running, ${CARD_JOIN_COLS}
         FROM page a LEFT JOIN spy.advertisers adv ON adv.page_id = a.page_id LEFT JOIN spy.landings l ON l.domain = a.domain
        ORDER BY ${order('a')}`, params)
  ]);
  return { total: cnt.rows[0].n, items: rows.rows.map(cardFromRow) };
}

module.exports = { parseSearchParams, runSearch, cardFromRow, CARD_COLS, CARD_JOIN_COLS, DAYS_SQL, ORDER };
