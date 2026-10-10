'use strict';
// Auth Bearer APP_TOKEN (uso proprio). Comparacao de hashes em tempo constante.
const crypto = require('crypto');
const cfg = require('./config');

const wantHash = cfg.APP_TOKEN ? crypto.createHash('sha256').update(cfg.APP_TOKEN).digest() : null;

/** 'ok' | 'no_token' (APP_TOKEN nao definido -> 503) | 'denied' (-> 401). */
function checkAuth(req) {
  if (!wantHash) return 'no_token';
  const header = req.headers['authorization'] || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided) return 'denied';
  const got = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(got, wantHash) ? 'ok' : 'denied';
}

module.exports = { checkAuth };
