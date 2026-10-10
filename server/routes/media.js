'use strict';
// GET /api/v2/media/:id/:kind/:index - download em streaming. O URL vem do banco (o cliente nunca envia), host na whitelist da Meta,
// lookup seguro e revalidacao de cada redirecionamento (copiado e adaptado do ADR-002 M7 / BE-005 da v1).
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { pipeline, Transform } = require('stream');
const cfg = require('../config');
const { sendJson, sendError, invalidParam } = require('../lib/http');
const { makeSafeLookup, netError } = require('../lib/net-safe');

const HOST_SUFFIXES = ['fbcdn.net', 'cdninstagram.com', 'facebook.com'];
const EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'
};
const HOSTMAP = cfg.MEDIA_TEST_HOSTMAP;
const RESOLVER = HOSTMAP
  ? (host, opts, cb) => {
    const ip = Object.prototype.hasOwnProperty.call(HOSTMAP, host) ? String(HOSTMAP[host]) : null;
    if (ip) return cb(null, [{ address: ip, family: net.isIPv6(ip) ? 6 : 4 }]);
    return dns.lookup(host, opts, cb);
  }
  : undefined;
let active = 0;

/** URL de midia aceita (https, host na whitelist da Meta, sem credenciais/IP literal) ou null. */
function mediaUrl(str) {
  let u;
  try { u = new URL(str); } catch (e) { return null; }
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || net.isIP(host.replace(/^\[|\]$/g, ''))) return null;
  if (!HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s))) return null;
  const mapped = !!HOSTMAP && Object.prototype.hasOwnProperty.call(HOSTMAP, host);
  if (u.protocol !== 'https:' && !(mapped && u.protocol === 'http:')) return null;
  if (u.port && u.port !== '443' && !mapped) return null;
  return u;
}

function requestOnce(u, ctx) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    let req;
    try {
      req = lib.request({
        protocol: u.protocol, hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined, path: u.pathname + u.search,
        method: 'GET', agent: false, lookup: makeSafeLookup(RESOLVER),
        headers: { 'User-Agent': cfg.USER_AGENT, 'Accept': 'image/*,video/*;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity', 'Connection': 'close' }
      }, (res) => resolve(res));
    } catch (e) { return reject(netError('media_upstream_error')); }
    ctx.req = req;
    req.on('error', (e) => reject(netError('media_upstream_error', { ssrf: !!(e && e.code === 'SSRF_BLOCKED') })));
    req.end();
  });
}

/** Abre a midia seguindo ate MEDIA_MAX_REDIRECTS redirects, revalidando whitelist e IP em CADA salto. */
async function openMedia(startUrl, ctx) {
  let u = startUrl;
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(u, ctx);
    const st = res.statusCode;
    if (st >= 300 && st < 400) {
      res.destroy();
      if (hop >= cfg.MEDIA_MAX_REDIRECTS || !res.headers.location) throw netError('media_upstream_error');
      let next;
      try { next = new URL(String(res.headers.location), u).href; } catch (e) { throw netError('media_upstream_error'); }
      u = mediaUrl(next);
      if (!u) throw netError('media_upstream_error', { redirectBlocked: true });
      continue;
    }
    if (st === 403 || st === 404 || st === 410) { res.destroy(); throw netError('media_expired'); }
    if (st < 200 || st >= 300) { res.destroy(); throw netError('media_upstream_error'); }
    return { res, url: u };
  }
}

async function handleMedia(ctx, req, res, adId, kind, idxRaw) {
  if (!/^[0-9]{1,30}$/.test(adId)) return sendError(res, 404, 'not_found');
  if (kind !== 'image' && kind !== 'video') return invalidParam(res, 'kind');
  if (!/^[0-9]{1,3}$/.test(idxRaw)) return invalidParam(res, 'index');
  const index = parseInt(idxRaw, 10);
  const row = await ctx.pool.query('SELECT media FROM spy.ads WHERE ad_archive_id = $1', [adId]);
  if (!row.rows.length) return sendError(res, 404, 'not_found');
  const media = row.rows[0].media || {};
  const list = kind === 'image' ? media.images : media.videos;
  const target = Array.isArray(list) ? list[index] : undefined;
  const urlStr = kind === 'image' ? target : (target && typeof target === 'object' ? (target.hd || target.sd) : null);
  if (typeof urlStr !== 'string' || !urlStr) return sendError(res, 404, 'media_not_found');
  const startUrl = mediaUrl(urlStr);
  if (!startUrl) return sendError(res, 400, 'media_host_not_allowed');
  if (active >= cfg.MEDIA_MAX_CONCURRENT) return sendError(res, 429, 'too_many_downloads');

  active++;
  const c = { req: null, up: null };
  let finished = false;
  const kill = () => { try { if (c.up) c.up.destroy(); } catch (e) { /* ignora */ } try { if (c.req) c.req.destroy(); } catch (e) { /* ignora */ } };
  const done = () => { if (!finished) { finished = true; active--; clearTimeout(timer); } };
  const timer = setTimeout(() => { kill(); if (!res.headersSent) sendError(res, 502, 'media_upstream_error'); else res.destroy(); done(); }, cfg.MEDIA_TIMEOUT_MS);
  res.on('close', () => { kill(); done(); });
  let opened;
  try {
    opened = await openMedia(startUrl, c);
  } catch (err) {
    kill(); done();
    if (res.headersSent || res.writableEnded) return;
    if (err && err.errCode === 'media_expired') return sendError(res, 410, 'media_expired');
    return sendError(res, 502, 'media_upstream_error');
  }
  const up = opened.res;
  c.up = up;
  const ct = String(up.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!/^(image|video)\/[a-z0-9.+-]+$/.test(ct)) { kill(); done(); return sendError(res, 502, 'media_upstream_error'); }
  const len = up.headers['content-length'] !== undefined ? Number(up.headers['content-length']) : NaN;
  if (Number.isFinite(len) && len > cfg.MEDIA_MAX_BYTES) { kill(); done(); return sendError(res, 413, 'media_too_large'); }
  const pathExt = /\.([a-z0-9]{2,5})$/i.exec(opened.url.pathname);
  const ext = EXT[ct] || (pathExt ? pathExt[1].toLowerCase() : (kind === 'image' ? 'jpg' : 'mp4'));
  const headers = {
    'Content-Type': ct, 'Content-Disposition': `attachment; filename="anuncio-${adId}-${kind}${index}.${ext}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  };
  if (Number.isFinite(len) && len >= 0) headers['Content-Length'] = String(len);
  res.writeHead(200, headers);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, enc, cb) {
      bytes += chunk.length;
      if (bytes > cfg.MEDIA_MAX_BYTES) return cb(netError('media_too_large'));
      cb(null, chunk);
    }
  });
  pipeline(up, counter, res, (err) => { if (err) { kill(); res.destroy(); } done(); });
}

module.exports = { handleMedia, mediaUrl };
