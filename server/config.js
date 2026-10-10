'use strict';
// Configuracao da v2 (SPEC-008): tudo vem de variaveis de ambiente, com padroes seguros.

function int(name, def) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : def;
}
function num(name, def) {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(n) ? n : def;
}

const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  isTest,
  PORT: int('PORT', 3000),
  DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  APP_TOKEN: process.env.APP_TOKEN || '',
  WEB_DIST: process.env.SPY_WEB_DIST || '', // vazio = ../web/dist
  WORKER_ENABLED: process.env.SPY_WORKER_ENABLED !== '0',

  // Apify (plano gratis: cota diaria pequena, uma coleta por vez)
  APIFY_TOKEN: process.env.APIFY_TOKEN || '',
  APIFY_ACTOR: process.env.SPY_APIFY_ACTOR || 'curious_coder~facebook-ads-library-scraper',
  APIFY_BASE_URL: (process.env.SPY_APIFY_BASE_URL || 'https://api.apify.com').replace(/\/+$/, ''),
  COLLECT_DAILY_LIMIT: int('SPY_COLLECT_DAILY_LIMIT', 500),
  NOW_DAILY_LIMIT: int('SPY_NOW_DAILY_LIMIT', 150),
  COLLECT_INTERVAL_MS: int('SPY_COLLECT_INTERVAL_MS', 300000),
  COLLECT_RUN_ADS: int('SPY_COLLECT_RUN_ADS', 100), // anuncios pedidos por coleta de palavra
  NOW_RUN_ADS: int('SPY_NOW_RUN_ADS', 50), // anuncios pedidos por Buscar agora
  COLLECT_MIN_RESERVE: int('SPY_COLLECT_MIN_RESERVE', 10), // abaixo disso o dia esta esgotado
  COLLECT_POLL_MS: int('SPY_COLLECT_POLL_MS', 10000),
  COLLECT_RUN_TIMEOUT_MS: int('SPY_COLLECT_RUN_TIMEOUT_MS', 600000),
  COLLECT_HTTP_TIMEOUT_MS: int('SPY_COLLECT_HTTP_TIMEOUT_MS', 30000),
  COLLECT_PAGE: int('SPY_COLLECT_PAGE', 100),
  KEYWORD_EVERY_HOURS: int('SPY_KEYWORD_EVERY_HOURS', 24),
  KEYWORD_RETRY_HOURS: int('SPY_KEYWORD_RETRY_HOURS', 1),
  KEYWORD_MAX: 50,

  // BE-017: escala real
  APIFY_PAGE_ACTOR: process.env.SPY_PAGE_ACTOR || 'apify~facebook-ads-scraper', // tem onlyTotal: devolve so o total de anuncios da pagina (1 item por pagina)
  PAGE_COUNTRY: (process.env.SPY_PAGE_COUNTRY || 'BR').toUpperCase(), // pais do total real (ALL = todos)
  PAGE_CHECKS_PER_DAY: int('SPY_PAGE_CHECKS_PER_DAY', 60), // anunciantes que o job diario escolhe
  PAGE_DAILY_LIMIT: int('SPY_PAGE_DAILY_LIMIT', 60), // teto de consultas de total por dia (cota propria)
  PAGE_RECHECK_DAYS: int('SPY_PAGE_RECHECK_DAYS', 3),
  PAGE_GAP_MS: int('SPY_PAGE_GAP_MS', 30000), // intervalo minimo entre duas consultas de total
  PAGE_SAMPLE_ADS: int('SPY_PAGE_SAMPLE_ADS', 30), // so se o actor nao tiver onlyTotal: baixa ate isso e usa a contagem como minimo
  PAGE_COST_USD: num('SPY_PAGE_COST_USD', 0.0058), // custo por consulta quando o Apify nao informa (1 item pago, plano gratis)
  DOMAIN_CHECKS_PER_DAY: int('SPY_DOMAIN_CHECKS_PER_DAY', 20), // buscas do dominio do produtor por dia
  DOMAIN_RUN_ADS: int('SPY_DOMAIN_RUN_ADS', 30), // anuncios pedidos por busca de dominio
  DOMAIN_MAX_SHARE: num('SPY_DOMAIN_MAX_SHARE', 0.5), // parte maxima da cota diaria das palavras que as buscas de dominio podem gastar
  DOMAIN_RECHECK_DAYS: int('SPY_DOMAIN_RECHECK_DAYS', 7),
  DOMAIN_GAP_MS: int('SPY_DOMAIN_GAP_MS', 30000),
  LIBRARY_SORT: process.env.SPY_LIBRARY_SORT === undefined ? 'total_impressions' : process.env.SPY_LIBRARY_SORT, // '', total_impressions ou relevancy_monthly_grouped
  SITEMAP_ENABLED: process.env.SPY_SITEMAP_ENABLED !== '0',
  SITEMAP_BATCH: int('SPY_SITEMAP_BATCH', 3),
  SITEMAP_MAX_URLS: int('SPY_SITEMAP_MAX_URLS', 500),
  SITEMAP_MAX_BYTES: 3 * 1024 * 1024,
  SITEMAP_EVERY_HOURS: int('SPY_SITEMAP_EVERY_HOURS', 24),
  CHECKOUT_EXTRA: process.env.SPY_CHECKOUT_HOSTS || '', // plataforma=host1,host2;outra=host3 (soma a lista padrao)

  // Enriquecimento de landing
  ENRICH_ENABLED: process.env.SPY_ENRICH_ENABLED !== '0',
  ENRICH_INTERVAL_MS: int('SPY_ENRICH_INTERVAL_MS', 20000),
  ENRICH_BATCH: int('SPY_ENRICH_BATCH', 5),
  ENRICH_CONCURRENCY: int('SPY_ENRICH_CONCURRENCY', 2),
  ENRICH_HOST_INTERVAL_MS: int('SPY_ENRICH_HOST_INTERVAL_MS', 5000),
  ENRICH_TIMEOUT_MS: int('SPY_ENRICH_TIMEOUT_MS', 10000),
  ENRICH_MAX_BYTES: 1.5 * 1024 * 1024,
  ENRICH_MAX_REDIRECTS: 5,
  ENRICH_OK_DAYS: int('SPY_ENRICH_OK_DAYS', 7),
  ENRICH_RETRY_HOURS: int('SPY_ENRICH_RETRY_HOURS', 24),
  LANDING_TEXT_MAX: 20000,
  USER_AGENT: 'CockpitLowTicket-Spy/2.0',

  // Nota de escala (SPEC-008 secao 5): pesos e tetos configuraveis
  SCORE_ENABLED: process.env.SPY_SCORE_ENABLED !== '0',
  SCORE_INTERVAL_MS: int('SPY_SCORE_INTERVAL_MS', 1800000),
  SCORE_W: {
    days: num('SPY_SCORE_W_DAYS', 0.35),
    dup: num('SPY_SCORE_W_DUP', 0.30),
    domain: num('SPY_SCORE_W_DOMAIN', 0.20),
    growth: num('SPY_SCORE_W_GROWTH', 0.15)
  },
  SCORE_CAP: {
    days: num('SPY_SCORE_CAP_DAYS', 90),
    dup: num('SPY_SCORE_CAP_DUP', 50),
    domain: num('SPY_SCORE_CAP_DOMAIN', 30),
    growth: num('SPY_SCORE_CAP_GROWTH', 10)
  },

  // Ofertas (SPEC-009): oferta escalada = nota >= SCALED_SCORE e ativos >= SCALED_MIN_ACTIVE
  SCALED_SCORE: num('SPY_SCALED_SCORE', 35), // BE-017: a nota nova tem outra escala (ver SCORE2); 60 quase nunca seria atingido
  SCALED_MIN_PAGE_ADS: int('SPY_SCALED_MIN_PAGE_ADS', 20), // total real do principal anunciante
  SCALED_MIN_ACTIVE_OFFER: int('SPY_SCALED_MIN_ACTIVE_OFFER', 15), // ou ativos da propria oferta
  SCORE2_W: {
    pages: num('SPY_SCORE2_W_PAGES', 0.40),
    active: num('SPY_SCORE2_W_ACTIVE', 0.20),
    dup: num('SPY_SCORE2_W_DUP', 0.15),
    days: num('SPY_SCORE2_W_DAYS', 0.10),
    growth: num('SPY_SCORE2_W_GROWTH', 0.15)
  },
  SCORE2_CAP: {
    pages: num('SPY_SCORE2_CAP_PAGES', 100),
    active: num('SPY_SCORE2_CAP_ACTIVE', 50),
    dup: num('SPY_SCORE2_CAP_DUP', 50),
    days: num('SPY_SCORE2_CAP_DAYS', 90),
    growth: num('SPY_SCORE2_CAP_GROWTH', 20)
  },
  OFFER_STATS_ENABLED: process.env.SPY_OFFER_STATS_ENABLED !== '0',

  // Midia
  MEDIA_MAX_BYTES: 300 * 1024 * 1024,
  MEDIA_TIMEOUT_MS: 120000,
  MEDIA_MAX_REDIRECTS: 3,
  MEDIA_MAX_CONCURRENT: 4,

  // Busca
  FILTERS_CACHE_MS: int('SPY_FILTERS_CACHE_MS', 30000),
  HOME_CACHE_MS: int('SPY_HOME_CACHE_MS', 15000), // palavras da home (total, novos e minicurva de cada uma): agrega ad_sources inteira
  FORCE_NO_FTS: isTest && process.env.SPY_FORCE_NO_FTS === '1', // so teste: simula banco sem extensoes
  REIMPORT_V1: process.env.SPY_REIMPORT_V1 === '1',

  // Testes: loopback liberado na landing e mapa host->IP na midia (so com NODE_ENV=test)
  TEST_LOOPBACK: isTest && process.env.SPY_TEST_LOOPBACK === '1',
  MEDIA_TEST_HOSTMAP: (() => {
    if (!isTest || !process.env.SPY_MEDIA_TEST_HOSTMAP) return null;
    try {
      const o = JSON.parse(process.env.SPY_MEDIA_TEST_HOSTMAP);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (e) { return null; }
  })()
};
