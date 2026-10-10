'use strict';
// GET /api/v2/keyword-overview?q=&period=&country=&infoOnly= (Visao da Palavra, SPEC-009)
const { sendJson, invalidParam } = require('../lib/http');
const { parseContext, adContextConds } = require('../lib/params');
const { textCondition } = require('../search');
const { SD_SQL, ED_SQL, trendSql, periodFrom, histCtes, TODAY, TODAY_ONCE } = require('../lib/trend');
const { fetchOfferRows } = require('../offers/rows');

async function handleKeywordOverview(ctx, req, res, sp) {
  const q = (sp.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 2 || q.length > 80) return invalidParam(res, 'q');
  const parsed = parseContext(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const c = parsed.c;
  const pool = ctx.pool;
  const empty = { activeAds: 0, offers: 0, scaledOffers: 0, advertisers: 0, avgDaysRunning: 0 };

  const params = [];
  const push = (v) => { params.push(v); return '$' + params.length; };
  const text = await textCondition(pool, { q, field: 'all' }, ctx.state.fts, push);
  let o = null;
  if (text !== false) {
    const conds = ["a.dest_type = 'offer'", 'a.domain IS NOT NULL', text].concat(adContextConds(c, push));
    // m: todos os anuncios que casam (a curva conta tambem os encerrados); act: so os ativos agora
    const r = await pool.query(
      `WITH m AS MATERIALIZED (
         SELECT a.domain, a.page_id, a.is_active, a.start_date, a.end_date, a.last_seen_at, a.display_format, a.countries
           FROM spy.ads a WHERE ${conds.join(' AND ')}),
       act AS MATERIALIZED (SELECT * FROM m WHERE is_active),
       dm AS MATERIALIZED (SELECT domain, COUNT(*)::int AS c FROM act GROUP BY domain),
       curve AS MATERIALIZED (SELECT ${SD_SQL('m')} AS sd, ${ED_SQL('m')} AS ed, COUNT(*) AS c FROM m WHERE start_date IS NOT NULL GROUP BY 1, 2),
       ${histCtes('curve')}
       SELECT jsonb_build_object(
         'activeAds', (SELECT COUNT(*) FROM act),
         'offers', (SELECT COUNT(*) FROM dm),
         'scaledOffers', (SELECT COUNT(*) FROM spy.offer_stats o JOIN dm ON dm.domain = o.domain WHERE o.scaled),
         'advertisers', (SELECT COUNT(*) FROM (SELECT DISTINCT page_id FROM act WHERE page_id IS NOT NULL) x),
         'avgDays', (SELECT COALESCE(AVG(${TODAY_ONCE} - ${SD_SQL('act')}), 0) FROM act WHERE start_date IS NOT NULL),
         'trend', ${trendSql('curve', periodFrom(c.period, 'curve'), TODAY)},
         'countries', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'count', t.n) ORDER BY t.n DESC, t.id), '[]'::jsonb)
                         FROM (SELECT x AS id, SUM(g.n)::int AS n FROM (SELECT countries, COUNT(*) AS n FROM act GROUP BY countries) g, UNNEST(g.countries) x GROUP BY x ORDER BY 2 DESC, 1 LIMIT 15) t),
         'formats', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'count', t.n) ORDER BY t.n DESC, t.id), '[]'::jsonb)
                       FROM (SELECT display_format AS id, COUNT(*)::int AS n FROM act GROUP BY display_format) t),
         'checkouts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'count', t.n) ORDER BY t.n DESC, t.id), '[]'::jsonb)
                         FROM (SELECT l.checkout_platform AS id, SUM(dm.c)::int AS n FROM dm JOIN spy.landings l ON l.domain = dm.domain
                                WHERE l.checkout_platform IS NOT NULL GROUP BY l.checkout_platform) t),
         'top', (SELECT COALESCE(jsonb_agg(t.domain ORDER BY t.rn), '[]'::jsonb) FROM (
                   SELECT s.domain, ROW_NUMBER() OVER (ORDER BY s.score DESC, s.domain) AS rn
                     FROM spy.offer_stats s JOIN dm ON dm.domain = s.domain ORDER BY s.score DESC, s.domain LIMIT 10) t)
       ) AS o`, params);
    o = r.rows[0].o;
  }
  let zeros = [];
  if (!o) { // nada casa: curva zerada no periodo, para o grafico nao ficar sem eixo
    const z = await pool.query(`WITH curve AS (SELECT NULL::date AS sd, NULL::date AS ed, 0::bigint AS c WHERE false), ${histCtes('curve')} SELECT ${trendSql('curve', periodFrom(c.period, 'curve'), TODAY)} AS t`);
    zeros = z.rows[0].t;
  }
  const fts = ctx.state.fts;
  const mon = await pool.query(
    `SELECT id FROM spy.keywords WHERE ${fts ? 'lower(spy.f_unaccent(term)) = lower(spy.f_unaccent($1))' : 'lower(term) = lower($1)'} AND ($2::text IS NULL OR country = $2) ORDER BY id LIMIT 1`, [q, c.country]);
  const topOffers = o ? await fetchOfferRows(pool, o.top) : [];
  return sendJson(res, 200, {
    ok: true,
    q,
    kpis: o ? { activeAds: o.activeAds, offers: o.offers, scaledOffers: o.scaledOffers, advertisers: o.advertisers, avgDaysRunning: Math.round(Number(o.avgDays) * 10) / 10 } : empty,
    trend: o ? o.trend : zeros,
    countries: o ? o.countries : [],
    formats: o ? o.formats : [],
    checkouts: o ? o.checkouts : [],
    topOffers,
    monitored: mon.rows.length ? { id: Number(mon.rows[0].id) } : null
  });
}

module.exports = { handleKeywordOverview };
