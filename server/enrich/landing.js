'use strict';
// Busca e leitura da landing page (copiado e adaptado da v1/BE-005/BE-011): GET seguro com revalidacao de cada salto,
// titulo, texto visivel, checkout e preco minimo. Sem dependencias.
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const cfg = require('../config');
const { validateOutboundUrl, makeSafeLookup, netError } = require('../lib/net-safe');
const { decodeHtmlEntities } = require('../lib/text');
const { CHECKOUT_PATTERNS } = require('../lib/nonoffer');

const PRICE_MIN = 1;
const PRICE_MAX = 10000;
const PRICES_MAX = 10;

// Educacao com o host: 1 pedido por host a cada ENRICH_HOST_INTERVAL_MS (reserva o proximo horario).
const hostNext = new Map();
async function hostThrottle(key) {
  const now = Date.now();
  const at = Math.max(now, hostNext.get(key) || 0);
  hostNext.set(key, at + cfg.ENRICH_HOST_INTERVAL_MS);
  if (hostNext.size > 2000) for (const [k, v] of hostNext) if (v < now) hostNext.delete(k);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return at - now;
}

/** Um GET (sem seguir redirecionamento). Resolve {redirect,status} ou {status,body}; rejeita com errCode. */
function requestOnce(u, timeoutMs, resolver) {
  return new Promise((resolve, reject) => {
    let done = false;
    let req = null;
    const timer = setTimeout(() => { if (req) req.destroy(); finish(reject, netError('timeout')); }, timeoutMs);
    function finish(fn, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const hasBrotli = typeof zlib.createBrotliDecompress === 'function';
    try {
      req = lib.request({
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'GET',
        agent: false,
        lookup: makeSafeLookup(resolver),
        headers: {
          'User-Agent': cfg.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'Accept-Encoding': hasBrotli ? 'gzip, deflate, br' : 'gzip, deflate',
          'Connection': 'close'
        }
      }, (res) => {
        const status = res.statusCode;
        if (status >= 300 && status < 400) {
          res.destroy();
          const loc = res.headers.location;
          return loc ? finish(resolve, { redirect: String(loc), status }) : finish(reject, netError('bad_redirect', { httpStatus: status }));
        }
        if (status >= 400 || status < 200) { res.destroy(); return finish(reject, netError('http_' + status, { httpStatus: status })); }
        if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(String(res.headers['content-type'] || ''))) {
          res.destroy();
          return finish(reject, netError('not_html', { httpStatus: status }));
        }
        const enc = String(res.headers['content-encoding'] || 'identity').toLowerCase();
        let stream = res;
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br' && hasBrotli) stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc !== 'identity') { res.destroy(); return finish(reject, netError('unsupported_encoding', { httpStatus: status })); }
        const chunks = [];
        let size = 0;
        let raw = 0;
        const abort = (code) => { res.destroy(); if (stream !== res) stream.destroy(); finish(reject, netError(code, { httpStatus: status })); };
        res.on('data', (c) => { raw += c.length; if (raw > cfg.ENRICH_MAX_BYTES) abort('too_large'); });
        stream.on('data', (c) => {
          size += c.length;
          if (size > cfg.ENRICH_MAX_BYTES) return abort('too_large');
          chunks.push(c);
        });
        stream.on('end', () => finish(resolve, { status, body: Buffer.concat(chunks) }));
        stream.on('error', () => abort('decode_error'));
        res.on('error', () => abort('network_error'));
      });
    } catch (e) {
      return finish(reject, netError('invalid_url'));
    }
    req.on('error', (e) => finish(reject, e && e.code === 'SSRF_BLOCKED' ? netError('ssrf_blocked') : netError('network_error')));
    req.end();
  });
}

/** GET da landing seguindo ate ENRICH_MAX_REDIRECTS redirecionamentos, revalidando CADA salto (esquema, porta, IP). */
async function fetchLanding(startUrl, opts) {
  const resolver = opts && opts.resolver;
  let current = startUrl;
  let redirects = 0;
  let lastKey = null;
  let deadline = null;
  for (;;) {
    const v = validateOutboundUrl(current);
    if (!v.ok) throw netError(v.error);
    const key = v.host + ':' + (v.url.port || (v.url.protocol === 'https:' ? '443' : '80'));
    let waited = 0;
    if (key !== lastKey) waited = await hostThrottle(key);
    lastKey = key;
    if (deadline === null) deadline = Date.now() + cfg.ENRICH_TIMEOUT_MS;
    else deadline += waited;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw netError('timeout');
    const r = await requestOnce(v.url, remaining, resolver);
    if (r.redirect !== undefined) {
      if (++redirects > cfg.ENRICH_MAX_REDIRECTS) throw netError('too_many_redirects');
      try { current = new URL(r.redirect, v.url).href; } catch (e) { throw netError('invalid_url'); }
      continue;
    }
    return { finalUrl: v.url.href, status: r.status, html: r.body.toString('utf8') };
  }
}

function htmlAttr(tag, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : '';
}

/** Varredura linear do HTML: titulo, texto visivel, hrefs/actions e srcs. */
function parseLanding(html, baseUrl) {
  const lower = html.toLowerCase();
  const hrefs = [];
  const srcs = [];
  const text = [];
  let title = '';
  let gtCache = -1;
  const addLink = (list, raw) => {
    if (!raw || list.length >= 2000) return;
    try {
      const u = new URL(decodeHtmlEntities(raw.trim()), baseUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') list.push(u.href);
    } catch (e) { /* link invalido */ }
  };
  const len = html.length;
  let i = 0;
  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { text.push(html.slice(i)); break; }
    if (lt > i) text.push(html.slice(i, lt));
    if (lower.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      if (e === -1) break;
      i = e + 3;
      continue;
    }
    if (lower.charCodeAt(lt + 1) === 33 || lower.charCodeAt(lt + 1) === 63) { // <!doctype ...> e <?xml ...?>: declaracao, nao e texto
      const e = html.indexOf('>', lt);
      if (e === -1) break;
      i = e + 1;
      continue;
    }
    const m = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.substr(lt, 12));
    if (!m) { text.push('<'); i = lt + 1; continue; }
    if (gtCache < lt) { gtCache = html.indexOf('>', lt); if (gtCache === -1) break; }
    const gt = gtCache;
    const closing = m[1] === '/';
    const name = m[2];
    const raw = gt - lt <= 5000 ? html.slice(lt, gt + 1) : '';
    if (!closing && (name === 'script' || name === 'style')) {
      if (name === 'script') addLink(srcs, htmlAttr(raw, 'src'));
      const e = lower.indexOf('</' + name, gt);
      if (e === -1) break;
      const end = html.indexOf('>', e);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (!closing) {
      if (name === 'a') addLink(hrefs, htmlAttr(raw, 'href'));
      else if (name === 'form') addLink(hrefs, htmlAttr(raw, 'action'));
      else if (name === 'iframe' || name === 'img' || name === 'source' || name === 'embed') addLink(srcs, htmlAttr(raw, 'src'));
      else if (name === 'title' && !title) {
        const e = lower.indexOf('</title', gt);
        if (e !== -1) { title = html.slice(gt + 1, e); i = e; continue; }
      }
    }
    text.push(' ');
    i = gt + 1;
  }
  const pageTitle = decodeHtmlEntities(title).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, 255);
  const clean = decodeHtmlEntities(text.join('')).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
  return { pageTitle, text: clean.slice(0, cfg.LANDING_TEXT_MAX), hrefs, srcs };
}

// Parcelamento: o valor logo depois de 'Nx de', 'em ate Nx', 'N parcelas de' ou antes de '/mes' e a parcela, nao o preco.
const INSTALL_PREFIX_RES = [
  /(?:^|[^\d])(\d{1,2})\s*[x×]\s*(?:sem\s+juros\s*)?(?:de\s*)?$/i,
  /(?:^|[^\d])(\d{1,2})\s*(?:parcelas?|vezes)\s*(?:sem\s+juros\s*)?(?:fixas?\s*)?(?:de\s*)?$/i
];
const INSTALL_PREFIX_NO_N_RE = /\bparcelas?\s+(?:fixas?\s+)?(?:mensais\s+)?de\s*$/i;
const INSTALL_SUFFIX_RE = /^\s*(?:(?:\/|p\/|por|ao|a\s+cada|cada)\s*(?:m[eê]s|parcela)|mensais?)(?![a-zà-ú])/i;
function isInstallmentPrice(text, start, end) {
  const before = text.slice(Math.max(0, start - 40), start);
  for (const re of INSTALL_PREFIX_RES) {
    const m = re.exec(before);
    if (m) { const n = parseInt(m[1], 10); if (n >= 2 && n <= 24) return true; }
  }
  if (INSTALL_PREFIX_NO_N_RE.test(before)) return true;
  return INSTALL_SUFFIX_RE.test(text.slice(end, end + 24));
}

/** Precos BRL do texto visivel ('R$ 24,90', 'R$ 1.234,56', 'R$ 97'). Distintos, ordenados, ate 10. */
function extractPrices(text) {
  const re = /R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?/g;
  const set = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
    if (!(Number.isFinite(v) && v >= PRICE_MIN && v <= PRICE_MAX)) continue;
    if (isInstallmentPrice(text, m.index, m.index + m[0].length)) continue;
    set.add(v);
  }
  return Array.from(set).sort((a, b) => a - b).slice(0, PRICES_MAX);
}

function checkoutPlatformOfUrl(str) {
  let host;
  try { host = new URL(str).hostname.toLowerCase(); } catch (e) { return null; }
  for (const [id, suffixes] of Object.entries(CHECKOUT_PATTERNS)) {
    if (suffixes.some((s) => host === s || host.endsWith('.' + s))) return id;
  }
  return null;
}

/** Prioridade: host final > hrefs/actions (ordem do documento) > srcs. Nenhum -> unknown. */
function detectCheckout(finalUrl, hrefs, srcs) {
  for (const candidate of [[finalUrl], hrefs, srcs]) {
    for (const url of candidate) {
      const platform = checkoutPlatformOfUrl(url);
      if (platform) return { platform, url };
    }
  }
  return { platform: 'unknown', url: null };
}

/** Busca uma landing e devolve os campos prontos para a tabela. Lanca com errCode em falha. */
async function analyzeLanding(startUrl, opts) {
  const page = await fetchLanding(startUrl, opts);
  const parsed = parseLanding(page.html, page.finalUrl);
  const checkout = detectCheckout(page.finalUrl, parsed.hrefs, parsed.srcs);
  const prices = extractPrices(parsed.text);
  return {
    finalUrl: page.finalUrl.slice(0, 2000),
    title: parsed.pageTitle,
    text: parsed.text,
    checkoutPlatform: checkout.platform === 'unknown' ? null : checkout.platform,
    priceMin: prices.length ? prices[0] : null
  };
}

module.exports = { analyzeLanding, fetchLanding, parseLanding, extractPrices, detectCheckout };
