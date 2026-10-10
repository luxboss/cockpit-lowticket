'use strict';
// Enriquecimento de landing por dominio: fila priorizada pelos dominios de maior nota, sem repetir antes de ENRICH_OK_DAYS.
// Falha ou landing importada sem texto esperam ENRICH_RETRY_HOURS. Sempre grava uma linha em spy.landings (sai da fila).
const cfg = require('../config');
const { analyzeLanding } = require('./landing');

const inFlight = new Set();
const changed = new Set(); // dominios com checkout atualizado desde o ultimo recalculo do ranking

/** Dominios de oferta com anuncio ativo, ainda sem landing ou vencidos, do maior score para o menor. */
async function nextDomains(pool, limit) {
  const r = await pool.query(
    `SELECT d.domain, d.link_url
       FROM (SELECT DISTINCT ON (a.domain) a.domain, a.link_url, a.score
               FROM spy.ads a WHERE a.is_active AND a.dest_type = 'offer' AND a.domain IS NOT NULL AND a.link_url <> ''
              ORDER BY a.domain, a.score DESC) d
       LEFT JOIN spy.landings l ON l.domain = d.domain
      WHERE l.domain IS NULL
         OR l.fetched_at IS NULL
         OR (l.checkouts_at IS NULL AND l.error IS NULL AND l.text IS NOT NULL AND l.fetched_at < NOW() - INTERVAL '1 hour')
         OR l.fetched_at < NOW() - (CASE WHEN l.error IS NULL AND l.text IS NOT NULL THEN $2::int * 24 ELSE $3::int END) * INTERVAL '1 hour'
      ORDER BY d.score DESC, d.domain
      LIMIT $1`, [limit + inFlight.size, cfg.ENRICH_OK_DAYS, cfg.ENRICH_RETRY_HOURS]);
  return r.rows.filter((x) => !inFlight.has(x.domain)).slice(0, limit);
}

async function saveOk(pool, domain, a, fts) {
  const tsv = fts ? "to_tsvector('spy.pt', coalesce($3, '') || ' ' || coalesce($4, ''))" : 'NULL';
  await pool.query(
    `INSERT INTO spy.landings (domain, final_url, title, text, text_tsv, checkout_platform, price_min, fetched_at, error)
     VALUES ($1, $2, $3, $4, ${tsv}, $5, $6, NOW(), NULL)
     ON CONFLICT (domain) DO UPDATE SET final_url = EXCLUDED.final_url, title = EXCLUDED.title, text = EXCLUDED.text, text_tsv = EXCLUDED.text_tsv,
       checkout_platform = EXCLUDED.checkout_platform, price_min = EXCLUDED.price_min, fetched_at = NOW(), error = NULL`,
    [domain, a.finalUrl, a.title || null, a.text, a.checkoutPlatform, a.priceMin]);
}

/** Checkouts da pagina: spy.checkouts (chave = url normalizada) e spy.offer_checkouts (o que a oferta leva hoje; os que sumiram saem). */
async function saveCheckouts(pool, domain, list) {
  const urls = list.map((c) => c.url);
  await pool.query('DELETE FROM spy.offer_checkouts WHERE domain = $1 AND checkout_url <> ALL($2::text[])', [domain, urls]);
  await pool.query('UPDATE spy.landings SET checkouts_at = NOW() WHERE domain = $1', [domain]);
  if (!list.length) return;
  await pool.query(
    `INSERT INTO spy.checkouts (checkout_url, platform, product_id)
     SELECT x.url, x.platform, x.product_id FROM jsonb_to_recordset($1::jsonb) AS x(url text, platform text, product_id text)
     ON CONFLICT (checkout_url) DO UPDATE SET last_seen_at = NOW(), platform = EXCLUDED.platform, product_id = COALESCE(EXCLUDED.product_id, spy.checkouts.product_id)`,
    [JSON.stringify(list.map((c) => ({ url: c.url, platform: c.platform, product_id: c.productId })))]);
  await pool.query('INSERT INTO spy.offer_checkouts (domain, checkout_url) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [domain, urls]);
}

async function saveFail(pool, domain, code) {
  // mantem o que ja havia (checkout/preco da v1); so registra a tentativa
  await pool.query(
    `INSERT INTO spy.landings (domain, fetched_at, error) VALUES ($1, NOW(), $2)
     ON CONFLICT (domain) DO UPDATE SET fetched_at = NOW(), error = EXCLUDED.error`, [domain, code]);
}

async function enrichOne(pool, row, fts, opts) {
  const { extractLandingTarget } = require('../lib/text');
  const target = extractLandingTarget(row.link_url);
  if (!target) { await saveFail(pool, row.domain, 'invalid_url'); return; }
  try {
    const a = await analyzeLanding(target.url, opts);
    await saveOk(pool, row.domain, a, fts);
    await saveCheckouts(pool, row.domain, a.checkouts || []);
    changed.add(row.domain);
  } catch (err) {
    await saveFail(pool, row.domain, String((err && err.errCode) || 'error').slice(0, 100));
  }
}

let running = false;
/** Um ciclo: reserva ate ENRICH_BATCH dominios e processa com concorrencia limitada. Nunca lanca. */
async function tick(pool, fts, opts) {
  if (running || !cfg.ENRICH_ENABLED) return 0;
  running = true;
  let n = 0;
  try {
    const queue = await nextDomains(pool, cfg.ENRICH_BATCH);
    for (const q of queue) inFlight.add(q.domain);
    const lanes = Array.from({ length: Math.max(1, cfg.ENRICH_CONCURRENCY) }, async () => {
      while (queue.length) {
        const row = queue.shift();
        try { await enrichOne(pool, row, fts, opts); n++; } catch (err) { console.error('[landing] falhou:', row.domain, err && err.message); }
        finally { inFlight.delete(row.domain); }
      }
    });
    await Promise.all(lanes);
    if (changed.size) { const doms = Array.from(changed); changed.clear(); await require('../offers/checkouts').recompute(pool, { domains: doms }).catch((e) => console.error('[checkouts] ranking:', e && e.message)); }
  } catch (err) {
    console.error('[landing] ciclo falhou:', err && err.message);
  } finally {
    running = false;
  }
  return n;
}

module.exports = { tick, nextDomains };
