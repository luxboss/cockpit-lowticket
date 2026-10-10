'use strict';
// Sitemap do produtor (BE-017, AC-04): robots.txt (linhas Sitemap:), /sitemap.xml e sitemap index, ate SITEMAP_MAX_URLS URLs.
// Leitura com o lookup seguro e revalidacao de cada salto (mesma rotina da landing). No maximo 1 leitura por dia por dominio.
const cfg = require('../config');
const { INFO_PLATFORMS } = require('../lib/nonoffer');
const { decodeHtmlEntities } = require('../lib/text');
const { fetchLanding } = require('./landing');

const XML_TYPES = /(xml|text\/plain|octet-stream)/i;
const MAX_FETCHES = 8; // robots + sitemaps + filhos de um index

async function getText(url, opts) {
  const r = await fetchLanding(url, Object.assign({}, opts, { types: XML_TYPES, maxBytes: cfg.SITEMAP_MAX_BYTES }));
  return r.html;
}

const loc = (block) => { const m = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block); return m ? decodeHtmlEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()) : null; };
function lastmodOf(block) {
  const m = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i.exec(block);
  if (!m) return null;
  const t = Date.parse(m[1].trim());
  return Number.isFinite(t) && t > 0 && t < Date.now() + 86400000 * 2 ? new Date(t) : null;
}

/** Sitemap(s) do dominio. Devolve {urls:[{url, lastmod}], error}. opts.resolver so serve nos testes. */
async function readSitemap(origin, opts) {
  const host = new URL(origin).host;
  const sameHost = (u) => { try { return new URL(u).host === host; } catch (e) { return false; } };
  let fetches = 0;
  const queue = [];
  try {
    fetches++;
    const robots = await getText(origin + '/robots.txt', opts);
    for (const line of robots.split(/\r?\n/)) {
      const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
      if (m && sameHost(m[1]) && queue.length < 3 && !queue.includes(m[1])) queue.push(m[1]);
    }
  } catch (e) { /* sem robots.txt: segue para /sitemap.xml */ }
  if (!queue.length) queue.push(origin + '/sitemap.xml');

  const urls = new Map();
  let lastError = null;
  while (queue.length && fetches < MAX_FETCHES && urls.size < cfg.SITEMAP_MAX_URLS) {
    const sm = queue.shift();
    let xml;
    try { fetches++; xml = await getText(sm, opts); } catch (e) { lastError = (e && e.errCode) || 'error'; continue; }
    if (/<sitemapindex/i.test(xml)) {
      for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
        const child = loc(m[1]);
        if (child && sameHost(child) && queue.length < 5) queue.push(child);
      }
      continue;
    }
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const u = loc(m[1]);
      if (!u || !/^https?:\/\//i.test(u) || u.length > 1000) continue;
      if (!urls.has(u)) urls.set(u, lastmodOf(m[1]));
      if (urls.size >= cfg.SITEMAP_MAX_URLS) break;
    }
    lastError = null;
  }
  return { urls: Array.from(urls, ([url, lastmod]) => ({ url, lastmod })), error: urls.size ? null : (lastError || 'no_sitemap') };
}

/** Ofertas com checkout de infoproduto, ativas, sem leitura do sitemap nas ultimas SITEMAP_EVERY_HOURS, das de maior nota para as de menor. */
async function nextDomains(pool, limit) {
  const r = await pool.query(
    `SELECT l.domain, l.final_url
       FROM spy.landings l JOIN spy.offer_stats o ON o.domain = l.domain AND o.active_ads > 0
      WHERE (l.checkout_platform = ANY($1::text[]) OR EXISTS (SELECT 1 FROM spy.offer_checkouts oc WHERE oc.domain = l.domain))
        AND (l.sitemap_checked_at IS NULL OR l.sitemap_checked_at < NOW() - ($2::int * INTERVAL '1 hour'))
      ORDER BY o.score DESC, l.domain LIMIT $3`, [INFO_PLATFORMS, cfg.SITEMAP_EVERY_HOURS, limit]);
  return r.rows;
}

async function saveSitemap(pool, domain, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (res.urls.length) {
      await client.query(
        `INSERT INTO spy.offer_pages (domain, url, lastmod)
         SELECT $1, x.url, x.lastmod FROM jsonb_to_recordset($2::jsonb) AS x(url text, lastmod timestamptz)
         ON CONFLICT (domain, url) DO UPDATE SET lastmod = COALESCE(EXCLUDED.lastmod, spy.offer_pages.lastmod)`, [domain, JSON.stringify(res.urls)]);
      await client.query('DELETE FROM spy.offer_pages WHERE domain = $1 AND url <> ALL($2::text[])', [domain, res.urls.map((u) => u.url)]); // o sitemap atual manda
    }
    await client.query(
      `UPDATE spy.landings SET sitemap_checked_at = NOW(), sitemap_first_at = COALESCE(sitemap_first_at, NOW()), sitemap_error = $2 WHERE domain = $1`, [domain, res.error]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Um ciclo: ate SITEMAP_BATCH dominios. Nunca lanca. Retorna quantos foram lidos. */
async function tick(pool, opts) {
  if (!cfg.SITEMAP_ENABLED) return 0;
  let n = 0;
  try {
    for (const row of await nextDomains(pool, cfg.SITEMAP_BATCH)) {
      let origin;
      try { const u = new URL(row.final_url || ('https://' + row.domain + '/')); origin = u.origin; } catch (e) { origin = 'https://' + row.domain; }
      const res = await readSitemap(origin, opts);
      await saveSitemap(pool, row.domain, res);
      n++;
    }
  } catch (e) { console.error('[sitemap] ciclo falhou:', e && e.message); }
  return n;
}

module.exports = { tick, readSitemap, nextDomains };
