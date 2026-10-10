'use strict';
// Checkouts achados na pagina de venda (BE-017, AC-03): TODOS os links de plataformas de infoproduto, com plataforma e id do produto.
// A URL e normalizada (host sem www, caminho sem barra final, sem query nem ancora) para virar a chave de spy.checkouts.
// Encurtadores (go.hotmart.com, hotm.art, go.perfectpay...) tem UM nivel de redirecionamento resolvido com o lookup seguro.
const { CHECKOUT_PATTERNS, INFO_PLATFORMS } = require('../lib/nonoffer');

const MAX_PER_PAGE = 10;
const MAX_RESOLVE = 5;
// hosts que costumam ser so um redirecionador para o checkout de verdade
const SHORT_HOSTS = [/^go\./, /^hotm\.art$/, /^kiwify\.app$/, /^link\./, /^l\./];

function platformOfHost(host) {
  for (const [id, suffixes] of Object.entries(CHECKOUT_PATTERNS)) {
    if (!INFO_PLATFORMS.includes(id)) continue; // so plataformas de infoproduto (shopify e yampi nao entram no ranking de checkouts)
    if (suffixes.some((s) => host === s || host.endsWith('.' + s))) return id;
  }
  return null;
}

/** Id do produto a partir do caminho, por plataforma; sem regra clara usa o ultimo trecho do caminho. */
function productIdOf(platform, host, segs) {
  if (!segs.length) return null;
  const ok = (v) => (v && v.length <= 100 ? v : null);
  if (platform === 'perfectpay' && segs[0] === 'pay') return ok(segs[1]);
  if (platform === 'monetizze' && (segs[0] === 'checkout' || segs[0] === 'r' || segs[0] === 'pay')) return ok(segs[1]);
  return ok(segs[0]) || ok(segs[segs.length - 1]);
}

/** {url, platform, productId} normalizado, ou null se o link nao e de checkout de infoproduto. */
function normalizeCheckout(str) {
  let u;
  try { u = new URL(str); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const platform = platformOfHost(host);
  if (!platform) return null;
  const segs = u.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x));
  if (!segs.length) return null; // a home da plataforma nao e um checkout
  const pathname = '/' + segs.join('/');
  return { url: (host + pathname).slice(0, 500), platform, productId: productIdOf(platform, host, segs), host };
}

const isShort = (host) => SHORT_HOSTS.some((re) => re.test(host));

/**
 * Todos os checkouts da pagina (ate 10, sem repetir). opts.resolver so serve nos testes (DNS simulado).
 * Encurtadores resolvem um nivel: se o destino for um checkout conhecido, vale o destino.
 */
async function extractCheckouts(finalUrl, hrefs, srcs, opts) {
  const { resolveRedirect } = require('./landing'); // carregado aqui: landing.js importa este arquivo
  const out = new Map();
  let resolved = 0;
  for (const link of [finalUrl].concat(hrefs || [], srcs || [])) {
    if (out.size >= MAX_PER_PAGE) break;
    let c = normalizeCheckout(link);
    if (!c) continue;
    if (isShort(c.host) && resolved < MAX_RESOLVE) {
      resolved++;
      const dest = await resolveRedirect(link, opts);
      const d = dest ? normalizeCheckout(dest) : null;
      if (d) c = d;
    }
    if (!out.has(c.url)) out.set(c.url, { url: c.url, platform: c.platform, productId: c.productId });
  }
  return Array.from(out.values());
}

module.exports = { extractCheckouts, normalizeCheckout };
