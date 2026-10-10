'use strict';
// Helpers de texto e URL (copiados da v1): HTML -> texto, datas, dominio de destino do anuncio.

const HOSTNAME_REGEX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CONTROL_RE = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', 'g');

/** Texto limpo: so string, sem NUL (o Postgres rejeita), cortado em max. */
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\u0000/g, '').slice(0, max);
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ' '; })
    .replace(/&#([0-9]{1,7});/g, (m, d) => { const c = parseInt(d, 10); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ' '; })
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
}

/** Texto sem HTML (tags, script e style), entidades decodificadas. Entrada limitada antes das regex. */
function plainText(v) {
  if (typeof v !== 'string') return '';
  const s = v.slice(0, 20000).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  return decodeHtmlEntities(s).replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Data ISO, epoch em segundos ou em milissegundos (numero ou texto) -> epoch em segundos; invalida -> null. */
function toEpochSeconds(v) {
  if (v === null || v === undefined || v === '') return null;
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (/^[0-9]{1,16}(\.[0-9]+)?$/.test(s)) n = Number(s);
    else {
      const ms = Date.parse(s);
      return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
    }
  } else return null;
  if (!Number.isFinite(n) || n <= 0 || n >= 1e17) return null;
  if (n >= 1e11) n = n / 1000; // epoch em ms
  return Math.floor(n);
}

/** Hostname do destino em minusculas sem "www."; desembrulha redirecionadores da Meta; invalido -> null. */
function extractLandingTarget(linkUrl) {
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
    return HOSTNAME_REGEX.test(clean) ? { domain: clean, url: u.href } : null;
  }
  return null;
}

// Anuncio de catalogo dinamico (DPA): o texto traz marcadores como {{product.name}} (a Meta troca pelo produto de cada pessoa; na Biblioteca vem cru)
const TEMPLATE_RE = /\{\{[^{}]*\}\}/;
const hasTemplate = (v) => typeof v === 'string' && (TEMPLATE_RE.test(v) || v.includes('{{product.'));
// o mesmo teste em SQL (Postgres ~): usado no backfill e na importacao da v1
const TEMPLATE_SQL_RE = '\\{\\{[^{}]*\\}\\}';

module.exports = { hasTemplate, TEMPLATE_SQL_RE, HOSTNAME_REGEX, CONTROL_RE, cleanText, decodeHtmlEntities, plainText, toEpochSeconds, extractLandingTarget };
