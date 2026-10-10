'use strict';
// Worker (processo filho do site): coleta no Apify, enriquecimento de landing, nota de escala e snapshot diario.
// Se cair, o site segue no ar e reinicia o worker com backoff. Batimento em spy.worker_heartbeat a cada 15 s.
const cfg = require('./config');
const { createPool, SP_TODAY_SQL } = require('./db');
const { detectFts } = require('./migrate');
const runner = require('./collect/runner');
const enrich = require('./enrich/queue');
const score = require('./score');
const offerStats = require('./offers/stats');
const checkoutStats = require('./offers/checkouts');
const sitemap = require('./enrich/sitemap');

const BEAT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date().toISOString();
let pool = null;
let fts = false;
let stopping = false;
const stats = { sitemaps: 0, collectRuns: 0, enriched: 0, scored: 0, lastError: null };

// Exclusao mutua: coleta (ingestao), nota e snapshot mexem na mesma tabela; um de cada vez evita impasse entre UPDATEs.
let chain = Promise.resolve();
function exclusive(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function beat() {
  try {
    await pool.query(
      `INSERT INTO spy.worker_heartbeat (name, beat_at, info) VALUES ('worker', NOW(), $1::jsonb)
       ON CONFLICT (name) DO UPDATE SET beat_at = NOW(), info = EXCLUDED.info`,
      [JSON.stringify({ pid: process.pid, startedAt, fts, stats })]);
  } catch (e) { stats.lastError = String(e && e.message).slice(0, 120); }
}

async function waitSchema() {
  for (;;) {
    try {
      const r = await pool.query("SELECT to_regclass('spy.collect_runs') IS NOT NULL AS ok");
      if (r.rows[0].ok) return;
    } catch (e) { /* banco ainda subindo */ }
    if (stopping) return;
    await sleep(2000);
  }
}

async function loop(name, intervalMs, fn) {
  while (!stopping) {
    try { await fn(); } catch (e) { stats.lastError = name + ': ' + String(e && e.message).slice(0, 120); console.error('[worker]', name, 'falhou:', e && e.message); }
    await sleep(intervalMs);
  }
}

/** Fotografia diaria (ativo ou nao) dos anuncios vistos nos ultimos 30 dias ou ativos; 1 vez por dia. */
async function dailySnapshot() {
  const d = await pool.query(`SELECT ${SP_TODAY_SQL}::text AS today, (SELECT info->>'day' FROM spy.worker_heartbeat WHERE name = 'snapshot') AS done`);
  if (d.rows[0].done === d.rows[0].today) return;
  await pool.query(
    `INSERT INTO spy.snapshots (ad_archive_id, day, is_active)
     SELECT ad_archive_id, ${SP_TODAY_SQL}, is_active FROM spy.ads WHERE is_active OR last_seen_at > NOW() - INTERVAL '30 days'
     ON CONFLICT (ad_archive_id, day) DO UPDATE SET is_active = EXCLUDED.is_active`);
  await pool.query(
    `INSERT INTO spy.worker_heartbeat (name, beat_at, info) VALUES ('snapshot', NOW(), $1::jsonb)
     ON CONFLICT (name) DO UPDATE SET beat_at = NOW(), info = EXCLUDED.info`, [JSON.stringify({ day: d.rows[0].today })]);
}

async function main() {
  pool = createPool(4);
  await waitSchema();
  fts = await detectFts(pool);
  const swept = await runner.sweepStale(pool); // run que o worker anterior deixou em andamento
  if (swept) console.log('[worker] runs interrompidos fechados:', swept);
  console.log('[worker] iniciado pid', process.pid, 'fts', fts);
  await beat();
  const timer = setInterval(beat, BEAT_MS);
  timer.unref();

  const step = Math.max(200, Math.min(2000, cfg.COLLECT_INTERVAL_MS));
  loop('coleta', step, async () => {
    const r = await exclusive(() => runner.tick(pool));
    if (r) { stats.collectRuns++; await beat(); }
  });
  loop('sitemap', Math.max(cfg.ENRICH_INTERVAL_MS, 5000), async () => { stats.sitemaps += await sitemap.tick(pool); });
  loop('landing', cfg.ENRICH_INTERVAL_MS, async () => { stats.enriched += await enrich.tick(pool, fts); });
  if (cfg.SCORE_ENABLED) {
    sleep(Math.min(5000, cfg.SCORE_INTERVAL_MS)).then(() => loop('nota', cfg.SCORE_INTERVAL_MS, async () => {
      stats.scored = await exclusive(() => score.recompute(pool));
    }));
  }
  // ofertas materializadas (SPEC-009): primeiro calculo logo apos subir e depois a cada 30 min, apos a nota dos anuncios
  sleep(Math.min(8000, cfg.SCORE_INTERVAL_MS)).then(() => loop('ofertas', cfg.SCORE_INTERVAL_MS, async () => {
    stats.offers = await exclusive(() => offerStats.recompute(pool));
    await checkoutStats.recompute(pool).catch((e) => console.error('[worker] checkouts:', e && e.message));
  }));
  loop('snapshot', 3600000, () => exclusive(dailySnapshot));
}

function shutdown() {
  stopping = true;
  setTimeout(() => process.exit(0), 200).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown); // o site morreu: o worker nao fica orfao
process.on('uncaughtException', (e) => { console.error('[worker] erro nao tratado:', e && e.stack); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[worker] promessa rejeitada:', e && e.stack); process.exit(1); });

main().catch((e) => { console.error('[worker] falha ao iniciar:', e && e.message); process.exit(1); });
