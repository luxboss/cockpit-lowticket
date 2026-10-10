'use strict';
// Importacao unica e idempotente da v1 (miner_*) para o schema spy. So le miner_*; nunca escreve nelas.
// Marca em spy.meta (chave import_v1); sem a marca roda, e todo INSERT usa ON CONFLICT DO NOTHING (repetir e seguro).
const cfg = require('./config');
const { destTypeSql } = require('./lib/nonoffer');
const { TEMPLATE_SQL_RE } = require('./lib/text');

const META_KEY = 'import_v1';

async function tableExists(pool, name) {
  const r = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [name]);
  return !!r.rows[0].ok;
}
async function columnSet(pool, table) {
  const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table]);
  return new Set(r.rows.map((x) => x.column_name));
}

/** Contagens gravadas na marca (ou zeros). */
async function importedCounts(pool) {
  const r = await pool.query('SELECT value FROM spy.meta WHERE key = $1', [META_KEY]);
  const v = r.rows.length ? r.rows[0].value : null;
  return v ? { done: true, at: v.at, ads: v.ads || 0, advertisers: v.advertisers || 0, keywords: v.keywords || 0, landings: v.landings || 0 }
    : { done: false, at: null, ads: 0, advertisers: 0, keywords: 0, landings: 0 };
}

async function importFromV1(pool) {
  const cur = await importedCounts(pool);
  if (cur.done && !cfg.REIMPORT_V1) return cur;
  if (!(await tableExists(pool, 'public.miner_ads'))) return cur; // banco sem v1: nada a importar (tenta de novo na proxima subida)
  const cols = await columnSet(pool, 'miner_ads');
  const out = { at: new Date().toISOString(), ads: 0, advertisers: 0, keywords: 0, landings: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // anunciantes: nome mais recente de cada pagina
    let r = await client.query(
      `INSERT INTO spy.advertisers (page_id, name, first_seen_at, last_seen_at)
       SELECT DISTINCT ON (page_id) page_id, left(page_name, 500), first_seen_at, last_seen_at
         FROM miner_ads WHERE page_id <> '' ORDER BY page_id, last_seen_at DESC
       ON CONFLICT (page_id) DO NOTHING`);
    out.advertisers = r.rowCount;

    // anuncios (catalogo dinamico fica de fora, como no ranking da v1)
    const where = ['TRUE'];
    if (cols.has('is_catalog')) where.push('NOT m.is_catalog');
    where.push(`NOT (m.body ~ '${TEMPLATE_SQL_RE}' OR m.title ~ '${TEMPLATE_SQL_RE}' OR m.caption ~ '${TEMPLATE_SQL_RE}')`); // catalogo dinamico sem a marca is_catalog
    const lang = cols.has('language') ? "NULLIF(m.language, '')" : 'NULL';
    const validStart = (c) => `CASE WHEN m.${c} > 0 AND m.${c} <= EXTRACT(EPOCH FROM NOW()) + 86400 THEN to_timestamp(m.${c}) END`;
    r = await client.query(
      `INSERT INTO spy.ads (ad_archive_id, page_id, collation_id, duplicates, body, title, caption, cta_text, link_url, domain, dest_type,
                            display_format, media, countries, language, platforms, start_date, end_date, is_active, first_seen_at, last_seen_at)
       SELECT m.ad_archive_id, NULLIF(m.page_id, ''), m.collation_id, GREATEST(m.collation_count, 1), m.body, m.title, m.caption, m.cta_text, m.link_url,
              m.landing_domain, ${destTypeSql('m.landing_domain')}, m.display_format, m.media, m.countries, ${lang},
              ARRAY(SELECT jsonb_array_elements_text(m.platforms)), ${validStart('start_date')},
              CASE WHEN m.end_date > 0 THEN to_timestamp(m.end_date) END, m.is_active, m.first_seen_at, m.last_seen_at
         FROM miner_ads m WHERE ${where.join(' AND ')}
       ON CONFLICT (ad_archive_id) DO NOTHING`);
    out.ads = r.rowCount;
    await client.query(
      `INSERT INTO spy.ad_sources (ad_archive_id, source, seen_at)
       SELECT m.ad_archive_id, 'import', m.last_seen_at FROM miner_ads m WHERE EXISTS (SELECT 1 FROM spy.ads a WHERE a.ad_archive_id = m.ad_archive_id)
       ON CONFLICT DO NOTHING`);

    // palavras monitoradas (miner_searches); duplicadas pela chave unica sao ignoradas
    if (await tableExists(client, 'public.miner_searches')) {
      r = await client.query(
        `INSERT INTO spy.keywords (term, country, active, created_at, last_run_at, last_status)
         SELECT left(q, 80), CASE WHEN upper(country) = 'ALL' THEN 'ALL' ELSE upper(left(country, 2)) END, active, created_at, last_run_at, last_status
           FROM miner_searches WHERE length(trim(q)) >= 2 ORDER BY id
         ON CONFLICT DO NOTHING`);
      out.keywords = r.rowCount;
    }

    // landings ja enriquecidas na v1 (sem texto: o worker busca o texto depois)
    if (await tableExists(client, 'public.miner_domains')) {
      r = await client.query(
        `INSERT INTO spy.landings (domain, final_url, title, text, checkout_platform, price_min, fetched_at, error)
         SELECT landing_domain, final_url, page_title, NULL, NULLIF(checkout_platform, 'unknown'), price_min, enriched_at, last_error
           FROM miner_domains WHERE enriched_at IS NOT NULL
         ON CONFLICT (domain) DO NOTHING`);
      out.landings = r.rowCount;
    }
    await client.query(
      `INSERT INTO spy.meta (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [META_KEY, JSON.stringify(out)]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return Object.assign({ done: true }, out);
}

module.exports = { importFromV1, importedCounts };
