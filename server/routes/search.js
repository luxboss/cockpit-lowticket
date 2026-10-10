'use strict';
// GET /api/v2/search e GET /api/v2/filters
const cfg = require('../config');
const { sendJson, invalidParam } = require('../lib/http');
const { parseSearchParams, runSearch } = require('../search');

async function handleSearch(ctx, req, res, sp) {
  const parsed = parseSearchParams(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const p = parsed.p;
  const r = await runSearch(ctx.pool, p, ctx.state.fts);
  return sendJson(res, 200, { ok: true, total: r.total, page: p.page, pageSize: p.pageSize, items: r.items });
}

let filtersCache = null;
const ACTIVE = "a.is_active AND a.dest_type = 'offer'";

/** Contagens sobre os anuncios ativos (destinos de oferta). Cache curto: a consulta agrupa o banco inteiro. */
async function handleFilters(ctx, req, res) {
  const now = Date.now();
  if (filtersCache && cfg.FILTERS_CACHE_MS > 0 && now - filtersCache.at < cfg.FILTERS_CACHE_MS) return sendJson(res, 200, filtersCache.body);
  const q = (sql) => ctx.pool.query(sql).then((r) => r.rows.map((x) => ({ id: x.id, count: x.count })));
  const [countries, languages, formats, ctas, checkouts] = await Promise.all([
    q(`SELECT c AS id, COUNT(*)::int AS count FROM spy.ads a, unnest(a.countries) c WHERE ${ACTIVE} GROUP BY c ORDER BY count DESC, c`),
    q(`SELECT a.language AS id, COUNT(*)::int AS count FROM spy.ads a WHERE ${ACTIVE} AND a.language IS NOT NULL GROUP BY a.language ORDER BY count DESC, id`),
    q(`SELECT a.display_format AS id, COUNT(*)::int AS count FROM spy.ads a WHERE ${ACTIVE} GROUP BY a.display_format ORDER BY count DESC, id`),
    q(`SELECT a.cta_text AS id, COUNT(*)::int AS count FROM spy.ads a WHERE ${ACTIVE} AND a.cta_text <> '' GROUP BY a.cta_text ORDER BY count DESC, id LIMIT 30`),
    q(`SELECT l.checkout_platform AS id, COUNT(*)::int AS count FROM spy.ads a JOIN spy.landings l ON l.domain = a.domain
        WHERE ${ACTIVE} AND l.checkout_platform IS NOT NULL GROUP BY l.checkout_platform ORDER BY count DESC, id`)
  ]);
  const body = { ok: true, countries, languages, formats, ctas, checkouts };
  filtersCache = { at: now, body };
  return sendJson(res, 200, body);
}

module.exports = { handleSearch, handleFilters };
