'use strict';
// Estaticos de web/dist com fallback de SPA. Sem web/dist, uma pagina simples manda rodar o build.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const DIST = cfg.WEB_DIST ? path.resolve(cfg.WEB_DIST) : path.join(__dirname, '..', 'web', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const NO_BUILD_HTML = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Minerador v2</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">'
  + '<h1>Minerador v2</h1><p>A interface ainda nao foi gerada. Rode <code>npm ci &amp;&amp; npm run build</code> dentro de <code>web/</code> e reinicie o servidor.</p>'
  + '<p>A API ja responde em <code>/api/v2/status</code>.</p></body></html>';

function send(res, req, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

/** Serve um arquivo de web/dist ou, para rota sem extensao (SPA), o index.html. Retorna depois de responder. */
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : NO_BUILD_HTML);
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { rel = '/'; }
  if (rel.includes('\0')) rel = '/';
  const file = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return send(res, req, index, 'no-cache'); // tentativa de sair de dist
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return send(res, req, file, /\/assets\//.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (path.extname(rel)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); } // asset inexistente nao vira index.html
    return send(res, req, index, 'no-cache'); // rota do app (SPA)
  });
}

module.exports = { serveStatic, DIST };
