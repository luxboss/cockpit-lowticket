'use strict';
// Migracao idempotente do schema spy (SPEC-008 secao 4). Nao toca nas tabelas miner_* nem em projects.
// Extensoes unaccent e pg_trgm sao opcionais: sem elas a busca cai para ILIKE e /status mostra search.fts=false.
const cfg = require('./config');

const LOCK_KEY = 8150001; // pg_advisory_lock: dois processos subindo juntos nao disputam o DDL

const CORE_SQL = `
CREATE SCHEMA IF NOT EXISTS spy;

CREATE TABLE IF NOT EXISTS spy.meta (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spy.advertisers (
  page_id       VARCHAR(100) PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spy.ads (
  ad_archive_id  VARCHAR(30) PRIMARY KEY,
  page_id        VARCHAR(100) REFERENCES spy.advertisers(page_id),
  collation_id   VARCHAR(100),
  duplicates     INTEGER NOT NULL DEFAULT 1,
  body           TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  caption        TEXT NOT NULL DEFAULT '',
  cta_text       TEXT NOT NULL DEFAULT '',
  link_url       TEXT NOT NULL DEFAULT '',
  domain         VARCHAR(253),
  dest_type      VARCHAR(12) NOT NULL DEFAULT 'offer',
  display_format VARCHAR(20) NOT NULL DEFAULT 'OTHER',
  media          JSONB NOT NULL DEFAULT '{}'::jsonb,
  countries      TEXT[] NOT NULL DEFAULT '{}',
  language       VARCHAR(2),
  platforms      TEXT[] NOT NULL DEFAULT '{}',
  start_date     TIMESTAMPTZ,
  end_date       TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score          REAL NOT NULL DEFAULT 0,
  search_tsv     TSVECTOR
);
-- ordenacoes (destinos de oferta; is_active vai no INCLUDE para a contagem do caminho padrao sair so do indice): cada uma com o desempate por id
DROP INDEX IF EXISTS spy.idx_spy_ads_score;
DROP INDEX IF EXISTS spy.idx_spy_ads_longest;
DROP INDEX IF EXISTS spy.idx_spy_ads_newest;
DROP INDEX IF EXISTS spy.idx_spy_ads_last_seen;
DROP INDEX IF EXISTS spy.idx_spy_ads_dup;
CREATE INDEX IF NOT EXISTS idx_spy_ads_o_score ON spy.ads (score DESC, ad_archive_id) INCLUDE (is_active) WHERE dest_type = 'offer';
CREATE INDEX IF NOT EXISTS idx_spy_ads_o_longest ON spy.ads (start_date ASC, ad_archive_id) INCLUDE (is_active) WHERE dest_type = 'offer';
CREATE INDEX IF NOT EXISTS idx_spy_ads_o_newest ON spy.ads (start_date DESC NULLS LAST, ad_archive_id) INCLUDE (is_active) WHERE dest_type = 'offer';
CREATE INDEX IF NOT EXISTS idx_spy_ads_o_last_seen ON spy.ads (last_seen_at DESC, ad_archive_id) INCLUDE (is_active) WHERE dest_type = 'offer';
CREATE INDEX IF NOT EXISTS idx_spy_ads_o_dup ON spy.ads (duplicates DESC, ad_archive_id) INCLUDE (is_active) WHERE dest_type = 'offer';
-- filtros e vinculos
CREATE INDEX IF NOT EXISTS idx_spy_ads_domain ON spy.ads (domain);
CREATE INDEX IF NOT EXISTS idx_spy_ads_page ON spy.ads (page_id);
CREATE INDEX IF NOT EXISTS idx_spy_ads_countries ON spy.ads USING GIN (countries);
CREATE INDEX IF NOT EXISTS idx_spy_ads_language ON spy.ads (language);
CREATE INDEX IF NOT EXISTS idx_spy_ads_format ON spy.ads (display_format);
CREATE INDEX IF NOT EXISTS idx_spy_ads_cta ON spy.ads (cta_text);
CREATE INDEX IF NOT EXISTS idx_spy_ads_collation ON spy.ads (collation_id);

CREATE TABLE IF NOT EXISTS spy.ad_sources (
  ad_archive_id VARCHAR(30) NOT NULL,
  source        VARCHAR(60) NOT NULL,
  seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ad_archive_id, source)
);
CREATE INDEX IF NOT EXISTS idx_spy_ad_sources_source ON spy.ad_sources (source);

CREATE TABLE IF NOT EXISTS spy.landings (
  domain            VARCHAR(253) PRIMARY KEY,
  final_url         TEXT,
  title             TEXT,
  text              TEXT,
  text_tsv          TSVECTOR,
  checkout_platform VARCHAR(30),
  price_min         NUMERIC(12,2),
  fetched_at        TIMESTAMPTZ,
  error             VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_spy_landings_checkout ON spy.landings (checkout_platform);

CREATE TABLE IF NOT EXISTS spy.snapshots (
  ad_archive_id VARCHAR(30) NOT NULL,
  day           DATE NOT NULL,
  is_active     BOOLEAN NOT NULL,
  PRIMARY KEY (ad_archive_id, day)
);
CREATE INDEX IF NOT EXISTS idx_spy_snapshots_day ON spy.snapshots (day);

CREATE TABLE IF NOT EXISTS spy.keywords (
  id          BIGSERIAL PRIMARY KEY,
  term        VARCHAR(80) NOT NULL,
  country     VARCHAR(3) NOT NULL DEFAULT 'BR',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMPTZ,
  last_status VARCHAR(20)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spy_keywords_term ON spy.keywords (lower(term), country);

CREATE TABLE IF NOT EXISTS spy.collect_runs (
  id            BIGSERIAL PRIMARY KEY,
  kind          VARCHAR(10) NOT NULL,
  keyword_id    BIGINT REFERENCES spy.keywords(id) ON DELETE SET NULL,
  term          VARCHAR(80) NOT NULL,
  country       VARCHAR(3) NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'queued',
  received      INTEGER NOT NULL DEFAULT 0,
  inserted      INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,4),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  error         VARCHAR(200),
  reserved      INTEGER NOT NULL DEFAULT 0,
  reserved_day  DATE,
  apify_run_id  VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_spy_runs_status ON spy.collect_runs (status, kind, id);
-- um Buscar agora aberto por termo e pais (o segundo pedido recebe 409 run_in_progress)
CREATE UNIQUE INDEX IF NOT EXISTS uq_spy_runs_now_open ON spy.collect_runs (lower(term), country) WHERE kind = 'now' AND status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS spy.usage_daily (
  day  DATE NOT NULL,
  kind VARCHAR(10) NOT NULL,
  ads  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);

CREATE TABLE IF NOT EXISTS spy.worker_heartbeat (
  name    VARCHAR(50) PRIMARY KEY,
  beat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  info    JSONB NOT NULL DEFAULT '{}'::jsonb
);
`;

/** Schema onde a extensao ficou (a existente, ou spy se criamos agora); null se nao existe. */
async function extSchema(pool, name) {
  const r = await pool.query('SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = $1', [name]);
  return r.rows.length ? r.rows[0].nspname : null;
}

async function tryExec(pool, sql, warnings, label) {
  try { await pool.query(sql); return true; } catch (e) {
    warnings.push(label + ': ' + String(e && e.message).slice(0, 160));
    return false;
  }
}

/** Parte dependente das extensoes. Devolve true se a busca por texto completo (FTS) ficou disponivel. */
async function setupFts(pool, warnings) {
  if (cfg.FORCE_NO_FTS) { warnings.push('FTS desligado por SPY_FORCE_NO_FTS (teste)'); return false; }
  await tryExec(pool, 'CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA spy', warnings, 'unaccent');
  await tryExec(pool, 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA spy', warnings, 'pg_trgm');
  const ua = await extSchema(pool, 'unaccent');
  const tg = await extSchema(pool, 'pg_trgm');
  if (!ua || !tg) return false;
  const ok = await tryExec(pool, `
    CREATE OR REPLACE FUNCTION spy.f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT ${ua}.unaccent('${ua}.unaccent'::regdictionary, $1) $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace WHERE c.cfgname = 'pt' AND n.nspname = 'spy') THEN
        CREATE TEXT SEARCH CONFIGURATION spy.pt (COPY = pg_catalog.portuguese);
        ALTER TEXT SEARCH CONFIGURATION spy.pt ALTER MAPPING FOR hword, hword_part, word WITH ${ua}.unaccent, portuguese_stem;
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION spy.ads_tsv() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.search_tsv := to_tsvector('spy.pt', coalesce(NEW.body, '') || ' ' || coalesce(NEW.title, '') || ' ' || coalesce(NEW.caption, ''));
      RETURN NEW;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ads_tsv_trg' AND tgrelid = 'spy.ads'::regclass) THEN
        CREATE TRIGGER ads_tsv_trg BEFORE INSERT OR UPDATE OF body, title, caption ON spy.ads FOR EACH ROW EXECUTE FUNCTION spy.ads_tsv();
      END IF;
    END $$;`, warnings, 'fts-setup');
  if (!ok) return false;
  // teste real: acento removido e radical em portugues
  try {
    const t = await pool.query("SELECT to_tsvector('spy.pt', 'Cafés') @@ websearch_to_tsquery('spy.pt', 'cafe') AS ok, spy.f_unaccent('é') AS u");
    if (!t.rows[0].ok || t.rows[0].u !== 'e') { warnings.push('FTS: teste de unaccent falhou'); return false; }
  } catch (e) { warnings.push('FTS: ' + String(e.message).slice(0, 120)); return false; }
  await tryExec(pool, `
    CREATE INDEX IF NOT EXISTS idx_spy_ads_tsv ON spy.ads USING GIN (search_tsv);
    CREATE INDEX IF NOT EXISTS idx_spy_ads_domain_trgm ON spy.ads USING GIN (domain ${tg}.gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_spy_ads_url_trgm ON spy.ads USING GIN (link_url ${tg}.gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_spy_landings_tsv ON spy.landings USING GIN (text_tsv);`, warnings, 'fts-indexes');
  await tryExec(pool, 'CREATE UNIQUE INDEX IF NOT EXISTS uq_spy_keywords_term_unaccent ON spy.keywords (lower(spy.f_unaccent(term)), country)', warnings, 'keywords-unaccent');
  // preenche o vetor de linhas que entraram sem ele (importacao feita antes das extensoes)
  for (;;) {
    const r = await pool.query(`UPDATE spy.ads SET body = body WHERE ad_archive_id IN (SELECT ad_archive_id FROM spy.ads WHERE search_tsv IS NULL LIMIT 5000)`);
    if (r.rowCount === 0) break;
  }
  await pool.query(`UPDATE spy.landings SET text_tsv = to_tsvector('spy.pt', coalesce(title, '') || ' ' || coalesce(text, '')) WHERE text_tsv IS NULL AND (text IS NOT NULL OR title IS NOT NULL)`);
  return true;
}

/** Cria/atualiza o schema. Devolve {fts, warnings}. Seguro para rodar a cada subida e em paralelo. */
async function migrate(pool) {
  const client = await pool.connect();
  const warnings = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(CORE_SQL);
    const fts = await setupFts(client, warnings);
    return { fts, warnings };
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (e) { /* conexao ja caiu */ }
    client.release();
  }
}

/** Para o worker: o schema ja foi migrado pelo site; so descobre se o FTS esta disponivel. */
async function detectFts(pool) {
  if (cfg.FORCE_NO_FTS) return false;
  try {
    const r = await pool.query(`SELECT EXISTS (SELECT 1 FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace WHERE c.cfgname = 'pt' AND n.nspname = 'spy')
      AND to_regprocedure('spy.f_unaccent(text)') IS NOT NULL AS ok`);
    return !!r.rows[0].ok;
  } catch (e) { return false; }
}

module.exports = { migrate, detectFts, CORE_SQL };
