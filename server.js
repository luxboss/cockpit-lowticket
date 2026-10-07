'use strict';
/**
 * Cockpit Low Ticket - servidor HTTP + API PostgreSQL
 *
 * Variaveis de ambiente:
 *   PORT                 porta HTTP (padrao 80)
 *   DATABASE_URL         string de conexao PostgreSQL (Easypanel: use o host interno do servico)
 *   APP_TOKEN            (recomendado) token de acesso da API. Se vazio, a API fica aberta.
 *   PGSSL=true           forca SSL no banco (so use se o banco exigir; o Postgres interno do Easypanel NAO usa SSL)
 *   PGSSL_REJECT_UNAUTHORIZED=true   valida o certificado quando PGSSL=true
 *   GEMINI_API_KEY       (proxy de IA) chave da API Gemini; so existe no servidor. Sem ela: 503 ai_not_configured
 *   GEMINI_MODEL         (proxy de IA) modelo usado (padrao gemini-3.8-flash); o cliente nao escolhe
 *   GEMINI_BASE_URL      (proxy de IA) URL base da API (padrao https://generativelanguage.googleapis.com/v1beta)
 *   O proxy POST /api/ai/generate exige APP_TOKEN definido (senao 503 ai_requires_app_token).
 *   Minerador: POST /api/miner/ingest, GET /api/miner/offers[/:domain] (Bearer APP_TOKEN + banco; sem APP_TOKEN: 503 miner_requires_app_token; sem banco: 503 db_offline).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

let pg = null;
try {
  pg = require('pg');
} catch (e) {
  console.warn('[PostgreSQL] Modulo "pg" nao encontrado. Rode "npm install". Operando sem banco.');
}

const PORT = parseInt(process.env.PORT, 10) || 80;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const APP_TOKEN = process.env.APP_TOKEN || '';
const ROOT = __dirname;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const AI_MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB (somente /api/ai/generate)
const AI_TIMEOUT_MS = 120000; // 120 s
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

// Minerador de Ofertas (SPEC-004): limites e constantes da pontuacao (ajustaveis)
const MINER_MAX_ADS = 200;               // anuncios por lote de ingestao
const MINER_MAX_QUERIES = 20;            // buscas distintas guardadas por anuncio
const MINER_MAX_PLATFORMS = 10;
const MINER_MAX_IMAGES = 10;
const MINER_MAX_VIDEOS = 5;
const MINER_ACTIVE_WINDOW_HOURS = 48;    // janela do "ativo" na fotografia diaria
const MINER_OFFER_WINDOW_DAYS = 7;       // so anuncios ativos vistos nesta janela entram no ranking
const MINER_DEFAULT_LIMIT = 30;
const MINER_MAX_LIMIT = 100;
const MINER_SAMPLE_ADS = 3;              // anuncios de amostra por oferta
const MINER_DETAIL_MAX_ADS = 1000;       // teto de anuncios no detalhe do dominio
const MINER_SNAPSHOT_DAYS = 30;          // historico devolvido no detalhe
const MINER_SCORE_ACTIVE_WEIGHT = 2;     // score = activeAds*2 + distinct*1.5 + min(dias,60)*0.5 + max(growth7d,0)*3
const MINER_SCORE_DISTINCT_WEIGHT = 1.5;
const MINER_SCORE_DAYS_WEIGHT = 0.5;
const MINER_SCORE_DAYS_CAP = 60;
const MINER_SCORE_GROWTH_WEIGHT = 3;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------
let pool = null;
let isDbConnected = false;
let dbErrorMsg = '';
let reconnectTimer = null;
let reconnecting = false;

/** Remove sslmode da URL para que a nossa configuracao explicita de SSL seja a unica valida. */
function stripSslMode(url) {
  return url
    .replace(/([?&])sslmode=[^&]*&?/i, '$1')
    .replace(/[?&]$/, '');
}

function buildSslOption() {
  const urlWantsSsl = /sslmode=(require|verify-ca|verify-full)/i.test(DATABASE_URL);
  const envWantsSsl = String(process.env.PGSSL || '').toLowerCase() === 'true';
  if (!urlWantsSsl && !envWantsSsl) return false;
  return { rejectUnauthorized: String(process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' };
}

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id          VARCHAR(100) PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        niche       VARCHAR(255),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW(),
        data        JSONB DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
      CREATE TABLE IF NOT EXISTS app_state (
        key         VARCHAR(50) PRIMARY KEY,
        value       JSONB NOT NULL,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
      -- Migracao idempotente (soft delete + LWW): so adiciona, nunca remove
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_updated_at BIGINT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects (deleted_at);
      -- Minerador de Ofertas (SPEC-004): anuncios e fotografias diarias sao globais (sem user_id)
      CREATE TABLE IF NOT EXISTS miner_ads (
        ad_archive_id    VARCHAR(30) PRIMARY KEY,
        page_id          VARCHAR(100) NOT NULL DEFAULT '',
        page_name        VARCHAR(255) NOT NULL DEFAULT '',
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        start_date       BIGINT NOT NULL,
        end_date         BIGINT,
        collation_id     VARCHAR(100),
        collation_count  INTEGER NOT NULL DEFAULT 1,
        platforms        JSONB NOT NULL DEFAULT '[]'::jsonb,
        display_format   VARCHAR(20) NOT NULL DEFAULT 'OTHER',
        body             TEXT NOT NULL DEFAULT '',
        title            TEXT NOT NULL DEFAULT '',
        caption          TEXT NOT NULL DEFAULT '',
        cta_text         TEXT NOT NULL DEFAULT '',
        link_url         TEXT NOT NULL DEFAULT '',
        landing_domain   VARCHAR(255),
        media            JSONB NOT NULL DEFAULT '{}'::jsonb,
        countries        TEXT[] NOT NULL DEFAULT '{}',
        queries          TEXT[] NOT NULL DEFAULT '{}',
        first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_miner_ads_landing_domain ON miner_ads (landing_domain);
      CREATE INDEX IF NOT EXISTS idx_miner_ads_last_seen_at ON miner_ads (last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_miner_ads_is_active ON miner_ads (is_active);
      CREATE TABLE IF NOT EXISTS miner_snapshots (
        day                DATE NOT NULL,
        landing_domain     VARCHAR(255) NOT NULL,
        active_ads         INTEGER NOT NULL DEFAULT 0,
        distinct_creatives INTEGER NOT NULL DEFAULT 0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day, landing_domain)
      );
      CREATE INDEX IF NOT EXISTS idx_miner_snapshots_domain ON miner_snapshots (landing_domain, day);
      -- Pronto para SaaS (ADR-002 M1.1): quem contribuiu com cada anuncio e o log de lotes
      CREATE TABLE IF NOT EXISTS miner_ad_sources (
        ad_archive_id      VARCHAR(30) NOT NULL,
        submitter_id       VARCHAR(100) NOT NULL,
        first_submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        times_seen         INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (ad_archive_id, submitter_id)
      );
      CREATE TABLE IF NOT EXISTS miner_ingest_batches (
        id           BIGSERIAL PRIMARY KEY,
        submitter_id VARCHAR(100) NOT NULL,
        ext_version  VARCHAR(50),
        received     INTEGER NOT NULL DEFAULT 0,
        inserted     INTEGER NOT NULL DEFAULT 0,
        updated      INTEGER NOT NULL DEFAULT 0,
        rejected     INTEGER NOT NULL DEFAULT 0,
        context      JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );      -- Backfill idempotente: linhas legadas herdam a versao de data.updatedAt (so inteiro valido, so onde ainda e 0, sem tombstones)
      UPDATE projects
         SET client_updated_at = CASE WHEN data->>'updatedAt' ~ '^[0-9]{1,15}$' THEN (data->>'updatedAt')::bigint ELSE 0 END
       WHERE client_updated_at = 0
         AND deleted_at IS NULL
         AND data->>'updatedAt' ~ '^[0-9]{1,15}$';
    `);
  } finally {
    client.release();
  }
  isDbConnected = true;
  dbErrorMsg = '';
  console.log('[PostgreSQL] Conectado. Tabelas verificadas (projects, app_state).');
}

/** Tenta conectar com backoff. Resolve o caso do app subir antes do banco estar pronto. */
async function connectWithRetry(attempt = 1) {
  if (!pool || reconnecting) return;
  reconnecting = true;
  try {
    await initDatabase();
    reconnecting = false;
  } catch (err) {
    reconnecting = false;
    isDbConnected = false;
    dbErrorMsg = err.message;
    const delay = Math.min(30000, 2000 * attempt);
    console.error(`[PostgreSQL] Falha na conexao (tentativa ${attempt}): ${err.message}. Nova tentativa em ${delay / 1000}s.`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connectWithRetry(attempt + 1), delay);
  }
}

if (pg && DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: stripSslMode(DATABASE_URL),
    ssl: buildSslOption(),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  pool.on('error', (err) => {
    console.error('[PostgreSQL] Erro no pool:', err.message);
    isDbConnected = false;
    dbErrorMsg = err.message;
    connectWithRetry();
  });
  // Clientes retirados do pool nao tem listener do pool: sem este handler, um 'error' (ex.: ECONNRESET)
  // derruba o processo. So dispara reconexao na transicao online -> offline (sem cascata).
  pool.on('connect', (client) => {
    client.on('error', (err) => {
      console.error('[PostgreSQL] Erro em conexao do pool:', err.message);
      const wasConnected = isDbConnected;
      isDbConnected = false;
      dbErrorMsg = err.message;
      if (wasConnected) connectWithRetry();
    });
  });
  connectWithRetry();

  // Health check periodico: detecta queda do banco e reconecta sozinho.
  setInterval(async () => {
    if (!isDbConnected) return;
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      console.error('[PostgreSQL] Health check falhou:', err.message);
      isDbConnected = false;
      dbErrorMsg = err.message;
      connectWithRetry();
    }
  }, 30000).unref();
} else {
  dbErrorMsg = pg ? 'DATABASE_URL nao configurada' : 'modulo pg ausente';
  console.log(`[PostgreSQL] Desativado (${dbErrorMsg}). A interface opera com armazenamento local.`);
}

if (!APP_TOKEN) {
  console.warn('[Seguranca] APP_TOKEN nao definido: a API /api/* esta ABERTA. Defina APP_TOKEN no Easypanel.');
}

// ---------------------------------------------------------------------------
// Utilitarios HTTP
// ---------------------------------------------------------------------------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { tooBig = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('Payload muito grande'), { status: 413 }));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(Object.assign(new Error('JSON invalido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  if (!APP_TOKEN) return true;
  const header = req.headers['authorization'] || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided) return false;
  // Compara hashes de mesmo tamanho em tempo constante.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(APP_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

const ID_REGEX = /^[A-Za-z0-9_.\-]{1,100}$/;

/** Remove segredos antes de persistir/expor estado. */
function sanitizeState(state) {
  const clean = state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {};
  delete clean.googleApiKey;
  return clean;
}

function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, name, niche, ...extra } = raw;
  if (typeof id !== 'string' || !ID_REGEX.test(id)) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > 255) return null;
  // updatedAt do cliente (epoch ms): numero finito >= 0, senao 0. Continua tambem dentro de data.
  const u = extra.updatedAt;
  const updatedAt = typeof u === 'number' && Number.isFinite(u) && u >= 0 && u <= Number.MAX_SAFE_INTEGER ? Math.floor(u) : 0;
  return { id, name: name.trim(), niche: typeof niche === 'string' ? niche.slice(0, 255) : '', extra, updatedAt };
}

// Upsert condicional (LWW): so aplica se nao ha tombstone e a versao recebida nao e mais antiga.
// RETURNING id lista apenas as linhas aplicadas.
const UPSERT_PROJECT_SQL = `
  INSERT INTO projects (id, name, niche, data, client_updated_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, NOW())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    niche = EXCLUDED.niche,
    data = EXCLUDED.data,
    client_updated_at = EXCLUDED.client_updated_at,
    updated_at = NOW()
  WHERE projects.deleted_at IS NULL
    AND projects.client_updated_at <= EXCLUDED.client_updated_at
  RETURNING id`;

// Soft delete: tombstone final, cria a linha se o id nao existir e preserva o deleted_at original.
const DELETE_PROJECT_SQL = `
  INSERT INTO projects (id, name, deleted_at, client_updated_at)
  VALUES ($1, '[excluido]', NOW(), $2)
  ON CONFLICT (id) DO UPDATE SET deleted_at = COALESCE(projects.deleted_at, NOW())
  RETURNING deleted_at`;

// ---------------------------------------------------------------------------
// Proxy de IA (Gemini): a chave fica so no servidor, enviada no header x-goog-api-key
// ---------------------------------------------------------------------------
/** Remove a chave de qualquer texto antes de expor (defesa extra). */
function scrubKey(text) {
  const s = String(text == null ? '' : text);
  return GEMINI_API_KEY ? s.split(GEMINI_API_KEY).join('[redigido]') : s;
}

async function handleAiGenerate(req, res) {
  if (!APP_TOKEN) return sendJson(res, 503, { ok: false, error: 'ai_requires_app_token' });
  if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  if (!GEMINI_API_KEY) return sendJson(res, 503, { ok: false, error: 'ai_not_configured' });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  let payload;
  try {
    payload = await readJsonBody(req, AI_MAX_BODY_BYTES);
  } catch (err) {
    if (err.status) return sendJson(res, err.status, { ok: false, error: err.message });
    return sendJson(res, 400, { ok: false, error: 'JSON invalido' });
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.contents) || payload.contents.length === 0) {
    return sendJson(res, 400, { ok: false, error: 'contents deve ser um array nao vazio' });
  }

  // Somente contents/generationConfig seguem adiante; modelo e chave nunca vem do cliente.
  const outbound = { contents: payload.contents };
  if (payload.generationConfig && typeof payload.generationConfig === 'object') {
    outbound.generationConfig = payload.generationConfig;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(outbound),
      signal: controller.signal
    });
    const text = await upstream.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* resposta nao JSON */ }
    if (!upstream.ok || data === null) {
      const detail = data && data.error && data.error.message ? data.error.message : 'resposta invalida do upstream';
      return sendJson(res, 502, {
        ok: false,
        error: 'ai_upstream_error',
        upstreamStatus: upstream.status,
        detail: scrubKey(detail).slice(0, 500)
      });
    }
    return sendJson(res, 200, data);
  } catch (err) {
    if (err && err.name === 'AbortError') return sendJson(res, 504, { ok: false, error: 'ai_timeout' });
    console.error('[IA] Falha ao contatar o upstream:', scrubKey(err && err.message));
    return sendJson(res, 502, { ok: false, error: 'ai_upstream_unreachable' });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Minerador de Ofertas (SPEC-004): ingestao da extensao e ranking por dominio
// ---------------------------------------------------------------------------
/** Identidade do pedido. Hoje: 'owner' para o Bearer APP_TOKEN; no SaaS le o JWT do utilizador. */
function getRequestUserId(req) {
  return isAuthorized(req) ? 'owner' : null;
}

const HOSTNAME_REGEX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MINER_DISPLAY_FORMATS = new Set(['IMAGE', 'VIDEO', 'CAROUSEL', 'DCO', 'OTHER']);
const MINER_SORTS = { score: 'score', activeAds: 'active_ads', days: 'max_days_running', growth: 'growth7d' };

/** Texto limpo: so string, sem NUL (o Postgres rejeita), cortado em max. */
function minerText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\u0000/g, '').slice(0, max);
}

function minerUrlList(v, maxItems) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    const s = minerText(item, 2000);
    if (/^https?:\/\//i.test(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Hostname do destino em minusculas sem "www."; desembrulha redirecionadores da Meta; invalido -> null. */
function extractLandingDomain(linkUrl) {
  let url = typeof linkUrl === 'string' ? linkUrl.trim() : '';
  for (let hop = 0; hop < 3 && url; hop++) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'l.facebook.com' || host === 'lm.facebook.com') {
      url = u.searchParams.get('u') || '';
      continue;
    }
    const clean = host.replace(/\.$/, '').replace(/^www\./, '');
    return HOSTNAME_REGEX.test(clean) ? clean : null;
  }
  return null;
}

/** Valida e normaliza um MinerAd. Retorna { ad } ou { error }. */
function normalizeMinerAd(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid_ad' };
  if (typeof raw.adArchiveId !== 'string' || !/^[0-9]{1,30}$/.test(raw.adArchiveId)) return { error: 'invalid_ad_archive_id' };
  if (!Number.isInteger(raw.startDate) || raw.startDate <= 0) return { error: 'invalid_start_date' };
  const endDate = Number.isInteger(raw.endDate) && raw.endDate > 0 ? raw.endDate : null;
  const collationId = minerText(raw.collationId, 100) || null;
  const collationCount = Number.isInteger(raw.collationCount) && raw.collationCount >= 1 ? Math.min(raw.collationCount, 1000000) : 1;
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.map((p) => minerText(p, 50)).filter(Boolean).slice(0, MINER_MAX_PLATFORMS) : [];
  const videos = [];
  if (Array.isArray(raw.videos)) {
    for (const v of raw.videos) {
      if (!v || typeof v !== 'object') continue;
      videos.push({ hd: minerText(v.hd, 2000) || null, sd: minerText(v.sd, 2000) || null, preview: minerText(v.preview, 2000) || null });
      if (videos.length >= MINER_MAX_VIDEOS) break;
    }
  }
  const linkUrl = minerText(raw.linkUrl, 2000);
  return {
    ad: {
      adArchiveId: raw.adArchiveId,
      pageId: minerText(raw.pageId, 100),
      pageName: minerText(raw.pageName, 255),
      isActive: raw.isActive !== false,
      startDate: raw.startDate,
      endDate,
      collationId,
      collationCount,
      platforms,
      displayFormat: MINER_DISPLAY_FORMATS.has(raw.displayFormat) ? raw.displayFormat : 'OTHER',
      body: minerText(raw.body, 5000),
      title: minerText(raw.title, 500),
      caption: minerText(raw.caption, 500),
      ctaText: minerText(raw.ctaText, 500),
      linkUrl,
      landingDomain: extractLandingDomain(linkUrl),
      media: { images: minerUrlList(raw.images, MINER_MAX_IMAGES), videos }
    }
  };
}

/** Contexto da captura: q e country entram nas unioes do anuncio; o resto so no log do lote. */
function normalizeMinerContext(ctx) {
  const c = ctx && typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {};
  const country = typeof c.country === 'string' && /^[A-Za-z]{2,3}$/.test(c.country.trim()) ? c.country.trim().toUpperCase() : null;
  return {
    q: minerText(c.q, 500).trim() || null,
    country,
    mediaType: minerText(c.mediaType, 20) || null,
    url: minerText(c.url, 1000) || null
  };
}

// Upsert por ad_archive_id. (xmax = 0) so e verdadeiro na linha inserida (nao em update).
// first_seen_at nunca muda; countries/queries sao unioes (queries: ordem de chegada, max MINER_MAX_QUERIES).
const MINER_UPSERT_AD_SQL = `
  INSERT INTO miner_ads (ad_archive_id, page_id, page_name, is_active, start_date, end_date, collation_id, collation_count,
                         platforms, display_format, body, title, caption, cta_text, link_url, landing_domain, media,
                         countries, queries, first_seen_at, last_seen_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
  ON CONFLICT (ad_archive_id) DO UPDATE SET
    page_id = EXCLUDED.page_id, page_name = EXCLUDED.page_name, is_active = EXCLUDED.is_active,
    start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
    collation_id = EXCLUDED.collation_id, collation_count = EXCLUDED.collation_count,
    platforms = EXCLUDED.platforms, display_format = EXCLUDED.display_format,
    body = EXCLUDED.body, title = EXCLUDED.title, caption = EXCLUDED.caption, cta_text = EXCLUDED.cta_text,
    link_url = EXCLUDED.link_url, landing_domain = EXCLUDED.landing_domain, media = EXCLUDED.media,
    countries = ARRAY(SELECT DISTINCT c FROM unnest(miner_ads.countries || EXCLUDED.countries) AS c ORDER BY c),
    queries = ARRAY(SELECT q FROM (SELECT q, MIN(ord) AS o FROM unnest(miner_ads.queries || EXCLUDED.queries) WITH ORDINALITY AS t(q, ord)
                                   GROUP BY q ORDER BY o LIMIT ${MINER_MAX_QUERIES}) s ORDER BY o),
    last_seen_at = NOW()
  RETURNING (xmax = 0) AS inserted`;

// Fotografia do dia (America/Sao_Paulo) dos dominios tocados: so anuncios ativos vistos nas ultimas 48 h.
const MINER_SNAPSHOT_SQL = `
  INSERT INTO miner_snapshots (day, landing_domain, active_ads, distinct_creatives, updated_at)
  SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, landing_domain,
         COUNT(*) FILTER (WHERE is_active AND last_seen_at >= NOW() - INTERVAL '${MINER_ACTIVE_WINDOW_HOURS} hours'),
         COUNT(DISTINCT COALESCE(collation_id, ad_archive_id)) FILTER (WHERE is_active AND last_seen_at >= NOW() - INTERVAL '${MINER_ACTIVE_WINDOW_HOURS} hours'),
         NOW()
    FROM miner_ads
   WHERE landing_domain = ANY($1)
   GROUP BY landing_domain
  ON CONFLICT (day, landing_domain) DO UPDATE SET
    active_ads = EXCLUDED.active_ads, distinct_creatives = EXCLUDED.distinct_creatives, updated_at = NOW()`;

async function handleMinerIngest(req, res) {
  const submitterId = getRequestUserId(req);
  if (!submitterId) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  const payload = await readJsonBody(req); // 413 / 400 tratados pelo catch do handleApi
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(res, 400, { ok: false, error: 'invalid_body' });
  if (typeof payload.source !== 'string' || !payload.source.trim() || payload.source.length > 50) {
    return sendJson(res, 400, { ok: false, error: 'invalid_source' });
  }
  if (!Array.isArray(payload.ads) || payload.ads.length < 1 || payload.ads.length > MINER_MAX_ADS) {
    return sendJson(res, 400, { ok: false, error: 'invalid_ads', detail: `ads deve ser um array de 1 a ${MINER_MAX_ADS}` });
  }
  const context = normalizeMinerContext(payload.context);
  const extVersion = minerText(payload.extVersion, 50) || null;

  // Validacao por anuncio: invalidos (e duplicados no lote) vao para rejected sem abortar o lote.
  const rejected = [];
  const byId = new Map();
  payload.ads.forEach((raw, index) => {
    const r = normalizeMinerAd(raw);
    if (r.error) return rejected.push({ index, error: r.error });
    const prev = byId.get(r.ad.adArchiveId);
    if (prev) rejected.push({ index: prev.index, error: 'duplicate_in_batch' });
    byId.set(r.ad.adArchiveId, { index, ad: r.ad });
  });
  rejected.sort((a, b) => a.index - b.index);

  const countries = context.country ? [context.country] : [];
  const queries = context.q ? [context.q] : [];
  let inserted = 0;
  let updated = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const domains = new Set();
    for (const { ad } of byId.values()) {
      const r = await client.query(MINER_UPSERT_AD_SQL, [
        ad.adArchiveId, ad.pageId, ad.pageName, ad.isActive, String(ad.startDate), ad.endDate === null ? null : String(ad.endDate),
        ad.collationId, ad.collationCount, JSON.stringify(ad.platforms), ad.displayFormat,
        ad.body, ad.title, ad.caption, ad.ctaText, ad.linkUrl, ad.landingDomain, JSON.stringify(ad.media),
        countries, queries
      ]);
      if (r.rows[0].inserted) inserted++; else updated++;
      if (ad.landingDomain) domains.add(ad.landingDomain);
    }
    if (byId.size > 0) {
      // Contribuicoes por utilizador (SaaS): um upsert so para o lote inteiro.
      await client.query(
        `INSERT INTO miner_ad_sources (ad_archive_id, submitter_id, first_submitted_at, last_submitted_at, times_seen)
         SELECT UNNEST($1::text[]), $2, NOW(), NOW(), 1
         ON CONFLICT (ad_archive_id, submitter_id) DO UPDATE SET
           last_submitted_at = NOW(), times_seen = miner_ad_sources.times_seen + 1`,
        [Array.from(byId.keys()), submitterId]
      );
    }
    if (domains.size > 0) await client.query(MINER_SNAPSHOT_SQL, [Array.from(domains)]);
    await client.query(
      `INSERT INTO miner_ingest_batches (submitter_id, ext_version, received, inserted, updated, rejected, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [submitterId, extVersion, payload.ads.length, inserted, updated, rejected.length, JSON.stringify(context)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return sendJson(res, 200, { ok: true, received: payload.ads.length, inserted, updated, rejected });
}

/** Escapa % _ e \ para uso em ILIKE. */
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** Inteiro em [min, max] vindo da query string; ausente -> padrao; invalido -> null. */
function parseIntParam(value, def, min, max) {
  if (value === null || value === '') return def;
  if (!/^[0-9]{1,9}$/.test(value)) return null;
  const n = parseInt(value, 10);
  return n >= min && n <= max ? n : null;
}

async function handleMinerOffers(req, res, searchParams) {
  if (!getRequestUserId(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  const q = (searchParams.get('q') || '').trim().slice(0, 200);
  const minAds = parseIntParam(searchParams.get('minAds'), 0, 0, 100000);
  const minDays = parseIntParam(searchParams.get('minDays'), 0, 0, 100000);
  const limit = parseIntParam(searchParams.get('limit'), MINER_DEFAULT_LIMIT, 1, MINER_MAX_LIMIT);
  const offset = parseIntParam(searchParams.get('offset'), 0, 0, 1000000);
  const countryRaw = (searchParams.get('country') || '').trim();
  const mediaType = (searchParams.get('mediaType') || 'ALL').toUpperCase();
  const sortKey = searchParams.get('sort') || 'score';
  if (minAds === null) return sendJson(res, 400, { ok: false, error: 'invalid_min_ads' });
  if (minDays === null) return sendJson(res, 400, { ok: false, error: 'invalid_min_days' });
  if (limit === null) return sendJson(res, 400, { ok: false, error: 'invalid_limit' });
  if (offset === null) return sendJson(res, 400, { ok: false, error: 'invalid_offset' });
  if (countryRaw && !/^[A-Za-z]{2,3}$/.test(countryRaw)) return sendJson(res, 400, { ok: false, error: 'invalid_country' });
  if (!['ALL', 'IMAGE', 'VIDEO'].includes(mediaType)) return sendJson(res, 400, { ok: false, error: 'invalid_media_type' });
  if (!Object.prototype.hasOwnProperty.call(MINER_SORTS, sortKey)) return sendJson(res, 400, { ok: false, error: 'invalid_sort' });

  // Filtros por anuncio (todos parametrizados). Base: ativos, com dominio, vistos nos ultimos 7 dias.
  const params = [MINER_OFFER_WINDOW_DAYS];
  const where = ['is_active', 'landing_domain IS NOT NULL', "last_seen_at >= NOW() - ($1::int * INTERVAL '1 day')"];
  if (q) {
    params.push('%' + escapeLike(q) + '%');
    const n = params.length;
    where.push(`(body ILIKE $${n} OR title ILIKE $${n} OR page_name ILIKE $${n} OR EXISTS (SELECT 1 FROM unnest(queries) AS x WHERE x ILIKE $${n}))`);
  }
  if (countryRaw) { params.push(countryRaw.toUpperCase()); where.push(`$${params.length} = ANY(countries)`); }
  if (mediaType !== 'ALL') { params.push(mediaType); where.push(`display_format = $${params.length}`); }
  const baseWhere = where.join(' AND ');

  // Pontuacao (SPEC-004): activeAds*2 + distinct*1.5 + min(dias,60)*0.5 + max(growth7d,0)*3
  params.push(MINER_SCORE_ACTIVE_WEIGHT, MINER_SCORE_DISTINCT_WEIGHT, MINER_SCORE_DAYS_WEIGHT, MINER_SCORE_DAYS_CAP, MINER_SCORE_GROWTH_WEIGHT);
  const [pA, pD, pW, pC, pG] = [1, 2, 3, 4, 5].map((i) => `$${params.length - 5 + i}::float8`);
  params.push(minAds, minDays);
  const pMinAds = `$${params.length - 1}`;
  const pMinDays = `$${params.length}`;

  // growth7d = active_ads da fotografia mais recente (hoje) - fotografia mais proxima de 7 dias atras (anterior a ela).
  const offersCte = `
    WITH agg AS (
      SELECT landing_domain,
             (ARRAY_AGG(DISTINCT page_name) FILTER (WHERE page_name <> ''))[1:10] AS page_names,
             COUNT(*)::int AS active_ads,
             COUNT(DISTINCT COALESCE(collation_id, ad_archive_id))::int AS distinct_creatives,
             GREATEST(FLOOR((EXTRACT(EPOCH FROM NOW()) - MIN(start_date)) / 86400), 0)::int AS max_days_running,
             MAX(last_seen_at) AS last_seen_at
        FROM miner_ads
       WHERE ${baseWhere}
       GROUP BY landing_domain
      HAVING COUNT(*) >= ${pMinAds}
         AND GREATEST(FLOOR((EXTRACT(EPOCH FROM NOW()) - MIN(start_date)) / 86400), 0) >= ${pMinDays}
    ), grown AS (
      SELECT a.*,
             CASE WHEN cur.day IS NULL OR base.day IS NULL THEN 0 ELSE cur.active_ads - base.active_ads END AS growth7d
        FROM agg a
        LEFT JOIN LATERAL (
          SELECT day, active_ads FROM miner_snapshots s
           WHERE s.landing_domain = a.landing_domain AND s.day <= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           ORDER BY s.day DESC LIMIT 1) cur ON TRUE
        LEFT JOIN LATERAL (
          SELECT day, active_ads FROM miner_snapshots s
           WHERE s.landing_domain = a.landing_domain AND s.day < cur.day
           ORDER BY ABS(s.day - ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 7)), s.day DESC LIMIT 1) base ON TRUE
    ), offers AS (
      SELECT g.*,
             ROUND((g.active_ads * ${pA} + g.distinct_creatives * ${pD} + LEAST(g.max_days_running, ${pC}) * ${pW}
                    + GREATEST(g.growth7d, 0) * ${pG})::numeric, 2)::float8 AS score
        FROM grown g
    )`;
  const orderBy = `${MINER_SORTS[sortKey]} DESC, landing_domain ASC`;

  const [pageRes, countRes] = await Promise.all([
    pool.query(`${offersCte} SELECT * FROM offers ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params),
    pool.query(`${offersCte} SELECT COUNT(*)::int AS total FROM offers`, params)
  ]);

  // Ate 3 anuncios de amostra por dominio da pagina (mesmos filtros): mais repetidos primeiro, depois os mais antigos.
  const domains = pageRes.rows.map((r) => r.landing_domain);
  const samplesByDomain = new Map();
  if (domains.length) {
    const sampleParams = params.slice(0, params.length - 7);
    sampleParams.push(domains);
    const samples = await pool.query(
      `SELECT * FROM (
         SELECT ad_archive_id, title, body, display_format, link_url, start_date, landing_domain,
                COALESCE(media->'images'->>0, media->'videos'->0->>'preview') AS image,
                ROW_NUMBER() OVER (PARTITION BY landing_domain ORDER BY collation_count DESC, start_date ASC, ad_archive_id) AS rn
           FROM miner_ads
          WHERE ${baseWhere} AND landing_domain = ANY($${sampleParams.length})
       ) t WHERE rn <= ${MINER_SAMPLE_ADS}
       ORDER BY landing_domain, rn`,
      sampleParams
    );
    for (const s of samples.rows) {
      if (!samplesByDomain.has(s.landing_domain)) samplesByDomain.set(s.landing_domain, []);
      samplesByDomain.get(s.landing_domain).push({
        adArchiveId: s.ad_archive_id, title: s.title, body: s.body.slice(0, 500), displayFormat: s.display_format,
        image: s.image || null, linkUrl: s.link_url, startDate: Number(s.start_date)
      });
    }
  }

  const offers = pageRes.rows.map((r) => ({
    domain: r.landing_domain,
    pageNames: r.page_names || [],
    activeAds: r.active_ads,
    distinctCreatives: r.distinct_creatives,
    maxDaysRunning: r.max_days_running,
    growth7d: r.growth7d,
    score: r.score,
    lastSeenAt: r.last_seen_at,
    sampleAds: samplesByDomain.get(r.landing_domain) || []
  }));
  return sendJson(res, 200, { ok: true, total: countRes.rows[0].total, offers });
}

function minerAdToJson(r) {
  const media = r.media || {};
  return {
    adArchiveId: r.ad_archive_id, pageId: r.page_id, pageName: r.page_name, isActive: r.is_active,
    startDate: Number(r.start_date), endDate: r.end_date === null ? null : Number(r.end_date),
    collationId: r.collation_id, collationCount: r.collation_count, platforms: r.platforms || [],
    displayFormat: r.display_format, body: r.body, title: r.title, caption: r.caption, ctaText: r.cta_text,
    linkUrl: r.link_url, landingDomain: r.landing_domain, images: media.images || [], videos: media.videos || [],
    countries: r.countries, queries: r.queries, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at
  };
}

async function handleMinerOfferDetail(req, res, rawDomain) {
  if (!getRequestUserId(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  let domain;
  try { domain = decodeURIComponent(rawDomain).toLowerCase(); } catch (e) { domain = ''; }
  if (!HOSTNAME_REGEX.test(domain)) return sendJson(res, 400, { ok: false, error: 'invalid_domain' });

  const ads = await pool.query(
    `SELECT * FROM miner_ads WHERE landing_domain = $1
      ORDER BY is_active DESC, start_date ASC, ad_archive_id LIMIT ${MINER_DETAIL_MAX_ADS}`, [domain]);
  if (ads.rows.length === 0) return sendJson(res, 404, { ok: false, error: 'not_found' });
  const snaps = await pool.query(
    `SELECT TO_CHAR(day, 'YYYY-MM-DD') AS day, active_ads, distinct_creatives
       FROM miner_snapshots
      WHERE landing_domain = $1 AND day >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - ${MINER_SNAPSHOT_DAYS - 1}
      ORDER BY day ASC`, [domain]);
  return sendJson(res, 200, {
    ok: true,
    domain,
    ads: ads.rows.map(minerAdToJson),
    snapshots: snaps.rows.map((s) => ({ day: s.day, activeAds: s.active_ads, distinctCreatives: s.distinct_creatives }))
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function handleApi(req, res, pathname, searchParams) {
  const method = req.method;
  if (pathname === '/api/status' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      driver: 'postgresql',
      dbConnected: isDbConnected,
      authRequired: !!APP_TOKEN,
      aiConfigured: !!GEMINI_API_KEY && !!APP_TOKEN,
      message: isDbConnected ? 'PostgreSQL conectado' : 'Banco indisponivel ou nao configurado'
    });
  }

  // Rota de IA: faz as proprias checagens e nao depende do banco.
  if (pathname === '/api/ai/generate') return handleAiGenerate(req, res);
  // Minerador grava dados globais: sem APP_TOKEN no servidor a API nao fica aberta (mesmo padrao do /api/ai/*).
  if (pathname.startsWith('/api/miner/') && !APP_TOKEN) return sendJson(res, 503, { ok: false, error: 'miner_requires_app_token' });

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }

  const needsDb = pathname === '/api/projects' || pathname.startsWith('/api/projects/') || pathname === '/api/state' || pathname.startsWith('/api/miner/');
  if (needsDb && (!isDbConnected || !pool)) {
    return sendJson(res, 503, { ok: false, error: 'db_offline' });
  }

  try {
    // ---- /api/projects ----
    if (pathname === '/api/projects') {
      if (method === 'GET') {
        const result = await pool.query('SELECT id, name, niche, data, client_updated_at, deleted_at FROM projects ORDER BY updated_at DESC');
        const projects = [];
        const tombstones = [];
        for (const row of result.rows) {
          if (row.deleted_at) {
            tombstones.push({ id: row.id, deletedAt: new Date(row.deleted_at).getTime() });
          } else {
            projects.push({ ...(row.data || {}), id: row.id, name: row.name, niche: row.niche, updatedAt: Number(row.client_updated_at) });
          }
        }
        return sendJson(res, 200, { ok: true, projects, tombstones });
      }
      if (method === 'POST') {
        const payload = await readJsonBody(req);
        const list = Array.isArray(payload.projects) ? payload.projects : [payload];
        const normalized = list.map(normalizeProject);
        if (normalized.length === 0 || normalized.some((p) => p === null)) {
          return sendJson(res, 400, { ok: false, error: 'Projeto invalido: id (A-Z, 0-9, _ . -) e name sao obrigatorios.' });
        }
        const client = await pool.connect();
        let saved = 0;
        const skipped = [];
        try {
          await client.query('BEGIN');
          const notApplied = [];
          for (const p of normalized) {
            const r = await client.query(UPSERT_PROJECT_SQL, [p.id, p.name, p.niche, JSON.stringify(p.extra), String(p.updatedAt)]);
            if (r.rowCount > 0) saved++; else notApplied.push(p.id);
          }
          if (notApplied.length) {
            // Classifica os nao aplicados: tombstone ('deleted') ou versao antiga ('stale')
            const cls = await client.query('SELECT id, deleted_at, client_updated_at FROM projects WHERE id = ANY($1)', [notApplied]);
            const byId = new Map(cls.rows.map((row) => [row.id, row]));
            for (const id of notApplied) {
              const row = byId.get(id);
              if (row && row.deleted_at) skipped.push({ id, reason: 'deleted' });
              else skipped.push({ id, reason: 'stale', serverUpdatedAt: row ? Number(row.client_updated_at) : 0 });
            }
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
        return sendJson(res, 200, { ok: true, saved, skipped });
      }
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    // ---- /api/projects/:id ----
    if (pathname.startsWith('/api/projects/')) {
      const id = decodeURIComponent(pathname.slice('/api/projects/'.length));
      if (!ID_REGEX.test(id)) return sendJson(res, 400, { ok: false, error: 'id invalido' });
      if (method === 'DELETE') {
        // Soft delete: statement unico (atomico), idempotente
        const del = await pool.query(DELETE_PROJECT_SQL, [id, String(Date.now())]);
        return sendJson(res, 200, { ok: true, deleted: id, deletedAt: new Date(del.rows[0].deleted_at).getTime() });
      }
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    // ---- /api/state ----
    if (pathname === '/api/state') {
      if (method === 'GET') {
        const result = await pool.query("SELECT value FROM app_state WHERE key = 'global_state' LIMIT 1");
        return sendJson(res, 200, { ok: true, state: result.rows.length ? sanitizeState(result.rows[0].value) : null });
      }
      if (method === 'POST') {
        const payload = sanitizeState(await readJsonBody(req));
        await pool.query(
          `INSERT INTO app_state (key, value, updated_at) VALUES ('global_state', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(payload)]
        );
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    // ---- /api/miner/* ----
    if (pathname === '/api/miner/ingest') return await handleMinerIngest(req, res);
    if (pathname === '/api/miner/offers') return await handleMinerOffers(req, res, searchParams);
    if (pathname.startsWith('/api/miner/offers/')) return await handleMinerOfferDetail(req, res, pathname.slice('/api/miner/offers/'.length));

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    if (err.status) return sendJson(res, err.status, { ok: false, error: err.message });
    console.error('[API] Erro:', err.message);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}

// ---------------------------------------------------------------------------
// Arquivos estaticos (somente allowlist: nunca expoe server.js, package.json etc.)
// ---------------------------------------------------------------------------
function resolveStaticPath(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch (e) {
    return null;
  }
  if (p.includes('\0')) return null;

  if (p === '/' || p === '/index.html' || p === '/app' || p === '/app/') return path.join(ROOT, 'index.html');
  if (p === '/logo.jpg') return path.join(ROOT, 'logo.jpg');

  if (p === '/pagina-vendas' || p === '/pagina-vendas/') return path.join(ROOT, 'pagina-vendas', 'index.html');
  if (p.startsWith('/pagina-vendas/')) {
    const base = path.join(ROOT, 'pagina-vendas');
    const full = path.normalize(path.join(ROOT, p));
    const ext = path.extname(full).toLowerCase();
    if (full.startsWith(base + path.sep) && MIME_TYPES[ext]) return full;
  }
  return null;
}

const fileCache = new Map(); // filePath -> { mtimeMs, raw, gzip }

function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nao encontrado');
  }
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nao encontrado');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    };

    const cached = fileCache.get(filePath);
    const send = (entry) => {
      const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (entry.gzip && acceptsGzip) {
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': entry.gzip.length });
        return res.end(entry.gzip);
      }
      res.writeHead(200, { ...headers, Vary: 'Accept-Encoding', 'Content-Length': entry.raw.length });
      res.end(entry.raw);
    };

    if (cached && cached.mtimeMs === stat.mtimeMs) return send(cached);

    fs.readFile(filePath, (readErr, raw) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Erro ao ler arquivo');
      }
      const entry = { mtimeMs: stat.mtimeMs, raw, gzip: COMPRESSIBLE.has(ext) ? zlib.gzipSync(raw) : null };
      fileCache.set(filePath, entry);
      send(entry);
    });
  });
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }

  if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

  // Telemetria de erros do navegador (window.onerror). Somente log, sem armazenar.
  if (pathname === '/log_error') {
    try {
      const q = new URL(req.url, 'http://localhost').searchParams.get('error') || '';
      console.warn('[Browser]', q.slice(0, 500));
    } catch (e) { /* ignora */ }
    res.writeHead(204);
    return res.end();
  }

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname, new URL(req.url, 'http://localhost').searchParams);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  return serveStatic(req, res, pathname);
});

server.keepAliveTimeout = 65000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Cockpit Low Ticket] HTTP na porta ${PORT} | PostgreSQL: ${pool ? 'conectando...' : 'desativado'} | Auth: ${APP_TOKEN ? 'ativa' : 'ABERTA'}`);
});

// Encerramento limpo (docker stop / redeploy do Easypanel)
function shutdown(signal) {
  console.log(`[Cockpit Low Ticket] ${signal} recebido, encerrando...`);
  clearTimeout(reconnectTimer);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    try { if (pool) await pool.end(); } catch (e) { /* ignora */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err && err.message ? err.message : err));
