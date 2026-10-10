'use strict';
// GET /api/v2/home (Inicio, SPEC-009)
const cfg = require('../config');
const { sendJson, invalidParam } = require('../lib/http');
const { parseContext, adContextConds, offerContextConds } = require('../lib/params');
const { SD_SQL, ED_SQL, TODAY } = require('../lib/trend');
const { fetchOfferRows } = require('../offers/rows');

/**
 * Palavras monitoradas com total, novos em 24 h e minicurva de 14 dias (ativos por dia) dos anuncios que cada uma coletou (fonte keyword:id).
 * kad e materializada: sem isso o planejador recalcula as datas a cada par anuncio x dia.
 */
const KEYWORDS_SQL = `
  WITH kad AS MATERIALIZED (
    SELECT s.source, a.first_seen_at, ${SD_SQL('a')} AS sd, ${ED_SQL('a')} AS ed
      FROM spy.ad_sources s JOIN spy.ads a ON a.ad_archive_id = s.ad_archive_id WHERE s.source LIKE 'keyword:%'),
  days AS (SELECT g::date AS d FROM generate_series(${TODAY} - 13, ${TODAY}, INTERVAL '1 day') g),
  pairs AS MATERIALIZED (SELECT source, sd, ed, COUNT(*) AS c FROM kad WHERE sd IS NOT NULL GROUP BY source, sd, ed),
  cnt AS (SELECT p.source, days.d, SUM(p.c) AS n FROM pairs p JOIN days ON p.sd <= days.d AND p.ed >= days.d GROUP BY p.source, days.d),
  tot AS (SELECT source, COUNT(*) AS total, COUNT(*) FILTER (WHERE first_seen_at >= NOW() - INTERVAL '24 hours') AS n24 FROM kad GROUP BY source),
  sp AS (SELECT k.id, ARRAY_AGG(COALESCE(cnt.n, 0)::int ORDER BY days.d) AS spark
           FROM spy.keywords k CROSS JOIN days LEFT JOIN cnt ON cnt.source = 'keyword:' || k.id AND cnt.d = days.d GROUP BY k.id)
  SELECT k.id, k.term, k.country, k.active, COALESCE(tot.total, 0)::int AS ads_total, COALESCE(tot.n24, 0)::int AS new24h, sp.spark
    FROM spy.keywords k LEFT JOIN tot ON tot.source = 'keyword:' || k.id LEFT JOIN sp ON sp.id = k.id ORDER BY k.id`;

let kwCache = null;
/** Palavras da home com cache curto; criar, pausar ou apagar palavra invalida na hora (a coleta, em outro processo, espera o TTL). */
async function keywordRows(pool) {
  const now = Date.now();
  if (kwCache && cfg.HOME_CACHE_MS > 0 && now - kwCache.at < cfg.HOME_CACHE_MS) return kwCache.rows;
  const r = await pool.query(KEYWORDS_SQL);
  kwCache = { at: now, rows: r.rows };
  return r.rows;
}
function invalidateKeywords() { kwCache = null; }

async function handleHome(ctx, req, res, sp) {
  const parsed = parseContext(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const c = parsed.c;
  const pool = ctx.pool;

  const pa = []; const pushA = (v) => { pa.push(v); return '$' + pa.length; };
  const adWhere = ["a.is_active", "a.dest_type = 'offer'"].concat(adContextConds(c, pushA)).join(' AND ');
  const po = []; const pushO = (v) => { po.push(v); return '$' + po.length; };
  const offWhere = ['o.active_ads > 0'].concat(offerContextConds(c, pushO)).join(' AND ');

  const [ads, news, offers, rising, kws, runs] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS active_ads FROM spy.ads a WHERE ${adWhere}`, pa),
    pool.query(`SELECT COUNT(*)::int AS new24h FROM spy.ads a WHERE ${adWhere} AND a.first_seen_at >= NOW() - INTERVAL '24 hours'`, pa),
    pool.query(`SELECT COUNT(*)::int AS offers, COUNT(*) FILTER (WHERE o.scaled)::int AS scaled FROM spy.offer_stats o WHERE ${offWhere}`, po),
    pool.query(`SELECT o.domain FROM spy.offer_stats o WHERE ${offWhere} ORDER BY o.growth_7d DESC, o.score DESC, o.domain LIMIT 10`, po),
    keywordRows(pool),
    pool.query("SELECT id, kind, term, status, inserted, finished_at FROM spy.collect_runs ORDER BY id DESC LIMIT 5")
  ]);
  return sendJson(res, 200, {
    ok: true,
    kpis: { activeAds: ads.rows[0].active_ads, offers: offers.rows[0].offers, scaledOffers: offers.rows[0].scaled, new24h: news.rows[0].new24h },
    rising: await fetchOfferRows(pool, rising.rows.map((r) => r.domain)),
    keywords: kws.map((k) => ({ id: Number(k.id), term: k.term, country: k.country, active: k.active, adsTotal: k.ads_total, new24h: k.new24h, spark: k.spark || new Array(14).fill(0) })),
    lastRuns: runs.rows.map((r) => ({ id: Number(r.id), kind: r.kind, term: r.term, status: r.status, inserted: r.inserted, finishedAt: r.finished_at ? r.finished_at.toISOString() : null }))
  });
}

module.exports = { handleHome, KEYWORDS_SQL, invalidateKeywords };
