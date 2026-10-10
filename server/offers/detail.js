'use strict';
// Blocos comuns das visoes de oferta e de anunciante: curva, paises, formatos, criativos principais e anunciantes,
// todos calculados sobre o conjunto de anuncios dado por uma condicao SQL (alias a = spy.ads).
const { SD_SQL, ED_SQL, trendSql, periodFrom, histCtes, TODAY } = require('../lib/trend');
const { cardFromRow, CARD_COLS, CARD_JOIN_COLS, CARD_JOINS, DAYS_SQL, ORDER } = require('../search');

/** Curva [{day, activeAds}] dos anuncios (de qualquer status) que casam com a condicao. */
async function trendOf(pool, where, params, period) {
  const r = await pool.query(
    `WITH curve AS (SELECT ${SD_SQL('a')} AS sd, ${ED_SQL('a')} AS ed, COUNT(*) AS c FROM spy.ads a WHERE ${where} AND a.start_date IS NOT NULL GROUP BY 1, 2), ${histCtes('curve')}
     SELECT ${trendSql('curve', periodFrom(period, 'curve'), TODAY)} AS t`, params);
  return r.rows[0].t;
}

const counts = (where, params, pool, expr, extra) => pool.query(
  `SELECT ${expr} AS id, COUNT(*)::int AS count FROM spy.ads a ${extra || ''} WHERE ${where} AND a.is_active GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`, params)
  .then((r) => r.rows.map((x) => ({ id: x.id, count: x.count })));

/** 12 criativos principais: ativos primeiro, por nota. */
async function topAdsOf(pool, where, params) {
  const r = await pool.query(
    `WITH page AS MATERIALIZED (SELECT ${CARD_COLS('a')} FROM spy.ads a WHERE ${where} ORDER BY a.is_active DESC, ${ORDER.score('a')} LIMIT 12)
     SELECT a.*, ${DAYS_SQL('a')} AS days_running, ${CARD_JOIN_COLS} FROM page a ${CARD_JOINS} ORDER BY a.is_active DESC, ${ORDER.score('a')}`, params);
  return r.rows.map(cardFromRow);
}

/**
 * Detalhe do conjunto de anuncios: trend, countries, formats, topAds e (withAdvertisers) os anunciantes com anuncios ativos.
 */
async function entityDetail(pool, where, params, period, withAdvertisers) {
  const [trend, countries, formats, topAds, advertisers] = await Promise.all([
    trendOf(pool, where, params, period),
    pool.query(`SELECT x AS id, COUNT(*)::int AS count FROM spy.ads a, UNNEST(a.countries) x WHERE ${where} AND a.is_active GROUP BY x ORDER BY 2 DESC, 1 LIMIT 15`, params).then((r) => r.rows),
    counts(where, params, pool, 'a.display_format'),
    topAdsOf(pool, where, params),
    withAdvertisers
      ? pool.query(
        `SELECT a.page_id, COALESCE(v.name, '') AS name, v.avatar_url, COUNT(*)::int AS active_ads
           FROM spy.ads a LEFT JOIN spy.advertisers v ON v.page_id = a.page_id
          WHERE ${where} AND a.is_active AND a.page_id IS NOT NULL GROUP BY a.page_id, v.name, v.avatar_url ORDER BY 4 DESC, 1 LIMIT 20`, params)
        .then((r) => r.rows.map((x) => ({ pageId: x.page_id, name: x.name, avatarUrl: x.avatar_url || null, activeAds: x.active_ads })))
      : Promise.resolve([])
  ]);
  return { trend, countries, formats, topAds, advertisers };
}

module.exports = { entityDetail, trendOf, topAdsOf };
