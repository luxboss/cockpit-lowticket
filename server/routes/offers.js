'use strict';
// GET /api/v2/offers, /api/v2/offers.csv e /api/v2/offers/:domain (Explorar Ofertas e Visao da Oferta, SPEC-009)
const { sendJson, sendError, invalidParam } = require('../lib/http');
const { parseContext, adContextConds } = require('../lib/params');
const { parseOffersParams, runOffers } = require('../offers/list');
const { fetchOfferRows } = require('../offers/rows');
const { entityDetail } = require('../offers/detail');
const { HOSTNAME_REGEX } = require('../lib/text');

async function handleOffers(ctx, req, res, sp) {
  const parsed = parseOffersParams(sp, false);
  if (parsed.error) return invalidParam(res, parsed.error);
  const p = parsed.p;
  const r = await runOffers(ctx.pool, p, ctx.state.fts);
  const body = { ok: true, total: r.total, page: p.page, pageSize: p.pageSize, summary: r.summary };
  if (p.q) body.clusters = r.clusters;
  body.items = r.items;
  return sendJson(res, 200, body);
}

// ---- CSV: UTF-8 com BOM, separador ;, colunas em portugues, ate 5 mil linhas
const HEAD_ACCENT = ['Oferta', 'Nota', 'Escalada', 'Anúncios ativos', 'Total de anúncios', 'Crescimento 7 d', 'Duplicados máx.', 'Dias no ar máx.', 'Checkout', 'Preço mínimo (R$)', 'Anunciantes', 'Primeiro visto', 'Último visto'];
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s; // evita formula ao abrir no Excel
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const num = (n) => String(n).replace('.', ',');
function toCsv(items) {
  const lines = [HEAD_ACCENT.map(csvCell).join(';')];
  for (const o of items) {
    lines.push([
      o.domain, num(o.score), o.scaled ? 'Sim' : 'Não', o.activeAds, o.totalAds, o.growth7d, o.dupMax, o.daysMax,
      o.checkout ? o.checkout.platform : '', o.checkout && o.checkout.priceMin !== null ? num(o.checkout.priceMin.toFixed(2)) : '',
      o.advertisersCount, o.firstSeenAt ? o.firstSeenAt.slice(0, 10) : '', o.lastSeenAt ? o.lastSeenAt.slice(0, 10) : ''
    ].map(csvCell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function handleOffersCsv(ctx, req, res, sp) {
  const parsed = parseOffersParams(sp, true);
  if (parsed.error) return invalidParam(res, parsed.error);
  const r = await runOffers(ctx.pool, parsed.p, ctx.state.fts);
  const body = Buffer.from(toCsv(r.items), 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ofertas.csv"',
    'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

async function handleOfferDetail(ctx, req, res, domainRaw, sp) {
  const domain = decodeURIComponent(domainRaw).toLowerCase().replace(/^www\./, '');
  if (!HOSTNAME_REGEX.test(domain)) return sendError(res, 404, 'not_found');
  const parsed = parseContext(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const c = parsed.c;
  const rows = await fetchOfferRows(ctx.pool, [domain]);
  if (!rows.length) return sendError(res, 404, 'not_found');
  const push = (arr) => (v) => { arr.push(v); return '$' + arr.length; };
  const params = [domain];
  const conds = ["a.dest_type = 'offer'", 'a.domain = $1'].concat(adContextConds(c, push(params)));
  const d = await entityDetail(ctx.pool, conds.join(' AND '), params, c.period, true);
  const l = await ctx.pool.query('SELECT final_url, title, left(text, 400) AS excerpt, text IS NOT NULL AS has_text FROM spy.landings WHERE domain = $1', [domain]);
  const lr = l.rows[0];
  const landing = lr && (lr.final_url || lr.title || lr.has_text) ? { finalUrl: lr.final_url || null, title: lr.title || null, excerpt: lr.excerpt || null } : null;
  return sendJson(res, 200, { ok: true, offer: Object.assign(rows[0], { landing, trend: d.trend, countries: d.countries, formats: d.formats, topAds: d.topAds, advertisers: d.advertisers }) });
}

module.exports = { handleOffers, handleOffersCsv, handleOfferDetail, toCsv };
