'use strict';
// Coleta: cotas diarias separadas (palavras x buscar agora), execucao de um run no Apify e agendamento das palavras.
// Uma coleta por vez (o worker chama tick() em serie). Sem token do Apify nada roda.
const cfg = require('../config');
const { SP_TODAY_SQL } = require('../db');
const apify = require('./apify');
const { ingestAds } = require('./ingest');
const score = require('../score');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limitOf = (kind) => (kind === 'now' ? cfg.NOW_DAILY_LIMIT : cfg.COLLECT_DAILY_LIMIT);
const usageKind = (kind) => (kind === 'now' ? 'now' : 'keyword');

/** Anuncios ja usados hoje na cota do tipo. */
async function usedToday(pool, kind) {
  const r = await pool.query(`SELECT ads FROM spy.usage_daily WHERE day = ${SP_TODAY_SQL} AND kind = $1`, [usageKind(kind)]);
  return r.rows.length ? r.rows[0].ads : 0;
}
async function remaining(pool, kind) { return Math.max(0, limitOf(kind) - (await usedToday(pool, kind))); }

/** Reserva atomica de ate max anuncios (linha do dia travada com FOR UPDATE). {reserved, day}; reserved = 0 sem saldo minimo. */
async function reserve(pool, kind, max) {
  const limit = limitOf(kind);
  if (limit <= 0) return { reserved: 0, day: null };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO spy.usage_daily (day, kind, ads) VALUES (${SP_TODAY_SQL}, $1, 0) ON CONFLICT (day, kind) DO NOTHING`, [usageKind(kind)]);
    const cur = await client.query(`SELECT day::text AS day, ads FROM spy.usage_daily WHERE day = ${SP_TODAY_SQL} AND kind = $1 FOR UPDATE`, [usageKind(kind)]);
    const left = limit - cur.rows[0].ads;
    const reserved = left >= Math.min(cfg.COLLECT_MIN_RESERVE, max) ? Math.min(max, left) : 0;
    if (reserved > 0) await client.query('UPDATE spy.usage_daily SET ads = ads + $3 WHERE day = $1::date AND kind = $2', [cur.rows[0].day, usageKind(kind), reserved]);
    await client.query('COMMIT');
    return { reserved, day: cur.rows[0].day };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
async function refund(pool, kind, day, amount) {
  if (!day || !(amount > 0)) return;
  await pool.query('UPDATE spy.usage_daily SET ads = GREATEST(ads - $3, 0) WHERE day = $1::date AND kind = $2', [day, usageKind(kind), amount]);
}

async function finish(pool, run, status, c, error, cost) {
  await pool.query(
    `UPDATE spy.collect_runs SET status = $2, received = $3, inserted = $4, cost_usd = $5, finished_at = NOW(), error = $6 WHERE id = $1`,
    [run.id, status, c.received, c.inserted, cost, error]);
  await refund(pool, run.kind, run.reserved_day, run.reserved - c.received);
  if (run.keyword_id) {
    await pool.query('UPDATE spy.keywords SET last_run_at = NOW(), last_status = $2 WHERE id = $1', [run.keyword_id, status]);
  }
}

/** Executa o run no Apify: POST runs -> polling -> dataset paginado -> ingestao em lotes. Nunca lanca. */
async function executeRun(pool, run) {
  const counters = { received: 0, inserted: 0 };
  const touched = { domains: new Set(), ids: [] };
  let apifyRunId = null;
  let terminal = false;
  const source = (run.kind === 'now' ? 'now:' : 'keyword:') + (run.kind === 'now' ? run.id : run.keyword_id);
  try {
    const ad = apify.adapter();
    if (!apify.configured() || !ad) throw apify.collectError('apify_not_configured');
    const { reserved, day } = await reserve(pool, run.kind, run.kind === 'now' ? cfg.NOW_RUN_ADS : cfg.COLLECT_RUN_ADS);
    if (reserved <= 0) throw apify.collectError('daily_limit');
    run.reserved = reserved; run.reserved_day = day;
    await pool.query('UPDATE spy.collect_runs SET reserved = $2, reserved_day = $3::date WHERE id = $1', [run.id, reserved, day]);

    const started = await apify.apifyCall('POST', `/v2/acts/${encodeURIComponent(cfg.APIFY_ACTOR)}/runs`, ad.buildInput(run.term, run.country, reserved));
    const info = started.data && started.data.data;
    const okId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
    if (!info || !okId(info.id) || !okId(info.defaultDatasetId)) throw apify.collectError('apify_invalid_response');
    apifyRunId = info.id;
    await pool.query('UPDATE spy.collect_runs SET apify_run_id = $2 WHERE id = $1', [run.id, apifyRunId]);

    const deadline = Date.now() + cfg.COLLECT_RUN_TIMEOUT_MS;
    let runInfo = info;
    while (!apify.TERMINAL.has(runInfo.status)) {
      if (Date.now() >= deadline) throw apify.collectError('collect_timeout');
      await sleep(Math.max(1, Math.min(cfg.COLLECT_POLL_MS, deadline - Date.now())));
      const polled = await apify.apifyCall('GET', `/v2/actor-runs/${encodeURIComponent(apifyRunId)}`);
      runInfo = polled.data && polled.data.data;
      if (!runInfo || typeof runInfo.status !== 'string') throw apify.collectError('apify_invalid_response');
    }
    terminal = true;
    if (runInfo.status !== 'SUCCEEDED') throw apify.collectError('apify_run_' + runInfo.status.toLowerCase().replace(/[^a-z-]/g, ''));
    const cost = runInfo.usageTotalUsd !== null && runInfo.usageTotalUsd !== undefined && Number.isFinite(Number(runInfo.usageTotalUsd)) ? Number(runInfo.usageTotalUsd) : null;

    let offset = 0;
    while (counters.received < reserved) {
      const limit = Math.min(cfg.COLLECT_PAGE, reserved - counters.received);
      const page = await apify.apifyCall('GET', `/v2/datasets/${encodeURIComponent(info.defaultDatasetId)}/items?clean=true&format=json&offset=${offset}&limit=${limit}`);
      if (!Array.isArray(page.data)) throw apify.collectError('apify_invalid_response');
      const items = page.data.slice(0, reserved - counters.received);
      if (!items.length) break;
      counters.received += items.length; offset += items.length;
      const mapped = items.map((it) => { try { return apify.mapApifyAdItem(it); } catch (e) { return null; } });
      const r = await ingestAds(pool, mapped, source, run.country);
      counters.inserted += r.inserted;
      for (const d of r.domains) touched.domains.add(d);
      touched.ids.push(...r.ids);
      const total = Number(page.headers.get('x-apify-pagination-total'));
      if (page.headers.get('x-apify-pagination-total') !== null && Number.isFinite(total) && offset >= total) break;
    }
    await finish(pool, run, 'succeeded', counters, null, cost);
    await score.recompute(pool, { domains: Array.from(touched.domains), ids: touched.ids }).catch((e) => console.error('[coleta] nota:', e && e.message));
    return { status: 'succeeded', counters };
  } catch (err) {
    if (apifyRunId && !terminal) { try { await apify.apifyCall('POST', `/v2/actor-runs/${encodeURIComponent(apifyRunId)}/abort`, {}); } catch (e) { /* melhor esforco */ } }
    const text = apify.errText(err);
    console.error('[coleta] run', run.id, 'falhou:', text);
    try { await finish(pool, run, 'failed', counters, text, null); } catch (e) { /* banco fora: a limpeza do worker fecha o run depois */ }
    return { status: 'failed', counters, error: text };
  }
}

/** Marca como falhos os runs presos em running (worker caiu no meio). Sem idade = todos (usado na subida do worker). */
async function sweepStale(pool, olderThanMinutes) {
  const r = await pool.query(
    `UPDATE spy.collect_runs SET status = 'failed', error = $2, finished_at = NOW()
      WHERE status = 'running' AND ($1::int IS NULL OR started_at < NOW() - ($1::int * INTERVAL '1 minute')) RETURNING id, keyword_id`,
    [olderThanMinutes === undefined ? null : olderThanMinutes, olderThanMinutes === undefined ? 'worker_restart' : 'collect_interrupted']);
  for (const x of r.rows) if (x.keyword_id) await pool.query("UPDATE spy.keywords SET last_status = 'failed', last_run_at = NOW() WHERE id = $1", [x.keyword_id]);
  return r.rowCount;
}

const CLAIM_NOW_SQL = `
  UPDATE spy.collect_runs SET status = 'running', started_at = NOW()
   WHERE id = (SELECT id FROM spy.collect_runs WHERE status = 'queued' AND kind = 'now' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING *`;

const DUE_KEYWORD_SQL = `
  SELECT * FROM spy.keywords k
   WHERE k.active AND (k.last_run_at IS NULL OR k.last_run_at < NOW() - (CASE WHEN k.last_status = 'succeeded' THEN $1::int ELSE $2::int END) * INTERVAL '1 hour')
   ORDER BY k.last_run_at ASC NULLS FIRST, k.id ASC LIMIT 1`;

let lastKeywordAt = 0;
/** Um passo do agendador. Primeiro a fila de Buscar agora; senao 1 palavra vencida, no maximo 1 por COLLECT_INTERVAL_MS. Nunca lanca. */
async function tick(pool) {
  try {
    if (!apify.configured()) return null;
    await sweepStale(pool, Math.ceil(cfg.COLLECT_RUN_TIMEOUT_MS / 60000) + 10);
    const q = await pool.query(CLAIM_NOW_SQL);
    if (q.rows.length) return await executeRun(pool, q.rows[0]);
    if (Date.now() - lastKeywordAt < cfg.COLLECT_INTERVAL_MS) return null;
    if ((await remaining(pool, 'keyword')) < cfg.COLLECT_MIN_RESERVE) return null; // cota do dia esgotada
    const k = await pool.query(DUE_KEYWORD_SQL, [cfg.KEYWORD_EVERY_HOURS, cfg.KEYWORD_RETRY_HOURS]);
    if (!k.rows.length) return null;
    lastKeywordAt = Date.now();
    const kw = k.rows[0];
    await pool.query("UPDATE spy.keywords SET last_run_at = NOW(), last_status = 'running' WHERE id = $1", [kw.id]);
    const ins = await pool.query(
      `INSERT INTO spy.collect_runs (kind, keyword_id, term, country, status) VALUES ('keyword', $1, $2, $3, 'running') RETURNING *`,
      [kw.id, kw.term, kw.country]);
    return await executeRun(pool, ins.rows[0]);
  } catch (err) {
    console.error('[coleta] ciclo falhou:', apify.scrub(err && err.message));
    return null;
  }
}

module.exports = { tick, executeRun, sweepStale, usedToday, remaining };
