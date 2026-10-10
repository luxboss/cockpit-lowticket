'use strict';
// GET /api/v2/checkouts?tab=rising|falling|new&platform=&country=&infoOnly=&page=&pageSize= (BE-017, AC-03)
const { sendJson, invalidParam } = require('../lib/http');
const { parseParams, list } = require('../offers/checkouts');

async function handleCheckouts(ctx, req, res, sp) {
  const parsed = parseParams(sp);
  if (parsed.error) return invalidParam(res, parsed.error);
  const p = parsed.p;
  const r = await list(ctx.pool, p);
  return sendJson(res, 200, { ok: true, total: r.total, page: p.page, pageSize: p.pageSize, items: r.items });
}

module.exports = { handleCheckouts };
