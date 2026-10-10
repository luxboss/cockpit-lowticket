'use strict';
// Ingestao em lotes: anunciantes, anuncios (upsert), fontes e snapshot do dia. SQL parametrizado, um lote por transacao.
const { extractLandingTarget, cleanText } = require('../lib/text');
const { destinationType } = require('../lib/nonoffer');
const { detectLanguage } = require('../lib/lang');
const { SP_TODAY_SQL } = require('../db');

const BATCH = 100;

/** Anuncio mapeado -> linha do lote (JSON para jsonb_to_recordset). */
function toRow(ad, country) {
  const target = extractLandingTarget(ad.linkUrl);
  const domain = target ? target.domain : null;
  const lang = detectLanguage([ad.body, ad.title, ad.caption].filter(Boolean).join(' '));
  return {
    id: ad.adArchiveId,
    page_id: ad.pageId || null,
    page_name: cleanText(ad.pageName, 500),
    avatar_url: ad.avatarUrl ? cleanText(ad.avatarUrl, 2000) : null,
    collation_id: ad.collationId,
    duplicates: ad.duplicates,
    body: cleanText(ad.body, 10000),
    title: cleanText(ad.title, 1000),
    caption: cleanText(ad.caption, 1000),
    cta_text: cleanText(ad.ctaText, 200),
    link_url: cleanText(ad.linkUrl, 2000),
    domain,
    dest_type: destinationType(domain),
    display_format: ad.displayFormat,
    media: { images: ad.images, videos: ad.videos },
    countries: country && country !== 'ALL' ? [country] : [],
    language: lang,
    platforms: ad.platforms,
    start_date: ad.startDate,
    end_date: ad.endDate,
    is_active: ad.isActive
  };
}

const UPSERT_ADV_SQL = `
  INSERT INTO spy.advertisers (page_id, name, avatar_url)
  SELECT DISTINCT ON (x.page_id) x.page_id, x.page_name, x.avatar_url
    FROM jsonb_to_recordset($1::jsonb) AS x(page_id text, page_name text, avatar_url text) WHERE x.page_id IS NOT NULL
  ON CONFLICT (page_id) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE spy.advertisers.name END,
    avatar_url = COALESCE(EXCLUDED.avatar_url, spy.advertisers.avatar_url),
    last_seen_at = NOW()`;

const UPSERT_AD_SQL = `
  INSERT INTO spy.ads (ad_archive_id, page_id, collation_id, duplicates, body, title, caption, cta_text, link_url, domain, dest_type,
                       display_format, media, countries, language, platforms, start_date, end_date, is_active)
  SELECT x.id, x.page_id, x.collation_id, x.duplicates, x.body, x.title, x.caption, x.cta_text, x.link_url, x.domain, x.dest_type,
         x.display_format, x.media, ARRAY(SELECT jsonb_array_elements_text(x.countries)), x.language,
         ARRAY(SELECT jsonb_array_elements_text(x.platforms)), to_timestamp(x.start_date), to_timestamp(x.end_date), x.is_active
    FROM jsonb_to_recordset($1::jsonb) AS x(id text, page_id text, collation_id text, duplicates int, body text, title text, caption text,
         cta_text text, link_url text, domain text, dest_type text, display_format text, media jsonb, countries jsonb, language text,
         platforms jsonb, start_date bigint, end_date bigint, is_active boolean)
  ON CONFLICT (ad_archive_id) DO UPDATE SET
    page_id = COALESCE(EXCLUDED.page_id, spy.ads.page_id),
    collation_id = COALESCE(EXCLUDED.collation_id, spy.ads.collation_id),
    duplicates = GREATEST(EXCLUDED.duplicates, spy.ads.duplicates),
    body = CASE WHEN EXCLUDED.body <> '' THEN EXCLUDED.body ELSE spy.ads.body END,
    title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE spy.ads.title END,
    caption = CASE WHEN EXCLUDED.caption <> '' THEN EXCLUDED.caption ELSE spy.ads.caption END,
    cta_text = CASE WHEN EXCLUDED.cta_text <> '' THEN EXCLUDED.cta_text ELSE spy.ads.cta_text END,
    link_url = CASE WHEN EXCLUDED.link_url <> '' THEN EXCLUDED.link_url ELSE spy.ads.link_url END,
    domain = CASE WHEN EXCLUDED.link_url <> '' THEN EXCLUDED.domain ELSE spy.ads.domain END,
    dest_type = CASE WHEN EXCLUDED.link_url <> '' THEN EXCLUDED.dest_type ELSE spy.ads.dest_type END,
    display_format = EXCLUDED.display_format,
    media = CASE WHEN EXCLUDED.media = '{"images":[],"videos":[]}'::jsonb THEN spy.ads.media ELSE EXCLUDED.media END,
    countries = ARRAY(SELECT DISTINCT c FROM unnest(spy.ads.countries || EXCLUDED.countries) AS c ORDER BY c),
    language = COALESCE(EXCLUDED.language, spy.ads.language),
    platforms = CASE WHEN cardinality(EXCLUDED.platforms) > 0 THEN EXCLUDED.platforms ELSE spy.ads.platforms END,
    start_date = COALESCE(EXCLUDED.start_date, spy.ads.start_date),
    end_date = EXCLUDED.end_date,
    is_active = EXCLUDED.is_active,
    last_seen_at = NOW()
  RETURNING ad_archive_id, (xmax = 0) AS inserted`;

/**
 * Ingere os anuncios mapeados (null = item rejeitado). source = 'keyword:<id>' | 'now:<id>'.
 * Retorna {inserted, updated, rejected, domains, ids}; domains e ids servem para recalcular a nota so do que mudou.
 */
async function ingestAds(pool, mapped, source, country) {
  const out = { inserted: 0, updated: 0, rejected: 0, domains: new Set(), ids: [] };
  const rows = [];
  const seen = new Set();
  for (const ad of mapped) {
    if (!ad) { out.rejected++; continue; }
    if (seen.has(ad.adArchiveId)) continue; // repetido no mesmo dataset
    seen.add(ad.adArchiveId);
    rows.push(toRow(ad, country));
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(UPSERT_ADV_SQL, [JSON.stringify(chunk)]);
      const r = await client.query(UPSERT_AD_SQL, [JSON.stringify(chunk)]);
      const ids = r.rows.map((x) => x.ad_archive_id);
      for (const x of r.rows) { if (x.inserted) out.inserted++; else out.updated++; }
      await client.query(
        `INSERT INTO spy.ad_sources (ad_archive_id, source, seen_at) SELECT unnest($1::text[]), $2, NOW()
         ON CONFLICT (ad_archive_id, source) DO UPDATE SET seen_at = NOW()`, [ids, source]);
      await client.query(
        `INSERT INTO spy.snapshots (ad_archive_id, day, is_active)
         SELECT a.ad_archive_id, ${SP_TODAY_SQL}, a.is_active FROM spy.ads a WHERE a.ad_archive_id = ANY($1::text[])
         ON CONFLICT (ad_archive_id, day) DO UPDATE SET is_active = EXCLUDED.is_active`, [ids]);
      await client.query('COMMIT');
      for (const row of chunk) { if (row.domain) out.domains.add(row.domain); }
      out.ids.push(...ids);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return out;
}

module.exports = { ingestAds, toRow };
