'use strict';
// Materializacao de spy.offer_stats (SPEC-009 secao 5): uma linha por oferta (dominio com dest_type = offer).
// BE-017 - NOTA DA OFERTA (substitui a da SPEC-009; a nota do ANUNCIO, score.js, nao muda):
//   nota = 100 * ( 0.40*norm(total real de anuncios ativos dos anunciantes da oferta, teto 100) + 0.20*norm(ativos da oferta, teto 50)
//                + 0.15*norm(duplicados max, teto 50) + 0.10*norm(dias no ar max, teto 90) + 0.15*norm(crescimento 7 d, teto 20) )
//   Pesos SPY_SCORE2_W_* e tetos SPY_SCORE2_CAP_*. Total real do anunciante = spy.advertisers.active_total (consulta na Biblioteca, BE-017 AC-01);
//   anunciante ainda nao consultado vale quanto o que ja temos dele no banco (anuncios ativos de oferta). O total da oferta soma os anunciantes
//   que anunciam nela (OfferRow.advertisersActiveTotal); o principal anunciante (maior total) decide a oferta escalada.
//   Escalada = (total real do principal anunciante >= SPY_SCALED_MIN_PAGE_ADS OU ativos da oferta >= SPY_SCALED_MIN_ACTIVE_OFFER) E nota >= SPY_SCALED_SCORE.
// spark = ativos por dia nos ultimos 30 dias (do mais antigo ao de hoje), pela regra de lib/trend.js.
const cfg = require('../config');
const { TODAY, TODAY_ONCE, SD_SQL, ED_SQL } = require('../lib/trend');

/**
 * Recalcula. Sem opts recalcula tudo (worker, a cada 30 min); com {domains} so esses dominios (apos uma coleta).
 * Retorna a quantidade de linhas gravadas.
 */
async function recompute(pool, opts) {
  if (!cfg.OFFER_STATS_ENABLED) return 0;
  const scoped = !!opts;
  if (scoped && !(opts.domains && opts.domains.length)) return 0;
  const w = cfg.SCORE2_W;
  const cap = cfg.SCORE2_CAP;
  const params = [w.pages, w.active, w.dup, w.days, w.growth, cap.pages, cap.active, cap.dup, cap.days, cap.growth, cfg.SCALED_SCORE, cfg.SCALED_MIN_PAGE_ADS, cfg.SCALED_MIN_ACTIVE_OFFER];
  let dom = '';
  if (scoped) { params.push(opts.domains); dom = ' AND a.domain = ANY($14::text[])'; }
  const r = await pool.query(
    `WITH ad AS (
       SELECT a.domain, a.ad_archive_id, a.page_id, a.is_active, a.duplicates, a.score, a.countries, a.start_date, a.first_seen_at, a.last_seen_at, a.media,
              ${SD_SQL('a')} AS sd, ${ED_SQL('a')} AS ed
         FROM spy.ads a WHERE a.dest_type = 'offer' AND a.domain IS NOT NULL${dom}),
     agg AS (
       SELECT domain, COUNT(*) FILTER (WHERE is_active)::int AS active_ads, COUNT(*)::int AS total_ads,
              COALESCE(MAX(duplicates) FILTER (WHERE is_active), 0)::int AS dup_max,
              COALESCE(MAX(${TODAY_ONCE} - sd) FILTER (WHERE is_active AND sd IS NOT NULL), 0)::int AS days_max, -- dias de calendario desde o inicio, como a curva
              COUNT(DISTINCT page_id) FILTER (WHERE is_active)::int AS advertisers_count,
              MIN(COALESCE(start_date, first_seen_at)) AS first_seen, MAX(last_seen_at) AS last_seen
         FROM ad GROUP BY domain),
     ctry AS (SELECT domain, ARRAY_AGG(DISTINCT c) AS countries FROM ad, UNNEST(ad.countries) c WHERE ad.is_active GROUP BY domain),
     topad AS (SELECT DISTINCT ON (domain) domain, ad_archive_id, media FROM ad ORDER BY domain, is_active DESC, score DESC, ad_archive_id),
     padv AS (SELECT domain, page_id, ROW_NUMBER() OVER (PARTITION BY domain ORDER BY COUNT(*) DESC, page_id) AS rn
                FROM ad WHERE is_active AND page_id IS NOT NULL GROUP BY domain, page_id),
     advs AS (SELECT p.domain, jsonb_agg(jsonb_build_object('pageId', p.page_id, 'name', COALESCE(v.name, '')) ORDER BY p.rn) AS advertisers
                FROM padv p LEFT JOIN spy.advertisers v ON v.page_id = p.page_id WHERE p.rn <= 3 GROUP BY p.domain),
     pg AS (SELECT DISTINCT domain, page_id FROM ad WHERE is_active AND page_id IS NOT NULL),
     local AS (SELECT a.page_id, COUNT(*)::int AS n FROM spy.ads a WHERE a.is_active AND a.dest_type = 'offer' AND a.page_id IN (SELECT page_id FROM pg) GROUP BY a.page_id),
     pv AS (SELECT p.domain, COALESCE(v.active_total, l.n, 0) AS val FROM pg p LEFT JOIN spy.advertisers v ON v.page_id = p.page_id LEFT JOIN local l ON l.page_id = p.page_id),
     pt AS (SELECT domain, SUM(val)::int AS total, MAX(val)::int AS mx FROM pv GROUP BY domain),
     days AS (SELECT g::date AS d FROM generate_series(${TODAY} - 29, ${TODAY}, INTERVAL '1 day') g),
     xd AS (SELECT a.domain, days.d FROM agg a CROSS JOIN days),
     s AS (SELECT domain, sd, COUNT(*) AS c FROM ad WHERE sd IS NOT NULL GROUP BY domain, sd),
     e AS (SELECT domain, ed, COUNT(*) AS c FROM ad WHERE sd IS NOT NULL GROUP BY domain, ed),
     sa AS (SELECT x.domain, x.d, SUM(s.c) AS v FROM xd x JOIN s ON s.domain = x.domain AND s.sd <= x.d GROUP BY x.domain, x.d),
     ea AS (SELECT x.domain, x.d, SUM(e.c) AS v FROM xd x JOIN e ON e.domain = x.domain AND e.ed < x.d GROUP BY x.domain, x.d),
     curve AS (SELECT x.domain, ARRAY_AGG((COALESCE(sa.v, 0) - COALESCE(ea.v, 0))::int ORDER BY x.d) AS arr
                 FROM xd x LEFT JOIN sa ON sa.domain = x.domain AND sa.d = x.d LEFT JOIN ea ON ea.domain = x.domain AND ea.d = x.d GROUP BY x.domain),
     calc AS (
       SELECT g.*, c.arr, (c.arr[30] - c.arr[23]) AS growth, COALESCE(t.total, 0) AS pages_total, COALESCE(t.mx, 0) AS pages_main,
              ROUND((100 * (
                  $1::numeric * LEAST(COALESCE(t.total, 0), $6::numeric) / $6::numeric
                + $2::numeric * LEAST(g.active_ads, $7::numeric) / $7::numeric
                + $3::numeric * LEAST(g.dup_max, $8::numeric) / $8::numeric
                + $4::numeric * LEAST(g.days_max, $9::numeric) / $9::numeric
                + $5::numeric * LEAST(GREATEST(c.arr[30] - c.arr[23], 0), $10::numeric) / $10::numeric))::numeric, 1) AS sc
         FROM agg g JOIN curve c ON c.domain = g.domain LEFT JOIN pt t ON t.domain = g.domain)
     INSERT INTO spy.offer_stats (domain, active_ads, total_ads, dup_max, days_max, growth_7d, score, scaled, spark, advertisers_count, advertisers, countries,
                                  top_ad_id, thumb_url, first_seen_at, last_seen_at, advertisers_active_total, main_page_total, computed_at)
     SELECT k.domain, k.active_ads, k.total_ads, k.dup_max, k.days_max, k.growth, k.sc::real, ((k.pages_main >= $12::int OR k.active_ads >= $13::int) AND k.sc >= $11::numeric), to_jsonb(k.arr),
            k.advertisers_count, COALESCE(v.advertisers, '[]'::jsonb), COALESCE(y.countries, '{}'), t.ad_archive_id,
            COALESCE(NULLIF(t.media->'images'->>0, ''), NULLIF(t.media->'videos'->0->>'preview', '')), k.first_seen, k.last_seen, k.pages_total, k.pages_main, NOW()
       FROM calc k LEFT JOIN advs v ON v.domain = k.domain LEFT JOIN ctry y ON y.domain = k.domain LEFT JOIN topad t ON t.domain = k.domain
     ON CONFLICT (domain) DO UPDATE SET active_ads = EXCLUDED.active_ads, total_ads = EXCLUDED.total_ads, dup_max = EXCLUDED.dup_max, days_max = EXCLUDED.days_max,
       growth_7d = EXCLUDED.growth_7d, score = EXCLUDED.score, scaled = EXCLUDED.scaled, spark = EXCLUDED.spark, advertisers_count = EXCLUDED.advertisers_count,
       advertisers = EXCLUDED.advertisers, countries = EXCLUDED.countries, top_ad_id = EXCLUDED.top_ad_id, thumb_url = EXCLUDED.thumb_url,
       first_seen_at = EXCLUDED.first_seen_at, last_seen_at = EXCLUDED.last_seen_at, advertisers_active_total = EXCLUDED.advertisers_active_total,
       main_page_total = EXCLUDED.main_page_total, computed_at = NOW()`, params);
  if (!scoped) { // ofertas que deixaram de existir (anuncios apagados ou reclassificados) saem da tabela
    await pool.query(`DELETE FROM spy.offer_stats o WHERE NOT EXISTS (SELECT 1 FROM spy.ads a WHERE a.domain = o.domain AND a.dest_type = 'offer')`);
  }
  return r.rowCount;
}

module.exports = { recompute };
