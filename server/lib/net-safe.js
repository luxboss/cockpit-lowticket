'use strict';
// Protecao SSRF (copiado e adaptado do BE-005 da v1): lookup seguro, IP publico, URL de saida valida.
const dns = require('dns');
const net = require('net');
const cfg = require('../config');

// Faixas IPv4 bloqueadas: [base, prefixo]. O loopback so abre no modo teste.
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];
// IPv6 (BigInt): ::/96, NAT64, 6to4, Teredo, doc, ULA, link-local, site-local, multicast.
const BLOCKED_V6 = [
  ['::', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
];

function ipv4ToInt(s) {
  const p = String(s).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const v = parseInt(part, 10);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function ipv6ToBigInt(ip) {
  let s = String(ip).split('%')[0];
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const v4 = ipv4ToInt(m[2]);
    if (v4 === null) return null;
    s = m[1] + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16);
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(':') : [];
  const rest = dbl.length === 2 && dbl[1] ? dbl[1].split(':') : [];
  let groups;
  if (dbl.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...rest];
  } else groups = head;
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

function v4Blocked(n) {
  if (n === null) return true;
  for (const [base, prefix] of BLOCKED_V4) {
    const size = 2 ** (32 - prefix);
    const b = ipv4ToInt(base);
    if (n >= b && n < b + size) {
      if (cfg.TEST_LOOPBACK && base === '127.0.0.0') return false;
      return true;
    }
  }
  return false;
}

/** true so se o IP (literal v4/v6) e publico. Formato desconhecido -> false. */
function isPublicIp(ip) {
  const s = String(ip);
  if (net.isIPv4(s)) return !v4Blocked(ipv4ToInt(s));
  if (!net.isIPv6(s)) return false;
  const n = ipv6ToBigInt(s);
  if (n === null) return false;
  if ((n >> 32n) === 0xffffn) return !v4Blocked(Number(n & 0xffffffffn)); // ::ffff:a.b.c.d
  if (cfg.TEST_LOOPBACK && n === 1n) return true;
  for (const [base, prefix] of BLOCKED_V6) {
    const b = ipv6ToBigInt(base);
    if ((n >> BigInt(128 - prefix)) === (b >> BigInt(128 - prefix))) return false;
  }
  return true;
}

/** Valida URL de saida: http/https, porta 80/443, sem credenciais, IP literal publico. */
function validateOutboundUrl(str) {
  let u;
  try { u = new URL(str); } catch (e) { return { ok: false, error: 'invalid_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'ssrf_blocked' };
  if (u.username || u.password) return { ok: false, error: 'ssrf_blocked' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, error: 'invalid_url' };
  const portOk = u.port === '' || u.port === '80' || u.port === '443' || (cfg.TEST_LOOPBACK && (/^127\.\d+\.\d+\.\d+$/.test(host) || host === '::1'));
  if (!portOk) return { ok: false, error: 'ssrf_blocked' };
  if (net.isIP(host) && !isPublicIp(host)) return { ok: false, error: 'ssrf_blocked' };
  return { ok: true, url: u, host };
}

/** lookup para http(s).request: resolve e recusa IP nao publico NO MOMENTO DA CONEXAO (anti DNS rebinding). */
function makeSafeLookup(resolver) {
  const resolve = resolver || ((host, opts, cb) => dns.lookup(host, opts, cb));
  return function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    resolve(hostname, { all: true, family: opts.family || 0, hints: opts.hints }, (err, addrs) => {
      if (err) return callback(err);
      if (!Array.isArray(addrs)) addrs = addrs ? [{ address: addrs, family: net.isIPv6(addrs) ? 6 : 4 }] : [];
      if (addrs.length === 0) return callback(Object.assign(new Error('sem enderecos'), { code: 'ENOTFOUND' }));
      if (addrs.some((a) => !isPublicIp(a.address))) return callback(Object.assign(new Error('ssrf_blocked'), { code: 'SSRF_BLOCKED' }));
      if (opts.all) return callback(null, addrs);
      return callback(null, addrs[0].address, addrs[0].family);
    });
  };
}

function netError(code, extra) {
  return Object.assign(new Error(code), { errCode: code }, extra || {});
}

module.exports = { isPublicIp, validateOutboundUrl, makeSafeLookup, netError };
