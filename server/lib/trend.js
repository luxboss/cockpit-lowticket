'use strict';
// Curva de anuncios ativos por dia (SPEC-009 secao 5). Dia = data em America/Sao_Paulo.
// Ativo no dia D: sd <= D e ed >= D, onde sd = dia de start_date e ed = dia de fim:
//   end_date; se nao ha, anuncio ainda ativo (is_active) vale ate hoje; senao o ultimo dia visto. Sempre ed >= sd.
// (Para anuncio ainda ativo usamos hoje em vez de last_seen_at: a palavra coleta so o topo, entao nao ver de novo nao prova que acabou.)
const TZ = "'America/Sao_Paulo'";
const TODAY = `(NOW() AT TIME ZONE ${TZ})::date`;
// o mesmo dia como sub-select sem correlacao: o banco calcula uma vez por consulta e nao por linha (custava ~4 us por anuncio)
const TODAY_ONCE = `(SELECT ${TODAY})`;

// dia de uma data por linha: Sao Paulo e UTC-3 o ano todo desde 2019; a conversao fixa custa ~1/3 da por fuso (AT TIME ZONE com regras), que pesava em dezenas de milhares de linhas
const DAY_SQL = (x) => `((${x} AT TIME ZONE 'UTC') - INTERVAL '3 hours')::date`;
const SD_SQL = (a) => DAY_SQL(`${a}.start_date`);
const ED_SQL = (a) => `GREATEST(CASE WHEN ${a}.end_date IS NULL AND ${a}.is_active THEN ${TODAY_ONCE} ELSE ${DAY_SQL(`COALESCE(${a}.end_date, ${a}.last_seen_at)`)} END, ${SD_SQL(a)})`;

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

/** Histogramas de inicio e fim da CTE (colunas sd e ed): CTEs <cte>_s e <cte>_e, calculadas uma vez e lidas por trendSql. */
const histCtes = (cte) => `${cte}_s AS MATERIALIZED (SELECT sd, SUM(c) AS c FROM ${cte} GROUP BY sd), ${cte}_e AS MATERIALIZED (SELECT ed, SUM(c) AS c FROM ${cte} GROUP BY ed)`;

/**
 * Subconsulta que devolve [{day, activeAds}]. Exige a CTE <cte> (colunas sd, ed e c = quantos anuncios tem esse par de dias) e as
 * CTEs de histogramaCtes(cte) no mesmo WITH (poucos dias distintos: o custo e dias x dias, nao anuncios x dias). from/to sao expressoes SQL de data.
 */
function trendSql(cte, from, to) {
  return `(SELECT COALESCE(jsonb_agg(jsonb_build_object('day', to_char(t.d, 'YYYY-MM-DD'), 'activeAds', t.n) ORDER BY t.d), '[]'::jsonb) FROM (
      SELECT g.d::date AS d,
             (COALESCE((SELECT SUM(s.c) FROM ${cte}_s s WHERE s.sd <= g.d::date), 0)
            - COALESCE((SELECT SUM(e.c) FROM ${cte}_e e WHERE e.ed < g.d::date), 0))::int AS n
        FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') g(d)) t)`;
}

/** Inicio da janela: 7d/30d/90d contam hoje; all vai do primeiro anuncio (no maximo 365 dias). */
function periodFrom(period, cte) {
  if (PERIOD_DAYS[period]) return `(${TODAY} - ${PERIOD_DAYS[period] - 1})`;
  return `GREATEST((SELECT MIN(sd) FROM ${cte}), ${TODAY} - 364)`;
}

module.exports = { TZ, TODAY, TODAY_ONCE, SD_SQL, ED_SQL, PERIOD_DAYS, trendSql, periodFrom, histCtes };
