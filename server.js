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
      -- Backfill idempotente: linhas legadas herdam a versao de data.updatedAt (so inteiro valido, so onde ainda e 0, sem tombstones)
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
// API
// ---------------------------------------------------------------------------
async function handleApi(req, res, pathname) {
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

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }

  const needsDb = pathname === '/api/projects' || pathname.startsWith('/api/projects/') || pathname === '/api/state';
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

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);

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
