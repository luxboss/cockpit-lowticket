'use strict';
// OfferRow (SPEC-009 secao 6) a partir de spy.offer_stats (alias o) + spy.landings (alias l).

/** Colunas lidas para montar o OfferRow. */
const OFFER_COLS = `o.domain, o.score, o.scaled, o.active_ads, o.total_ads, o.growth_7d, o.spark, o.dup_max, o.days_max, o.thumb_url,
  o.advertisers_count, o.advertisers, o.first_seen_at, o.last_seen_at, l.checkout_platform, l.price_min`;

function toOfferRow(r) {
  return {
    domain: r.domain,
    score: Number(r.score),
    scaled: !!r.scaled,
    activeAds: r.active_ads,
    totalAds: r.total_ads,
    growth7d: r.growth_7d,
    spark: Array.isArray(r.spark) ? r.spark : [],
    dupMax: r.dup_max,
    daysMax: r.days_max,
    checkout: r.checkout_platform ? { platform: r.checkout_platform, priceMin: r.price_min === null || r.price_min === undefined ? null : Number(r.price_min) } : null,
    thumbUrl: r.thumb_url || null,
    advertisersCount: r.advertisers_count,
    advertisers: Array.isArray(r.advertisers) ? r.advertisers.slice(0, 3) : [],
    firstSeenAt: r.first_seen_at ? r.first_seen_at.toISOString() : null,
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null
  };
}

/** Busca OfferRows por dominio, na ordem pedida; dominios desconhecidos ficam de fora. */
async function fetchOfferRows(pool, domains) {
  if (!domains.length) return [];
  const r = await pool.query(
    `SELECT ${OFFER_COLS} FROM spy.offer_stats o LEFT JOIN spy.landings l ON l.domain = o.domain WHERE o.domain = ANY($1::text[])`, [domains]);
  const by = new Map(r.rows.map((x) => [x.domain, toOfferRow(x)]));
  return domains.map((d) => by.get(d)).filter(Boolean);
}

module.exports = { OFFER_COLS, toOfferRow, fetchOfferRows };
