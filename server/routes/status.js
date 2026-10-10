'use strict';
// GET /api/v2/status
const cfg = require('../config');
const { sendJson, sendError } = require('../lib/http');
const apify = require('../collect/apify');
const runner = require('../collect/runner');
const { importedCounts } = require('../import-v1');

const WORKER_ALIVE_MS = 45000; // o worker bate a cada 15 s

async function handleStatus(ctx, req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed');
  const pool = ctx.pool;
  const [tot, hb, kw, nw, imp] = await Promise.all([
    pool.query(`SELECT (SELECT COUNT(*) FROM spy.ads)::int AS ads, (SELECT COUNT(*) FROM spy.ads WHERE is_active)::int AS active_ads,
                       (SELECT COUNT(*) FROM spy.advertisers)::int AS advertisers, (SELECT COUNT(DISTINCT domain) FROM spy.ads)::int AS domains`),
    pool.query("SELECT beat_at FROM spy.worker_heartbeat WHERE name = 'worker'"),
    runner.usedToday(pool, 'keyword'),
    runner.usedToday(pool, 'now'),
    importedCounts(pool)
  ]);
  const beat = hb.rows.length ? hb.rows[0].beat_at : null;
  const t = tot.rows[0];
  const search = { fts: !!ctx.state.fts };
  if (!search.fts) search.warning = 'busca por ILIKE (sem unaccent/pg_trgm): acentos contam e a busca fica mais lenta';
  return sendJson(res, 200, {
    ok: true,
    db: true,
    search,
    apify: { configured: apify.configured(), todayAds: kw, dailyLimit: cfg.COLLECT_DAILY_LIMIT, nowTodayAds: nw, nowDailyLimit: cfg.NOW_DAILY_LIMIT },
    worker: { alive: !!beat && Date.now() - beat.getTime() < WORKER_ALIVE_MS, lastBeatAt: beat ? beat.toISOString() : null },
    totals: { ads: t.ads, activeAds: t.active_ads, advertisers: t.advertisers, domains: t.domains },
    importedFromV1: { ads: imp.ads, advertisers: imp.advertisers, keywords: imp.keywords, landings: imp.landings }
  });
}

module.exports = { handleStatus };
