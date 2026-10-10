'use strict';
// Cliente do Apify e mapeador de itens do dataset (copiado e adaptado da v1: mapApifyAdItem e apifyCall).
const cfg = require('../config');
const { plainText, toEpochSeconds } = require('../lib/text');

const DISPLAY_FORMATS = new Set(['IMAGE', 'VIDEO', 'CAROUSEL', 'DCO', 'OTHER']);
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

function collectError(code, extra) { return Object.assign(new Error(code), { collectCode: code }, extra || {}); }

/** Remove o token de qualquer texto antes de gravar/expor. */
function scrub(text) {
  let s = String(text == null ? '' : text);
  if (cfg.APIFY_TOKEN && cfg.APIFY_TOKEN.length >= 8) s = s.split(cfg.APIFY_TOKEN).join('[redigido]');
  return s;
}
function errText(err) {
  const code = err && err.collectCode ? err.collectCode : 'collect_error';
  return scrub(code + (err && err.detail ? ': ' + err.detail : '')).slice(0, 200);
}

/** URL de busca da Biblioteca de Anuncios (so anuncios ativos). country ALL = todos os paises. */
function libraryUrl(term, country) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=' + encodeURIComponent(country)
    + '&q=' + encodeURIComponent(term) + '&search_type=keyword_unordered&media_type=all';
}

// Adaptadores por actor: buildInput(term, country, limit) monta o input do run.
const ADAPTERS = {
  'apify~facebook-ads-scraper': {
    buildInput: (term, country, limit) => ({ startUrls: [{ url: libraryUrl(term, country) }], resultsLimit: limit, isDetailsPerAd: false, includeAboutPage: false, onlyTotal: false })
  },
  'curious_coder~facebook-ads-library-scraper': {
    buildInput: (term, country, limit) => ({ urls: [{ url: libraryUrl(term, country) }], count: limit, scrapeAdDetails: false })
  }
};
function adapter() { return Object.prototype.hasOwnProperty.call(ADAPTERS, cfg.APIFY_ACTOR) ? ADAPTERS[cfg.APIFY_ACTOR] : null; }
function configured() { return !!cfg.APIFY_TOKEN && !!adapter(); }

/** Chamada a API v2 do Apify (token so no header). Resolve {status, headers, data} ou lanca com collectCode curto. */
async function apifyCall(method, pathAndQuery, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.COLLECT_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.APIFY_BASE_URL + pathAndQuery, {
      method,
      headers: { Authorization: 'Bearer ' + cfg.APIFY_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* resposta nao JSON */ }
    if (!res.ok) {
      const msg = data && data.error && typeof data.error.message === 'string' ? data.error.message : '';
      throw collectError('apify_http_' + res.status, { detail: scrub(msg).slice(0, 120) });
    }
    if (data === null) throw collectError('apify_invalid_response');
    return { status: res.status, headers: res.headers, data };
  } catch (err) {
    if (err && err.collectCode) throw err;
    if (err && err.name === 'AbortError') throw collectError('apify_timeout');
    throw collectError('apify_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Item do dataset -> anuncio normalizado. Tolera camelCase/snake_case, campos em item ou snapshot, datas ISO/epoch e HTML no texto.
 * Retorna null se nao for um objeto ou nao tiver id numerico.
 */
function mapApifyAdItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const snap = item.snapshot && typeof item.snapshot === 'object' && !Array.isArray(item.snapshot) ? item.snapshot : {};
  const cards = Array.isArray(snap.cards) ? snap.cards : Array.isArray(item.cards) ? item.cards : [];
  const card0 = cards[0] && typeof cards[0] === 'object' ? cards[0] : {};
  const pick = (keys, srcs) => {
    for (const o of srcs || [item, snap]) {
      for (const k of keys) { const v = o[k]; if (v !== undefined && v !== null && v !== '') return v; }
    }
    return undefined;
  };
  const idRaw = pick(['adArchiveID', 'adArchiveId', 'ad_archive_id', 'adArchiveid'], [item]);
  let adArchiveId = null;
  if (typeof idRaw === 'string') adArchiveId = idRaw.trim();
  else if (typeof idRaw === 'number' && Number.isSafeInteger(idRaw)) adArchiveId = String(idRaw);
  if (!adArchiveId || !/^[0-9]{1,30}$/.test(adArchiveId)) return null;

  const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const platformsRaw = pick(['publisherPlatform', 'publisher_platform', 'publisherPlatforms', 'publisher_platforms']);
  const platforms = (Array.isArray(platformsRaw) ? platformsRaw : platformsRaw ? [platformsRaw] : []).map((p) => str(p).trim().toUpperCase()).filter(Boolean).slice(0, 10);
  let displayFormat = str(pick(['displayFormat', 'display_format'])).trim().toUpperCase();
  if (!DISPLAY_FORMATS.has(displayFormat)) displayFormat = cards.length > 1 ? 'CAROUSEL' : 'OTHER';

  const bodyRaw = snap.body !== undefined ? snap.body : item.body;
  const bodyText = bodyRaw && typeof bodyRaw === 'object' ? bodyRaw.text : bodyRaw;
  const body = plainText(str(bodyText) || str(card0.body) || str(item.text) || (Array.isArray(item.ad_creative_bodies) ? str(item.ad_creative_bodies[0]) : ''));

  const urlOf = (o) => str(o && typeof o === 'object' ? (o.original_image_url || o.originalImageUrl || o.resized_image_url || o.resizedImageUrl || o.url || o.src) : o);
  const imgSrc = Array.isArray(snap.images) ? snap.images : Array.isArray(item.images) ? item.images : [];
  const images = imgSrc.map(urlOf);
  for (const c of cards) if (c && typeof c === 'object') images.push(urlOf({ original_image_url: c.original_image_url || c.originalImageUrl, resized_image_url: c.resized_image_url || c.resizedImageUrl }));
  const vidSrc = Array.isArray(snap.videos) ? snap.videos : Array.isArray(item.videos) ? item.videos : [];
  const videos = vidSrc.map((v) => (v && typeof v === 'object'
    ? { hd: str(v.video_hd_url || v.videoHdUrl || v.hd || v.hdUrl), sd: str(v.video_sd_url || v.videoSdUrl || v.sd || v.sdUrl), preview: str(v.video_preview_image_url || v.videoPreviewImageUrl || v.preview || v.thumbnail) }
    : { hd: str(v), sd: '', preview: '' }));

  const countRaw = Number(pick(['collationCount', 'collation_count']));
  const pageName = plainText(str(pick(['pageName', 'page_name'])));
  return {
    adArchiveId,
    pageId: str(pick(['pageID', 'pageId', 'page_id'])).slice(0, 100),
    pageName,
    avatarUrl: str(pick(['pageProfilePictureUrl', 'page_profile_picture_url', 'profilePictureUrl'])) || null,
    isActive: (() => { const a = pick(['isActive', 'is_active'], [item]); return !(a === false || a === 'false'); })(),
    startDate: toEpochSeconds(pick(['startDate', 'start_date', 'startDateFormatted', 'start_date_formatted'])),
    endDate: toEpochSeconds(pick(['endDate', 'end_date', 'endDateFormatted', 'end_date_formatted'])),
    collationId: str(pick(['collationID', 'collationId', 'collation_id'])).slice(0, 100) || null,
    duplicates: Number.isInteger(countRaw) && countRaw >= 1 ? Math.min(countRaw, 1000000) : 1,
    platforms,
    displayFormat,
    body,
    title: plainText(str(pick(['title'])) || str(card0.title)),
    caption: plainText(str(pick(['caption'])) || str(card0.caption)),
    ctaText: plainText(str(pick(['ctaText', 'cta_text'])) || str(card0.cta_text || card0.ctaText)),
    linkUrl: (str(pick(['linkUrl', 'link_url'])) || str(card0.link_url || card0.linkUrl)).slice(0, 2000),
    images: images.filter(Boolean).slice(0, 20),
    videos: videos.slice(0, 10)
  };
}

module.exports = { TERMINAL, collectError, errText, scrub, configured, adapter, apifyCall, mapApifyAdItem, libraryUrl };
