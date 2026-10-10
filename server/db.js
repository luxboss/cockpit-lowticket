'use strict';
// Pool do Postgres (so pg). Cada processo (site e worker) cria o seu.
const cfg = require('./config');

let pg = null;
try { pg = require('pg'); } catch (e) { pg = null; }

function stripSslMode(url) {
  return url.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
}

/** Cria o pool. ssl so quando a URL pede (sslmode=require...). */
function createPool(max) {
  if (!pg) throw new Error('modulo pg ausente');
  if (!cfg.DATABASE_URL) throw new Error('DATABASE_URL nao configurada');
  // mesma regra da v1: SSL se a URL pedir (sslmode) ou PGSSL=true; o certificado so e validado com PGSSL_REJECT_UNAUTHORIZED=true
  const wantsSsl = /sslmode=(require|verify-ca|verify-full)/i.test(cfg.DATABASE_URL) || String(process.env.PGSSL || '').toLowerCase() === 'true';
  const pool = new pg.Pool({
    connectionString: stripSslMode(cfg.DATABASE_URL),
    max: max || 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    ssl: wantsSsl ? { rejectUnauthorized: String(process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' } : undefined
  });
  pool.on('error', (e) => console.error('[db] erro no pool:', e && e.message));
  return pool;
}

/** Dia corrente em America/Sao_Paulo (usado nas cotas e snapshots). */
const SP_TODAY_SQL = "(NOW() AT TIME ZONE 'America/Sao_Paulo')::date";

module.exports = { createPool, SP_TODAY_SQL };
