'use strict';
// OfferRow (SPEC-009 secao 6) a partir de spy.offer_stats (alias o) + spy.landings (alias l).

/** Colunas lidas para montar o OfferRow. */
const OFFER_COLS = `o.domain, o.score, o.scaled, o.active_ads, o.total_ads, o.growth_7d, o.spark, o.dup_max, o.days_max, o.thumb_url,
  o.advertisers_count, o.advertisers, o.advertisers_active_total, o.first_seen_at, o.last_seen_at, l.checkout_platform, l.price_min`;

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
    advertisersActiveTotal: r.advertisers_active_total || 0,
    checkouts: [],
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
  // checkouts que a oferta leva (ate 5 por oferta)
  const ck = await pool.query(
    `SELECT oc.domain, oc.checkout_url, c.platform FROM spy.offer_checkouts oc JOIN spy.checkouts c ON c.checkout_url = oc.checkout_url
      WHERE oc.domain = ANY($1::text[]) ORDER BY oc.domain, c.first_seen_at, oc.checkout_url`, [domains]);
  for (const x of ck.rows) { const row = by.get(x.domain); if (row && row.checkouts.length < 5) row.checkouts.push({ checkoutUrl: x.checkout_url, platform: x.platform }); }
  return domains.map((d) => by.get(d)).filter(Boolean);
}

module.exports = { OFFER_COLS, toOfferRow, fetchOfferRows };
