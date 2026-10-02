const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
let pg = null;
try {
  pg = require('pg');
} catch (e) {
  console.log('[PostgreSQL] Modulo pg nao carregado localmente, operando em modo estatico.');
}

const PORT = parseInt(process.env.PORT, 10) || 80;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

let pool = null;
let isDbConnected = false;
let dbErrorMsg = '';

// Inicialização do Pool PostgreSQL
if (pg && DATABASE_URL) {
  try {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' && !DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Erro inesperado no pool de conexoes:', err.message);
      isDbConnected = false;
      dbErrorMsg = err.message;
    });

    initDatabase();
  } catch (err) {
    console.error('[PostgreSQL] Erro ao instanciar Pool:', err.message);
    dbErrorMsg = err.message;
  }
} else {
  dbErrorMsg = 'Variavel de ambiente DATABASE_URL nao configurada.';
  console.log('[PostgreSQL] DATABASE_URL nao detectada. Servidor operando com fallback local.');
}

async function initDatabase() {
  if (!pool) return;
  try {
    const client = await pool.connect();
    try {
      console.log('[PostgreSQL] Conexao estabelecida com sucesso!');
      isDbConnected = true;
      dbErrorMsg = '';

      // Criação das tabelas com colunas JSONB para máxima flexibilidade
      await client.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id VARCHAR(100) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          niche VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          data JSONB DEFAULT '{}'::jsonb
        );

        CREATE TABLE IF NOT EXISTS app_state (
          key VARCHAR(50) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      console.log('[PostgreSQL] Tabelas verificadas e prontas para uso (projects, app_state).');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[PostgreSQL] Falha ao conectar/inicializar banco:', err.message);
    isDbConnected = false;
    dbErrorMsg = err.message;
  }
}

// MIME types suportados
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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Suporte a CORS pre-flight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // ================= ROTAS DE API DO POSTGRESQL =================
  if (pathname === '/api/status') {
    return sendJson(res, 200, {
      ok: true,
      dbConnected: isDbConnected,
      driver: 'postgresql',
      message: isDbConnected ? 'PostgreSQL conectado e operacional' : (dbErrorMsg || 'Aguardando configuracao de DATABASE_URL')
    });
  }

  if (pathname === '/api/projects') {
    if (method === 'GET') {
      if (!isDbConnected || !pool) {
        return sendJson(res, 200, { ok: true, source: 'fallback_offline', projects: [] });
      }
      try {
        const result = await pool.query('SELECT id, name, niche, data, updated_at FROM projects ORDER BY updated_at DESC');
        const projects = result.rows.map(row => ({
          id: row.id,
          name: row.name,
          niche: row.niche,
          ...(row.data || {})
        }));
        return sendJson(res, 200, { ok: true, source: 'postgresql', projects });
      } catch (err) {
        console.error('[API] Erro ao listar projetos:', err.message);
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (method === 'POST') {
      try {
        const payload = await parseJsonBody(req);
        if (!isDbConnected || !pool) {
          return sendJson(res, 200, { ok: true, source: 'fallback_offline', message: 'Salvo localmente (PostgreSQL offline)' });
        }
        const { id, name, niche, ...extraData } = payload;
        if (!id || !name) {
          return sendJson(res, 400, { ok: false, error: 'Campos id e name sao obrigatorios.' });
        }

        await pool.query(`
          INSERT INTO projects (id, name, niche, data, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            niche = EXCLUDED.niche,
            data = EXCLUDED.data,
            updated_at = NOW();
        `, [id, name, niche || '', extraData]);

        return sendJson(res, 200, { ok: true, source: 'postgresql', id });
      } catch (err) {
        console.error('[API] Erro ao salvar projeto:', err.message);
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }
  }

  if (pathname.startsWith('/api/projects/') && method === 'DELETE') {
    const projId = pathname.replace('/api/projects/', '').trim();
    if (!isDbConnected || !pool) {
      return sendJson(res, 200, { ok: true, source: 'fallback_offline' });
    }
    try {
      await pool.query('DELETE FROM projects WHERE id = $1', [projId]);
      return sendJson(res, 200, { ok: true, deleted: projId });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/api/state') {
    if (method === 'GET') {
      if (!isDbConnected || !pool) {
        return sendJson(res, 200, { ok: true, source: 'fallback_offline', state: null });
      }
      try {
        const result = await pool.query("SELECT value FROM app_state WHERE key = 'global_state' LIMIT 1");
        const state = result.rows.length > 0 ? result.rows[0].value : null;
        return sendJson(res, 200, { ok: true, source: 'postgresql', state });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (method === 'POST') {
      try {
        const payload = await parseJsonBody(req);
        if (!isDbConnected || !pool) {
          return sendJson(res, 200, { ok: true, source: 'fallback_offline' });
        }
        await pool.query(`
          INSERT INTO app_state (key, value, updated_at)
          VALUES ('global_state', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = NOW();
        `, [payload]);
        return sendJson(res, 200, { ok: true, source: 'postgresql' });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }
  }

  // ================= ARQUIVOS ESTÁTICOS DO APP =================
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Fallback se procurar direto ou dentro de app/
  if (!fs.existsSync(filePath)) {
    const altPath = path.join(__dirname, 'app', pathname);
    if (fs.existsSync(altPath)) {
      filePath = altPath;
    } else {
      filePath = path.join(__dirname, 'index.html');
    }
  }

  if (fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Arquivo nao encontrado.');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Cockpit Low Ticket] Servidor HTTP rodando na porta ${PORT}`);
  console.log(`[Cockpit Low Ticket] Status do PostgreSQL: ${isDbConnected ? 'CONECTADO' : 'AGUARDANDO DATABASE_URL'}`);
});
