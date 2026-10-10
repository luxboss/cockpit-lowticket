'use strict';
// Nota de escala (SPEC-008 secao 5), de 0 a 100, materializada em spy.ads.score:
//   score = 100 * ( Wd*norm(dias ativo, cap 90) + Wu*norm(duplicates, cap 50) + Wa*norm(anuncios ativos do dominio, cap 30) + Wg*norm(crescimento 7 d, cap 10) )
// norm(x, cap) = min(x, cap) / cap. Pesos e tetos vem de SPY_SCORE_W_* e SPY_SCORE_CAP_* (config.js).
// Crescimento 7 d do dominio = anuncios ativos do dominio cuja data de inicio e dos ultimos 7 dias.
const cfg = require('./config');

/**
 * Recalcula a nota. Sem opts recalcula tudo (worker, a cada 30 min); com {domains, ids} so os anuncios desses dominios e ids (apos uma coleta).
 * So grava onde a nota mudou. Retorna a quantidade de linhas atualizadas.
 */
async function recompute(pool, opts) {
  const scoped = !!(opts && ((opts.domains && opts.domains.length) || (opts.ids && opts.ids.length)));
  if (opts && !scoped) return 0;
  const w = cfg.SCORE_W;
  const cap = cfg.SCORE_CAP;
  const params = [w.days, w.dup, w.domain, w.growth, cap.days, cap.dup, cap.domain, cap.growth];
  let domFilter = '';
  let adFilter = '';
  if (scoped) {
    params.push(opts.domains || [], opts.ids || []);
    domFilter = ' AND domain = ANY($9::text[])';
    adFilter = ' AND (a.domain = ANY($9::text[]) OR a.ad_archive_id = ANY($10::text[]))';
  }
  const r = await pool.query(
    `WITH dom AS (
       SELECT domain,
              COUNT(*) FILTER (WHERE is_active) AS n_active,
              COUNT(*) FILTER (WHERE is_active AND start_date >= NOW() - INTERVAL '7 days') AS n_new
         FROM spy.ads WHERE domain IS NOT NULL${domFilter} GROUP BY domain),
     calc AS (
       SELECT a.ad_archive_id,
              ROUND((100 * (
                $1::numeric * LEAST(GREATEST(CASE WHEN a.start_date IS NULL THEN 0
                    ELSE EXTRACT(EPOCH FROM (CASE WHEN a.is_active THEN NOW() ELSE COALESCE(a.end_date, a.last_seen_at) END - a.start_date)) / 86400 END, 0), $5::numeric) / $5::numeric
              + $2::numeric * LEAST(GREATEST(a.duplicates, 0), $6::numeric) / $6::numeric
              + $3::numeric * LEAST(COALESCE(d.n_active, 0), $7::numeric) / $7::numeric
              + $4::numeric * LEAST(COALESCE(d.n_new, 0), $8::numeric) / $8::numeric))::numeric, 1)::real AS s
         FROM spy.ads a LEFT JOIN dom d ON d.domain = a.domain
        WHERE TRUE${adFilter})
     UPDATE spy.ads a SET score = c.s FROM calc c WHERE a.ad_archive_id = c.ad_archive_id AND a.score IS DISTINCT FROM c.s`, params);
  return r.rowCount;
}

module.exports = { recompute };
