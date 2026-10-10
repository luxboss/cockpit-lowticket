'use strict';
// Coleta imediata: POST /api/v2/collect/now e GET /api/v2/collect/runs/:id
const cfg = require('../config');
const { sendJson, sendError, invalidParam, readBodyObject } = require('../lib/http');
const { cleanTerm, cleanCountry } = require('./keywords');
const apify = require('../collect/apify');
const runner = require('../collect/runner');

const runJson = (r) => ({
  id: Number(r.id), status: r.status, received: r.received, inserted: r.inserted, error: r.error || null,
  kind: r.kind, term: r.term, country: r.country, costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
  startedAt: r.started_at ? r.started_at.toISOString() : null, finishedAt: r.finished_at ? r.finished_at.toISOString() : null
});

async function openRun(pool, term, country) {
  const r = await pool.query("SELECT id FROM spy.collect_runs WHERE kind = 'now' AND status IN ('queued', 'running') AND lower(term) = lower($1) AND country = $2 LIMIT 1", [term, country]);
  return r.rows.length ? Number(r.rows[0].id) : null;
}

async function handleCollectNow(ctx, req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed');
  const body = await readBodyObject(req, res);
  if (!body) return;
  const term = cleanTerm(body.term);
  if (!term) return sendError(res, 400, 'invalid_term');
  const country = cleanCountry(body.country);
  if (!country) return invalidParam(res, 'country');
  if (!apify.configured()) return sendError(res, 503, 'apify_not_configured');
  const pool = ctx.pool;
  const open = await openRun(pool, term, country);
  if (open) return sendError(res, 409, 'run_in_progress', { runId: open });
  if ((await runner.remaining(pool, 'now')) < cfg.COLLECT_MIN_RESERVE) return sendError(res, 429, 'daily_limit');
  try {
    const ins = await pool.query("INSERT INTO spy.collect_runs (kind, term, country, status) VALUES ('now', $1, $2, 'queued') RETURNING id", [term, country]);
    return sendJson(res, 202, { ok: true, runId: Number(ins.rows[0].id) });
  } catch (e) {
    if (e && e.code === '23505') { // dois pedidos iguais ao mesmo tempo: o indice unico segura o segundo
      const id = await openRun(pool, term, country);
      if (id) return sendError(res, 409, 'run_in_progress', { runId: id });
    }
    throw e;
  }
}

async function handleCollectRun(ctx, req, res, idRaw) {
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed');
  if (!/^[0-9]{1,15}$/.test(idRaw)) return sendError(res, 404, 'not_found');
  const r = await ctx.pool.query('SELECT * FROM spy.collect_runs WHERE id = $1', [idRaw]);
  if (!r.rows.length) return sendError(res, 404, 'not_found');
  return sendJson(res, 200, { ok: true, run: runJson(r.rows[0]) });
}

module.exports = { handleCollectNow, handleCollectRun };
