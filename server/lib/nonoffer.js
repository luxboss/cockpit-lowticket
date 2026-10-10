'use strict';
// Destinos que nao sao pagina de venda (redes sociais, conversa, lojas de app e marketplaces) e plataformas de infoproduto.
// Copiado da v1 (BE-011/BE-014). Lista fixa no codigo; subdominios contam.

const NON_OFFER_HOSTS = {
  social: ['instagram.com', 'facebook.com', 'fb.me', 'tiktok.com', 'youtube.com', 'youtu.be', 'linktr.ee'],
  messaging: ['m.me', 'wa.me', 'api.whatsapp.com', 'whatsapp.com', 't.me', 'telegram.me'],
  appstore: ['play.google.com', 'apps.apple.com', 'itunes.apple.com', 'apps.microsoft.com', 'appgallery.huawei.com'],
  marketplace: ['shopee.com.br', 's.shopee.com.br', 'mercadolivre.com.br', 'amazon.com.br', 'magazineluiza.com.br',
    'shein.com', 'aliexpress.com', 'temu.com', 'magalu.com', 'americanas.com.br', 'casasbahia.com.br', 'kabum.com.br', 'netshoes.com.br',
    'carrefour.com.br', 'submarino.com.br', 'shopee.com', 'mercadolivre.com', 'amazon.com']
};

/** offer | social | messaging | appstore | marketplace para o dominio de destino do anuncio. */
function destinationType(domain) {
  const d = typeof domain === 'string' ? domain.toLowerCase().replace(/\.$/, '') : '';
  if (!d) return 'offer';
  for (const [type, hosts] of Object.entries(NON_OFFER_HOSTS)) {
    if (hosts.some((h) => d === h || d.endsWith('.' + h))) return type;
  }
  return 'offer';
}

/** Expressao SQL equivalente a destinationType() para uma coluna (usada na importacao em massa). Hosts so tem [a-z0-9.-]. */
function destTypeSql(col) {
  const parts = Object.entries(NON_OFFER_HOSTS).map(([type, hosts]) => {
    const list = hosts.map((h) => "'" + h + "'").join(',');
    const likes = hosts.map((h) => "'%." + h + "'").join(',');
    return `WHEN lower(${col}) IN (${list}) OR lower(${col}) LIKE ANY (ARRAY[${likes}]) THEN '${type}'`;
  });
  return `CASE WHEN ${col} IS NULL OR ${col} = '' THEN 'offer' ${parts.join(' ')} ELSE 'offer' END`;
}

// Plataformas de checkout de infoproduto (infoOnly=1)
const INFO_PLATFORMS = ['kiwify', 'hotmart', 'eduzz', 'monetizze', 'perfectpay', 'greenn', 'ticto', 'braip', 'cakto', 'lastlink', 'pepper', 'kirvano', 'payt'];

// Mapa de padroes de checkout: id -> sufixos de host (host igual ou subdominio)
const CHECKOUT_PATTERNS = {
  kiwify: ['kiwify.com.br', 'kiwify.app', 'kiwify.com'],
  hotmart: ['hotmart.com', 'hotmart.com.br', 'hotmart.net', 'hotm.art'],
  eduzz: ['eduzz.com', 'eduzz.com.br', 'eduzz.net'],
  monetizze: ['monetizze.com.br', 'monetizze.com'],
  perfectpay: ['perfectpay.com.br', 'perfectpay.com'],
  greenn: ['greenn.com.br', 'greenn.com'],
  ticto: ['ticto.com.br', 'ticto.app', 'ticto.com'],
  braip: ['braip.com', 'braip.com.br'],
  cakto: ['cakto.com.br', 'cakto.com'],
  lastlink: ['lastlink.com', 'lastlink.com.br'],
  pepper: ['pepper.com.br', 'pepper.com'],
  kirvano: ['kirvano.com', 'kirvano.com.br'],
  payt: ['payt.com.br', 'payt.com'],
  yampi: ['yampi.com.br', 'yampi.io'],
  shopify: ['myshopify.com', 'shopify.com', 'shop.app']
};

// SPY_CHECKOUT_HOSTS soma hosts a lista padrao: plataforma=host1,host2;outra=host3
for (const part of (require('../config').CHECKOUT_EXTRA || '').split(';')) {
  const [id, hosts] = part.split('=');
  const key = (id || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,30}$/.test(key) || !hosts) continue;
  CHECKOUT_PATTERNS[key] = (CHECKOUT_PATTERNS[key] || []).concat(hosts.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
}

module.exports = { NON_OFFER_HOSTS, destinationType, destTypeSql, INFO_PLATFORMS, CHECKOUT_PATTERNS };
