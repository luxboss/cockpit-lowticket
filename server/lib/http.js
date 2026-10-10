'use strict';
// Utilitarios HTTP: resposta JSON, corpo JSON e erros de contrato.

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

const sendError = (res, status, error, extra) => sendJson(res, status, Object.assign({ ok: false, error }, extra || {}));
const invalidParam = (res, param) => sendError(res, 400, 'invalid_param', { param });

function readJsonBody(req, maxBytes) {
  const limit = maxBytes || MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(Object.assign(new Error('invalid_json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Corpo JSON que deve ser objeto; responde 400/413 e devolve null se invalido. */
async function readBodyObject(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendError(res, e.status || 400, e.status === 413 ? 'payload_too_large' : 'invalid_json');
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) { sendError(res, 400, 'invalid_body'); return null; }
  return body;
}

module.exports = { sendJson, sendError, invalidParam, readJsonBody, readBodyObject };
