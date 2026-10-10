'use strict';
// GET /api/v2/advertisers/:pageId (Visao do Anunciante) e GET /api/v2/compare (Comparar Ofertas), SPEC-009
const { sendJson, sendError, invalidParam } = require('../lib/http');
const { parseContext, adContextConds } = require('../lib/params');
const { fetchOfferRows } = require('../offers/rows');
const { entityDetail, trendOf } = require('../offers/detail');
const { HOSTNAME_REGEX } = require('../lib/text');

async function handleAdvertiser(ctx, req, res, pageIdRaw, sp) {
  const pageId = decodeURIComponent(pageIdRaw);
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(pageId)) return sendError(res, 404, 'not_found');
  const parsed = parseContext(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const c = parsed.c;
  const pool = ctx.pool;
  const adv = await pool.query('SELECT page_id, name, avatar_url, first_seen_at, last_seen_at FROM spy.advertisers WHERE page_id = $1', [pageId]);
  if (!adv.rows.length) return sendError(res, 404, 'not_found');
  const a = adv.rows[0];

  const params = [pageId];
  const push = (v) => { params.push(v); return '$' + params.length; };
  const where = ["a.dest_type = 'offer'", 'a.page_id = $1'].concat(adContextConds(c, push)).join(' AND ');
  const [d, k, off] = await Promise.all([
    entityDetail(pool, where, params, c.period, false),
    pool.query(`SELECT COUNT(*) FILTER (WHERE a.is_active)::int AS active_ads, COUNT(*)::int AS total_ads, COUNT(DISTINCT a.domain) FILTER (WHERE a.is_active)::int AS offers
                  FROM spy.ads a WHERE ${where}`, params),
    pool.query(`SELECT o.domain FROM spy.offer_stats o WHERE o.domain IN (SELECT a.domain FROM spy.ads a WHERE ${where} AND a.is_active AND a.domain IS NOT NULL)
                 ORDER BY o.score DESC, o.domain LIMIT 50`, params)
  ]);
  const kp = k.rows[0];
  return sendJson(res, 200, {
    ok: true,
    advertiser: {
      pageId: a.page_id, name: a.name, avatarUrl: a.avatar_url || null,
      firstSeenAt: a.first_seen_at ? a.first_seen_at.toISOString() : null, lastSeenAt: a.last_seen_at ? a.last_seen_at.toISOString() : null,
      kpis: { activeAds: kp.active_ads, offers: kp.offers, totalAds: kp.total_ads },
      trend: d.trend,
      offers: await fetchOfferRows(pool, off.rows.map((x) => x.domain)),
      topAds: d.topAds
    }
  });
}

async function handleCompare(ctx, req, res, sp) {
  const raw = sp.get('domains');
  if (raw === null) return invalidParam(res, 'domains');
  const domains = [];
  for (const part of raw.split(',')) {
    const d = part.trim().toLowerCase().replace(/^www\./, '');
    if (!d) continue;
    if (!HOSTNAME_REGEX.test(d)) return invalidParam(res, 'domains');
    if (!domains.includes(d)) domains.push(d);
  }
  if (domains.length < 2 || domains.length > 5) return invalidParam(res, 'domains');
  const parsed = parseContext(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const c = parsed.c;
  const rows = await fetchOfferRows(ctx.pool, domains);
  const found = new Set(rows.map((r) => r.domain));
  const trends = await Promise.all(rows.map((r) => {
    const params = [r.domain];
    const push = (v) => { params.push(v); return '$' + params.length; };
    const where = ["a.dest_type = 'offer'", 'a.domain = $1'].concat(adContextConds(c, push)).join(' AND ');
    return trendOf(ctx.pool, where, params, c.period);
  }));
  return sendJson(res, 200, { ok: true, items: rows.map((r, i) => Object.assign(r, { trend: trends[i] })), missing: domains.filter((d) => !found.has(d)) });
}

module.exports = { handleAdvertiser, handleCompare };
