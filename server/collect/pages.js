'use strict';
// Escala real (BE-017): total real de anuncios ativos por anunciante (AC-01) e candidatos das buscas por pagina e por dominio (AC-01 e AC-02).
// Forma mais barata de obter o total: o actor apify~facebook-ads-scraper com onlyTotal devolve UM item por pagina com totalCount, sem baixar
// os anuncios (cobra 1 item, ~US$ 0,0058 no plano gratis). Se o actor configurado nao tiver onlyTotal, baixa ate SPY_PAGE_SAMPLE_ADS anuncios e usa a
// contagem como minimo (source = sample).
const cfg = require('../config');
const apify = require('./apify');
const { INFO_PLATFORMS } = require('../lib/nonoffer');
const { SP_TODAY_SQL } = require('../db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Quantas execucoes do tipo (page|domain) ja comecaram hoje (dia de Sao Paulo). */
async function runsToday(pool, kind) {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM spy.collect_runs WHERE kind = $1 AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date = ${SP_TODAY_SQL}`, [kind]);
  return r.rows[0].n;
}

/**
 * Proximo anunciante a consultar. Ordem: tem oferta com checkout de infoproduto; duplicados >= 3; crescimento > 0; maior nota;
 * so quem nunca foi consultado ou foi ha mais de PAGE_RECHECK_DAYS dias (e sem falha nas ultimas 6 h).
 */
async function pickPage(pool) {
  const r = await pool.query(
    `SELECT a.page_id
       FROM spy.ads a
       JOIN spy.advertisers v ON v.page_id = a.page_id
       LEFT JOIN spy.landings l ON l.domain = a.domain
       LEFT JOIN spy.offer_stats o ON o.domain = a.domain
      WHERE a.is_active AND a.dest_type = 'offer' AND a.page_id ~ '^[0-9]{3,30}$'
        AND (v.checked_at IS NULL OR v.checked_at < NOW() - ($2::int * INTERVAL '1 day'))
        AND NOT EXISTS (SELECT 1 FROM spy.collect_runs r WHERE r.kind = 'page' AND r.term = a.page_id AND r.status = 'failed' AND r.started_at > NOW() - INTERVAL '6 hours')
      GROUP BY a.page_id
      ORDER BY COALESCE(BOOL_OR(l.checkout_platform = ANY($1::text[])), false) DESC,
               (MAX(a.duplicates) >= 3) DESC,
               (COALESCE(MAX(o.growth_7d), 0) > 0) DESC,
               COALESCE(MAX(o.score), 0) DESC, a.page_id
      LIMIT 1`, [INFO_PLATFORMS, cfg.PAGE_RECHECK_DAYS]);
  return r.rows.length ? r.rows[0].page_id : null;
}

/** Proximo dominio de produtor para buscar na Biblioteca: ofertas com checkout de infoproduto primeiro, depois a maior nota; nao repete antes de DOMAIN_RECHECK_DAYS. */
async function pickDomain(pool) {
  const r = await pool.query(
    `SELECT o.domain FROM spy.offer_stats o
       LEFT JOIN spy.landings l ON l.domain = o.domain
       LEFT JOIN spy.domain_checks d ON d.domain = o.domain
      WHERE o.active_ads > 0 AND (d.checked_at IS NULL OR d.checked_at < NOW() - ($2::int * INTERVAL '1 day'))
        AND NOT EXISTS (SELECT 1 FROM spy.collect_runs r WHERE r.kind = 'domain' AND r.term = o.domain AND r.status = 'failed' AND r.started_at > NOW() - INTERVAL '6 hours')
      ORDER BY COALESCE(l.checkout_platform = ANY($1::text[]), false) DESC, o.score DESC, o.domain LIMIT 1`, [INFO_PLATFORMS, cfg.DOMAIN_RECHECK_DAYS]);
  return r.rows.length ? r.rows[0].domain : null;
}

/** Totais do item(ns) do dataset: {total, source}. */
function readTotal(items, mode) {
  if (mode === 'total') {
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      for (const k of ['totalCount', 'total', 'adsCount', 'totalAds']) {
        const n = Number(it[k]);
        if (it[k] !== undefined && it[k] !== null && Number.isFinite(n) && n >= 0) return { total: Math.floor(n), source: 'onlyTotal' };
      }
    }
    return null;
  }
  return { total: items.length, source: 'sample' }; // minimo: so o que foi baixado
}

/**
 * Consulta o total real de anuncios ativos da pagina. run = linha de spy.collect_runs (kind page, term = page_id).
 * Devolve {status, total, source, cost, domains}; nunca lanca.
 */
async function checkPage(pool, run) {
  try {
    const ad = apify.pageAdapter();
    if (!apify.pageConfigured() || !ad) throw apify.collectError('apify_not_configured');
    const input = ad.buildTotalInput(run.term, run.country);
    const started = await apify.apifyCall('POST', `/v2/acts/${encodeURIComponent(cfg.APIFY_PAGE_ACTOR)}/runs`, input);
    const info = started.data && started.data.data;
    const okId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
    if (!info || !okId(info.id) || !okId(info.defaultDatasetId)) throw apify.collectError('apify_invalid_response');
    await pool.query('UPDATE spy.collect_runs SET apify_run_id = $2 WHERE id = $1', [run.id, info.id]);
    const deadline = Date.now() + cfg.COLLECT_RUN_TIMEOUT_MS;
    let runInfo = info;
    while (!apify.TERMINAL.has(runInfo.status)) {
      if (Date.now() >= deadline) { try { await apify.apifyCall('POST', `/v2/actor-runs/${encodeURIComponent(info.id)}/abort`, {}); } catch (e) { /* melhor esforco */ } throw apify.collectError('collect_timeout'); }
      await sleep(Math.max(1, Math.min(cfg.COLLECT_POLL_MS, deadline - Date.now())));
      const polled = await apify.apifyCall('GET', `/v2/actor-runs/${encodeURIComponent(info.id)}`);
      runInfo = polled.data && polled.data.data;
      if (!runInfo || typeof runInfo.status !== 'string') throw apify.collectError('apify_invalid_response');
    }
    if (runInfo.status !== 'SUCCEEDED') throw apify.collectError('apify_run_' + runInfo.status.toLowerCase().replace(/[^a-z-]/g, ''));
    const items = await apify.apifyCall('GET', `/v2/datasets/${encodeURIComponent(info.defaultDatasetId)}/items?clean=true&format=json&limit=${Math.max(cfg.PAGE_SAMPLE_ADS, 1)}`);
    if (!Array.isArray(items.data)) throw apify.collectError('apify_invalid_response');
    const t = readTotal(items.data, ad.mode);
    if (!t) throw apify.collectError('total_not_found');
    const used = Number(runInfo.usageTotalUsd);
    const cost = Number.isFinite(used) && used > 0 ? used : cfg.PAGE_COST_USD;
    return { status: 'succeeded', total: t.total, source: t.source, cost, received: items.data.length };
  } catch (err) {
    return { status: 'failed', error: apify.errText(err), received: 0 };
  }
}

/** Grava o resultado: historico, ultimo valor no anunciante e a lista de dominios da pagina (para recalcular as ofertas). */
async function savePageTotal(pool, pageId, res) {
  await pool.query('INSERT INTO spy.advertiser_checks (page_id, active_total, source, cost_usd) VALUES ($1, $2, $3, $4)', [pageId, res.total, res.source, res.cost]);
  await pool.query('UPDATE spy.advertisers SET active_total = $2, checked_at = NOW() WHERE page_id = $1', [pageId, res.total]);
  const d = await pool.query("SELECT DISTINCT domain FROM spy.ads WHERE page_id = $1 AND is_active AND dest_type = 'offer' AND domain IS NOT NULL", [pageId]);
  return d.rows.map((x) => x.domain);
}

module.exports = { runsToday, pickPage, pickDomain, checkPage, savePageTotal, readTotal };
