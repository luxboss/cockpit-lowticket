'use strict';
// Parametros comuns das rotas da SPEC-009: country, infoOnly e period.
const { INFO_PLATFORMS } = require('./nonoffer');

const PERIODS = ['7d', '30d', '90d', 'all'];

/** URLSearchParams -> {c:{country, infoOnly, period}} ou {error: nome do parametro}. */
function parseContext(sp) {
  const c = { country: null, infoOnly: false, period: '30d' };
  let v = sp.get('country');
  if (v !== null && v !== '') { if (!/^[A-Za-z]{2}$/.test(v)) return { error: 'country' }; c.country = v.toUpperCase(); }
  v = sp.get('infoOnly');
  if (v !== null && v !== '') { if (v !== '0' && v !== '1') return { error: 'infoOnly' }; c.infoOnly = v === '1'; }
  v = sp.get('period');
  if (v !== null && v !== '') { if (!PERIODS.includes(v)) return { error: 'period' }; c.period = v; }
  return { c };
}

/** Condicoes de pais e infoOnly sobre spy.ads (alias a). push(v) devolve o placeholder. */
function adContextConds(c, push) {
  const conds = [];
  if (c.country) conds.push(`a.countries @> ARRAY[${push(c.country)}]::text[]`);
  if (c.infoOnly) conds.push(`a.domain IN (SELECT l.domain FROM spy.landings l WHERE l.checkout_platform = ANY(${push(INFO_PLATFORMS)}::text[]))`);
  return conds;
}

/** O mesmo sobre spy.offer_stats (alias o). */
function offerContextConds(c, push) {
  const conds = [];
  if (c.country) conds.push(`o.countries @> ARRAY[${push(c.country)}]::text[]`);
  if (c.infoOnly) conds.push(`o.domain IN (SELECT l.domain FROM spy.landings l WHERE l.checkout_platform = ANY(${push(INFO_PLATFORMS)}::text[]))`);
  return conds;
}

module.exports = { parseContext, adContextConds, offerContextConds, PERIODS };
