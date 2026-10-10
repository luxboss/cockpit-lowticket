'use strict';
// GET /api/v2/status
const cfg = require('../config');
const { sendJson, sendError } = require('../lib/http');
const apify = require('../collect/apify');
const runner = require('../collect/runner');
const { importedCounts } = require('../import-v1');
const { SP_TODAY_SQL } = require('../db');

const WORKER_ALIVE_MS = 45000; // o worker bate a cada 15 s

async function handleStatus(ctx, req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed');
  const pool = ctx.pool;
  const [tot, hb, kw, nw, imp, pgUsed, byKind] = await Promise.all([
    pool.query(`SELECT (SELECT COUNT(*) FROM spy.ads WHERE dest_type <> 'catalog')::int AS ads, (SELECT COUNT(*) FROM spy.ads WHERE is_active AND dest_type <> 'catalog')::int AS active_ads,
                       (SELECT COUNT(*) FROM spy.advertisers)::int AS advertisers, (SELECT COUNT(DISTINCT domain) FROM spy.ads WHERE dest_type <> 'catalog')::int AS domains`),
    pool.query("SELECT beat_at FROM spy.worker_heartbeat WHERE name = 'worker'"),
    runner.usedToday(pool, 'keyword'),
    runner.usedToday(pool, 'now'),
    importedCounts(pool),
    runner.usedToday(pool, 'page'),
    pool.query(`SELECT kind, COUNT(*)::int AS runs, COALESCE(SUM(received), 0)::int AS received, COALESCE(SUM(cost_usd), 0)::float AS cost
                  FROM spy.collect_runs WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date = ${SP_TODAY_SQL} GROUP BY kind`)
  ]);
  const bk = Object.fromEntries(byKind.rows.map((x) => [x.kind, x]));
  const one = (k) => ({ runs: bk[k] ? bk[k].runs : 0, received: bk[k] ? bk[k].received : 0, costUsd: bk[k] ? Math.round(bk[k].cost * 10000) / 10000 : 0 });
  const beat = hb.rows.length ? hb.rows[0].beat_at : null;
  const t = tot.rows[0];
  const search = { fts: !!ctx.state.fts };
  if (!search.fts) search.warning = 'busca por ILIKE (sem unaccent/pg_trgm): acentos contam e a busca fica mais lenta';
  return sendJson(res, 200, {
    ok: true,
    db: true,
    search,
    apify: {
      configured: apify.configured(), todayAds: kw, dailyLimit: cfg.COLLECT_DAILY_LIMIT, nowTodayAds: nw, nowDailyLimit: cfg.NOW_DAILY_LIMIT,
      // BE-017: uso de hoje por tipo (prioridade: now > page > domain > keyword)
      pageConfigured: apify.pageConfigured(), pageTodayChecks: pgUsed, pageDailyLimit: cfg.PAGE_DAILY_LIMIT, pageChecksPerDay: cfg.PAGE_CHECKS_PER_DAY,
      domainChecksPerDay: cfg.DOMAIN_CHECKS_PER_DAY, domainMaxAds: Math.floor(cfg.DOMAIN_MAX_SHARE * cfg.COLLECT_DAILY_LIMIT),
      byType: { now: one('now'), page: one('page'), domain: one('domain'), keyword: one('keyword') }
    },
    worker: { alive: !!beat && Date.now() - beat.getTime() < WORKER_ALIVE_MS, lastBeatAt: beat ? beat.toISOString() : null },
    totals: { ads: t.ads, activeAds: t.active_ads, advertisers: t.advertisers, domains: t.domains },
    importedFromV1: { ads: imp.ads, advertisers: imp.advertisers, keywords: imp.keywords, landings: imp.landings }
  });
}

module.exports = { handleStatus };
