'use strict';
// Palavras monitoradas: GET/POST /api/v2/keywords, PATCH/DELETE /api/v2/keywords/:id
const cfg = require('../config');
const { sendJson, sendError, invalidParam, readBodyObject } = require('../lib/http');
const { CONTROL_RE } = require('../lib/text');
const home = require('./home');

/** Termo limpo (espacos colapsados, sem controle) ou null se fora de 2..80 caracteres. */
function cleanTerm(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 2 && t.length <= 80 ? t : null;
}
/** Pais: 2 letras ou ALL; omitido = BR. Invalido -> null. */
function cleanCountry(v) {
  if (v === undefined) return 'BR';
  if (typeof v !== 'string' || !/^([A-Za-z]{2}|[Aa][Ll][Ll])$/.test(v)) return null;
  return v.toUpperCase();
}

const toJson = (r) => ({
  id: Number(r.id), term: r.term, country: r.country, active: r.active, lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
  lastStatus: r.last_status || null, adsTotal: r.ads_total === undefined ? 0 : Number(r.ads_total), new24h: r.new24h === undefined ? 0 : Number(r.new24h)
});

const LIST_SQL = `
  SELECT k.*, COALESCE(c.total, 0) AS ads_total, COALESCE(c.n24, 0) AS new24h
    FROM spy.keywords k
    LEFT JOIN (SELECT s.source, COUNT(*) AS total, COUNT(*) FILTER (WHERE a.first_seen_at >= NOW() - INTERVAL '24 hours') AS n24
                 FROM spy.ad_sources s JOIN spy.ads a ON a.ad_archive_id = s.ad_archive_id AND a.dest_type <> 'catalog'
                WHERE s.source LIKE 'keyword:%' GROUP BY s.source) c ON c.source = 'keyword:' || k.id
   WHERE ($1::bigint IS NULL OR k.id = $1)
   ORDER BY k.id`;

async function handleKeywords(ctx, req, res, idRaw) {
  if (req.method !== 'GET') home.invalidateKeywords(); // POST, PATCH e DELETE mudam a lista da home
  const pool = ctx.pool;
  if (idRaw === null) {
    if (req.method === 'GET') {
      const r = await pool.query(LIST_SQL, [null]);
      return sendJson(res, 200, { ok: true, keywords: r.rows.map(toJson) });
    }
    if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed');
    const body = await readBodyObject(req, res);
    if (!body) return;
    const term = cleanTerm(body.term);
    if (!term) return sendError(res, 400, 'invalid_term');
    const country = cleanCountry(body.country);
    if (!country) return invalidParam(res, 'country');
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM spy.keywords');
    if (n.rows[0].n >= cfg.KEYWORD_MAX) return sendError(res, 400, 'keyword_limit');
    try {
      const ins = await pool.query('INSERT INTO spy.keywords (term, country) VALUES ($1, $2) RETURNING id', [term, country]);
      const r = await pool.query(LIST_SQL, [ins.rows[0].id]);
      return sendJson(res, 201, { ok: true, keyword: toJson(r.rows[0]) });
    } catch (e) {
      if (e && e.code === '23505') return sendError(res, 409, 'keyword_exists');
      throw e;
    }
  }
  if (!/^[0-9]{1,15}$/.test(idRaw)) return sendError(res, 404, 'not_found');
  const id = idRaw;
  if (req.method === 'PATCH') {
    const body = await readBodyObject(req, res);
    if (!body) return;
    if (typeof body.active !== 'boolean') return invalidParam(res, 'active');
    const u = await pool.query('UPDATE spy.keywords SET active = $2 WHERE id = $1', [id, body.active]);
    if (!u.rowCount) return sendError(res, 404, 'not_found');
    const r = await pool.query(LIST_SQL, [id]);
    return sendJson(res, 200, { ok: true, keyword: toJson(r.rows[0]) });
  }
  if (req.method === 'DELETE') {
    const d = await pool.query('DELETE FROM spy.keywords WHERE id = $1', [id]);
    if (!d.rowCount) return sendError(res, 404, 'not_found');
    return sendJson(res, 200, { ok: true });
  }
  return sendError(res, 405, 'method_not_allowed');
}

module.exports = { handleKeywords, cleanTerm, cleanCountry };
