'use strict';
// Minerador v2 (SPEC-008): API /api/v2/*, estaticos de web/dist e worker em processo filho.
const http = require('http');
const path = require('path');
const { fork } = require('child_process');
const cfg = require('./config');
const { createPool } = require('./db');
const { migrate } = require('./migrate');
const { importFromV1 } = require('./import-v1');
const { checkAuth } = require('./auth');
const { sendJson, sendError } = require('./lib/http');
const { serveStatic } = require('./static');
const { handleSearch, handleFilters } = require('./routes/search');
const { handleAd } = require('./routes/ads');
const { handleMedia } = require('./routes/media');
const { handleKeywords } = require('./routes/keywords');
const { handleCollectNow, handleCollectRun } = require('./routes/collect');
const { handleStatus } = require('./routes/status');
const { handleHome } = require('./routes/home');
const { handleKeywordOverview } = require('./routes/overview');
const { handleOffers, handleOffersCsv, handleOfferDetail } = require('./routes/offers');
const { handleAdvertiser, handleCompare } = require('./routes/advertisers');

const ctx = { pool: null, state: { ready: false, fts: false, warnings: [], importError: null } };
let httpServer = null;
let worker = null;
let shuttingDown = false;
let beatTimer = null;

// ---- roteamento da API (todas exigem Bearer APP_TOKEN)
async function route(req, res, url) {
  const parts = url.pathname.replace(/^\/api\/v2\/?/, '').split('/').filter(Boolean);
  const [a, b, c, d] = parts;
  const only = (method, fn) => (req.method === method ? fn() : sendError(res, 405, 'method_not_allowed'));
  if (a === 'search' && parts.length === 1) return only('GET', () => handleSearch(ctx, req, res, url.searchParams));
  if (a === 'filters' && parts.length === 1) return only('GET', () => handleFilters(ctx, req, res));
  if (a === 'ads' && parts.length === 2) return only('GET', () => handleAd(ctx, req, res, b));
  if (a === 'media' && parts.length === 4) return only('GET', () => handleMedia(ctx, req, res, b, c, d));
  if (a === 'keywords' && parts.length === 1) return handleKeywords(ctx, req, res, null);
  if (a === 'keywords' && parts.length === 2) return handleKeywords(ctx, req, res, b);
  if (a === 'collect' && b === 'now' && parts.length === 2) return handleCollectNow(ctx, req, res);
  if (a === 'collect' && b === 'runs' && parts.length === 3) return handleCollectRun(ctx, req, res, c);
  if (a === 'home' && parts.length === 1) return only('GET', () => handleHome(ctx, req, res, url.searchParams));
  if (a === 'keyword-overview' && parts.length === 1) return only('GET', () => handleKeywordOverview(ctx, req, res, url.searchParams));
  if (a === 'offers.csv' && parts.length === 1) return only('GET', () => handleOffersCsv(ctx, req, res, url.searchParams));
  if (a === 'offers' && parts.length === 1) return only('GET', () => handleOffers(ctx, req, res, url.searchParams));
  if (a === 'offers' && parts.length === 2) return only('GET', () => handleOfferDetail(ctx, req, res, b, url.searchParams));
  if (a === 'advertisers' && parts.length === 2) return only('GET', () => handleAdvertiser(ctx, req, res, b, url.searchParams));
  if (a === 'compare' && parts.length === 1) return only('GET', () => handleCompare(ctx, req, res, url.searchParams));
  if (a === 'status' && parts.length === 1) return handleStatus(ctx, req, res);
  return sendError(res, 404, 'not_found');
}

async function handle(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return sendError(res, 400, 'bad_request'); }
  const pathname = url.pathname;
  if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
  if (pathname === '/api/v2' || pathname.startsWith('/api/v2/')) {
    const auth = checkAuth(req);
    if (auth === 'no_token') return sendError(res, 503, 'app_token_required');
    if (auth !== 'ok') return sendError(res, 401, 'unauthorized');
    if (!ctx.state.ready) return sendError(res, 503, 'db_unavailable');
    try {
      return await route(req, res, url);
    } catch (err) {
      console.error('[api]', req.method, pathname, 'erro:', err && err.message);
      if (!res.headersSent) return sendError(res, 500, 'internal_error');
      return res.destroy();
    }
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) return sendError(res, 404, 'not_found');
  return serveStatic(req, res, pathname);
}

// ---- worker em processo filho, reiniciado com backoff
const BACKOFF_MS = [1000, 5000, 30000, 120000];
let restarts = 0;
function startWorker() {
  if (!cfg.WORKER_ENABLED || shuttingDown) return;
  const startedAt = Date.now();
  worker = fork(path.join(__dirname, 'worker.js'), [], { env: process.env, stdio: 'inherit' });
  console.log('[site] worker iniciado pid', worker.pid);
  worker.on('exit', (code, signal) => {
    worker = null;
    if (shuttingDown) return;
    if (Date.now() - startedAt > 120000) restarts = 0; // rodou estavel: zera o backoff
    const wait = BACKOFF_MS[Math.min(restarts, BACKOFF_MS.length - 1)];
    restarts++;
    console.error(`[site] worker caiu (codigo ${code}, sinal ${signal}); reiniciando em ${wait} ms`);
    setTimeout(startWorker, wait);
  });
}

// ---- subida: migra o schema (com tentativas), importa a v1 e so entao libera a API e o worker
async function boot() {
  for (let attempt = 1; !shuttingDown; attempt++) {
    try {
      if (!ctx.pool) ctx.pool = createPool(8);
      const m = await migrate(ctx.pool);
      ctx.state.fts = m.fts;
      ctx.state.warnings = m.warnings;
      if (m.warnings.length) console.warn('[db] avisos:', m.warnings.join(' | '));
      try {
        const imp = await importFromV1(ctx.pool);
        if (imp.done) console.log('[db] importacao da v1:', JSON.stringify(imp));
      } catch (e) {
        ctx.state.importError = e && e.message;
        console.error('[db] importacao da v1 falhou (o site segue; tenta de novo na proxima subida):', e && e.message);
      }
      ctx.state.ready = true;
      console.log('[db] schema spy pronto; busca por texto completo:', m.fts);
      beat();
      beatTimer = setInterval(beat, 15000);
      beatTimer.unref();
      startWorker();
      return;
    } catch (e) {
      console.error(`[db] tentativa ${attempt} falhou: ${e && e.message}`);
      await new Promise((r) => setTimeout(r, Math.min(3000 * attempt, 15000)));
    }
  }
}

async function beat() {
  try {
    await ctx.pool.query(
      `INSERT INTO spy.worker_heartbeat (name, beat_at, info) VALUES ('api', NOW(), $1::jsonb)
       ON CONFLICT (name) DO UPDATE SET beat_at = NOW(), info = EXCLUDED.info`, [JSON.stringify({ pid: process.pid })]);
  } catch (e) { /* o banco pode estar fora; o proximo batimento tenta de novo */ }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (worker) { try { worker.kill('SIGTERM'); } catch (e) { /* ja saiu */ } }
  if (httpServer) httpServer.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('[site] promessa rejeitada:', e && e.message));

httpServer = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[site] erro:', e && e.message);
    if (!res.headersSent) sendError(res, 500, 'internal_error'); else res.destroy();
  });
});
httpServer.listen(cfg.PORT, '0.0.0.0', () => {
  console.log('[site] HTTP na porta ' + cfg.PORT + (cfg.APP_TOKEN ? '' : ' (APP_TOKEN ausente: /api/v2 devolve 503)'));
  if (!cfg.DATABASE_URL) console.error('[db] DATABASE_URL nao configurada: a API fica indisponivel');
  else boot();
});
