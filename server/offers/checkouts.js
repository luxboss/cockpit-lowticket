'use strict';
// Ranking de checkouts (BE-017, AC-03): spy.checkout_stats materializada a partir das ofertas que levam a cada checkout.
// activeAds = soma dos ativos das ofertas; spark = soma elemento a elemento das curvas das ofertas; growth7d = spark[29] - spark[22];
// advertisersActiveTotal = soma dos totais reais (AC-01) dos anunciantes DISTINTOS com anuncio ativo nessas ofertas.
const { INFO_PLATFORMS } = require('../lib/nonoffer');

/** Recalcula. Sem opts = todos; com {domains} so os checkouts ligados a esses dominios. Retorna linhas gravadas. */
async function recompute(pool, opts) {
  const scoped = !!opts;
  if (scoped && !(opts.domains && opts.domains.length)) return 0;
  const params = scoped ? [opts.domains] : [];
  const sel = scoped ? 'SELECT DISTINCT checkout_url FROM spy.offer_checkouts WHERE domain = ANY($1::text[])' : 'SELECT DISTINCT checkout_url FROM spy.offer_checkouts';
  const r = await pool.query(
    `WITH sel AS (${sel}),
     oc AS (SELECT oc.checkout_url, o.domain, o.score, o.active_ads, o.spark, o.countries
              FROM spy.offer_checkouts oc JOIN sel ON sel.checkout_url = oc.checkout_url JOIN spy.offer_stats o ON o.domain = oc.domain),
     sp AS (SELECT oc.checkout_url, e.i, SUM(e.v::int)::int AS v FROM oc, jsonb_array_elements_text(oc.spark) WITH ORDINALITY e(v, i) GROUP BY oc.checkout_url, e.i),
     spk AS (SELECT checkout_url, ARRAY_AGG(v ORDER BY i) AS arr FROM sp GROUP BY checkout_url),
     agg AS (SELECT checkout_url, SUM(active_ads)::int AS active_ads FROM oc GROUP BY checkout_url),
     ctry AS (SELECT oc.checkout_url, ARRAY_AGG(DISTINCT c) AS countries FROM oc, UNNEST(oc.countries) c GROUP BY oc.checkout_url),
     adv AS (SELECT x.checkout_url, SUM(COALESCE(v.active_total, 0))::int AS total
               FROM (SELECT DISTINCT oc.checkout_url, a.page_id FROM spy.offer_checkouts oc JOIN sel ON sel.checkout_url = oc.checkout_url
                       JOIN spy.ads a ON a.domain = oc.domain AND a.is_active AND a.page_id IS NOT NULL) x
               LEFT JOIN spy.advertisers v ON v.page_id = x.page_id GROUP BY x.checkout_url),
     top AS (SELECT checkout_url, jsonb_agg(jsonb_build_object('domain', domain, 'score', score, 'activeAds', active_ads) ORDER BY rn) AS offers
               FROM (SELECT oc.*, ROW_NUMBER() OVER (PARTITION BY checkout_url ORDER BY score DESC, domain) AS rn FROM oc) t WHERE rn <= 5 GROUP BY checkout_url)
     INSERT INTO spy.checkout_stats (checkout_url, active_ads, advertisers_total, growth_7d, spark, offers, countries, computed_at)
     SELECT a.checkout_url, a.active_ads, COALESCE(v.total, 0), COALESCE(s.arr[30], 0) - COALESCE(s.arr[23], 0), to_jsonb(COALESCE(s.arr, '{}'::int[])), COALESCE(t.offers, '[]'::jsonb),
            COALESCE(y.countries, '{}'), NOW()
       FROM agg a LEFT JOIN spk s ON s.checkout_url = a.checkout_url LEFT JOIN adv v ON v.checkout_url = a.checkout_url LEFT JOIN top t ON t.checkout_url = a.checkout_url
       LEFT JOIN ctry y ON y.checkout_url = a.checkout_url
     ON CONFLICT (checkout_url) DO UPDATE SET active_ads = EXCLUDED.active_ads, advertisers_total = EXCLUDED.advertisers_total, growth_7d = EXCLUDED.growth_7d,
       spark = EXCLUDED.spark, offers = EXCLUDED.offers, countries = EXCLUDED.countries, computed_at = NOW()`, params);
  if (!scoped) await pool.query('DELETE FROM spy.checkout_stats s WHERE NOT EXISTS (SELECT 1 FROM spy.offer_checkouts oc WHERE oc.checkout_url = s.checkout_url)');
  return r.rowCount;
}

const TABS = ['rising', 'falling', 'new'];

/** URLSearchParams -> {p} ou {error}. */
function parseParams(sp) {
  const p = { tab: 'rising', platform: null, country: null, infoOnly: false, page: 1, pageSize: 20 };
  let v = sp.get('tab');
  if (v !== null && v !== '') { if (!TABS.includes(v)) return { error: 'tab' }; p.tab = v; }
  v = sp.get('platform');
  if (v !== null && v !== '') { if (!/^[a-z0-9_-]{1,30}$/i.test(v)) return { error: 'platform' }; p.platform = v.toLowerCase(); }
  v = sp.get('country');
  if (v !== null && v !== '') { if (!/^[A-Za-z]{2}$/.test(v)) return { error: 'country' }; p.country = v.toUpperCase(); }
  v = sp.get('infoOnly');
  if (v !== null && v !== '') { if (v !== '0' && v !== '1') return { error: 'infoOnly' }; p.infoOnly = v === '1'; }
  v = sp.get('page');
  if (v !== null && v !== '') { if (!/^\d{1,5}$/.test(v) || parseInt(v, 10) < 1) return { error: 'page' }; p.page = parseInt(v, 10); }
  v = sp.get('pageSize');
  if (v !== null && v !== '') { if (!/^\d{1,3}$/.test(v) || parseInt(v, 10) < 1 || parseInt(v, 10) > 100) return { error: 'pageSize' }; p.pageSize = parseInt(v, 10); }
  return { p };
}

const ORDER = {
  rising: 's.growth_7d DESC, s.active_ads DESC, s.checkout_url',
  falling: 's.growth_7d ASC, s.active_ads DESC, s.checkout_url',
  new: 's.active_ads DESC, c.first_seen_at DESC, s.checkout_url'
};

async function list(pool, p) {
  const params = [];
  const push = (v) => { params.push(v); return '$' + params.length; };
  const conds = ['s.active_ads > 0'];
  if (p.tab === 'rising') conds.push('s.growth_7d > 0');
  else if (p.tab === 'falling') conds.push('s.growth_7d < 0');
  else conds.push("c.first_seen_at >= NOW() - INTERVAL '7 days'");
  if (p.platform) conds.push(`c.platform = ${push(p.platform)}`);
  if (p.infoOnly) conds.push(`c.platform = ANY(${push(INFO_PLATFORMS)}::text[])`);
  if (p.country) conds.push(`s.countries @> ARRAY[${push(p.country)}]::text[]`);
  const where = conds.join(' AND ');
  const from = 'FROM spy.checkout_stats s JOIN spy.checkouts c ON c.checkout_url = s.checkout_url';
  const limit = push(p.pageSize); const offset = push((p.page - 1) * p.pageSize);
  const cparams = params.slice(0, params.length - 2);
  const [cnt, rows] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n ${from} WHERE ${where}`, cparams),
    pool.query(`SELECT s.checkout_url, c.platform, c.product_id, c.first_seen_at, s.active_ads, s.advertisers_total, s.growth_7d, s.spark, s.offers ${from} WHERE ${where} ORDER BY ${ORDER[p.tab]} LIMIT ${limit} OFFSET ${offset}`, params)
  ]);
  return {
    total: cnt.rows[0].n,
    items: rows.rows.map((r) => ({
      checkoutUrl: r.checkout_url, platform: r.platform, productId: r.product_id, offers: r.offers, activeAds: r.active_ads,
      advertisersActiveTotal: r.advertisers_total, growth7d: r.growth_7d, spark: r.spark, firstSeenAt: r.first_seen_at.toISOString()
    }))
  };
}

module.exports = { recompute, parseParams, list };
