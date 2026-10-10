'use strict';
// GET /api/v2/ads/:id
const { sendJson, sendError } = require('../lib/http');
const { cardFromRow, CARD_COLS, CARD_JOIN_COLS, DAYS_SQL, ORDER } = require('../search');

/** Lista de midia do anuncio: imagens e videos com indice (o mesmo usado em /media/:id/:kind/:index). */
function mediaList(media) {
  const out = [];
  const m = media && typeof media === 'object' ? media : {};
  (Array.isArray(m.images) ? m.images : []).forEach((u, i) => { if (typeof u === 'string' && u) out.push({ kind: 'image', index: i, url: u, previewUrl: u }); });
  (Array.isArray(m.videos) ? m.videos : []).forEach((v, i) => {
    const url = v && typeof v === 'object' ? (v.hd || v.sd || '') : '';
    if (url) out.push({ kind: 'video', index: i, url, previewUrl: (v.preview || null) });
  });
  return out;
}

async function handleAd(ctx, req, res, id) {
  if (!/^[0-9]{1,30}$/.test(id)) return sendError(res, 404, 'not_found');
  const pool = ctx.pool;
  const r = await pool.query(
    `SELECT a.ad_archive_id, a.page_id, a.domain, a.body, a.title, a.caption, a.cta_text, a.link_url, a.display_format, a.countries, a.language,
            a.platforms, a.media, a.start_date, a.end_date, a.first_seen_at, a.last_seen_at, a.is_active, a.duplicates, a.score,
            ${DAYS_SQL('a')} AS days_running, ${CARD_JOIN_COLS},
            l.final_url, l.title AS l_title, left(l.text, 400) AS l_excerpt, l.fetched_at, (l.domain IS NOT NULL) AS has_landing, l.text IS NOT NULL AS has_text
       FROM spy.ads a LEFT JOIN spy.advertisers adv ON adv.page_id = a.page_id LEFT JOIN spy.landings l ON l.domain = a.domain
      WHERE a.ad_archive_id = $1`, [id]);
  if (!r.rows.length) return sendError(res, 404, 'not_found');
  const row = r.rows[0];
  const media = row.media && typeof row.media === 'object' ? row.media : {};
  const images = Array.isArray(media.images) ? media.images : [];
  const videos = Array.isArray(media.videos) ? media.videos : [];
  row.thumb_url = images[0] || (videos[0] && videos[0].preview) || null;
  row.has_video = videos.length > 0;

  const [sib, snaps] = await Promise.all([
    row.domain
      ? pool.query(
        `WITH page AS MATERIALIZED (SELECT ${CARD_COLS('a')} FROM spy.ads a WHERE a.domain = $1 AND a.ad_archive_id <> $2
                                     ORDER BY a.is_active DESC, ${ORDER.score('a')} LIMIT 12)
         SELECT a.*, ${DAYS_SQL('a')} AS days_running, ${CARD_JOIN_COLS}
           FROM page a LEFT JOIN spy.advertisers adv ON adv.page_id = a.page_id LEFT JOIN spy.landings l ON l.domain = a.domain
          ORDER BY a.is_active DESC, ${ORDER.score('a')}`, [row.domain, id])
      : Promise.resolve({ rows: [] }),
    pool.query("SELECT to_char(day, 'YYYY-MM-DD') AS day, is_active FROM spy.snapshots WHERE ad_archive_id = $1 ORDER BY day ASC LIMIT 400", [id])
  ]);

  const iso = (d) => (d ? d.toISOString() : null);
  const ad = Object.assign(cardFromRow(row), {
    body: row.body || '',
    caption: row.caption || '',
    platforms: row.platforms || [],
    media: mediaList(media),
    landing: row.has_landing && (row.final_url || row.l_title || row.checkout_platform || row.has_text)
      ? { finalUrl: row.final_url || null, title: row.l_title || null, excerpt: row.l_excerpt || null, checkoutPlatform: row.checkout_platform || null,
        priceMin: row.price_min === null ? null : Number(row.price_min), fetchedAt: iso(row.fetched_at) }
      : null,
    siblings: sib.rows.map(cardFromRow),
    timeline: { firstSeenAt: iso(row.first_seen_at), lastSeenAt: iso(row.last_seen_at), startDate: iso(row.start_date), endDate: iso(row.end_date),
      days: snaps.rows.map((s) => ({ day: s.day, isActive: s.is_active })) },
    libraryUrl: 'https://www.facebook.com/ads/library/?id=' + id
  });
  return sendJson(res, 200, { ok: true, ad });
}

module.exports = { handleAd, mediaList };
