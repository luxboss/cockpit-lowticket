'use strict';
// Grupos de termos do Explorar Ofertas (SPEC-009 secao 5): os 30 termos mais frequentes nos anuncios que casam com a busca
// (amostra de ate 3 mil), sem stopwords em portugues, sem os termos da propria busca e sem palavras com menos de 3 letras.
// Cada termo traz a contagem de OFERTAS (dominios) em que aparece. A tokenizacao e feita aqui (nao no banco) para nao depender do locale.
const STOP_TEXT = `
a ao aos aquela aquelas aquele aqueles aquilo as ate com como da das de dela delas dele deles depois do dos e ela elas ele eles em entre era eram essa essas esse esses esta estas este estes
eu foi foram ha isso isto ja la lhe lhes mais mas me mesmo meu meus minha minhas muito na nas nao nem no nos nossa nossas nosso nossos num numa o os ou para pela pelas pelo pelos por qual quando que quem
se sem ser seu seus so sob sobre sua suas tambem te tem tempo tinha tua tuas um uma umas uns voce voces vos vai vao vamos fazer faz feito ter tenho temos pode podem posso pra pro
estou esta estao estamos sao sou somos fui sera serao seja sejam era eram haver houve tudo toda todas todo todos cada outra outras outro outros onde aqui ali alem apos ainda assim entao porque pois
sim quer quero queira agora hoje ja so apenas bem mal ate desde durante contra mediante perante segundo conforme enquanto embora porem contudo todavia logo portanto
https http www com br clique saiba veja acesse acessar link site mais`.trim();
const STOPWORDS = new Set(STOP_TEXT.split(/\s+/));

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Palavras (so letras) com 3 ou mais caracteres. */
const tokens = (text) => (String(text || '').match(/\p{L}{3,}/gu) || []);

/**
 * rows: [{domain, t}] (t = texto do anuncio). q: texto da busca (seus termos ficam de fora). Devolve [{term, count}] com no maximo 30.
 */
function buildClusters(rows, q) {
  const skip = new Set(tokens(q).map(norm));
  const byKey = new Map(); // chave sem acento -> {term, domains:Set}
  for (const r of rows) {
    if (!r.domain) continue;
    const seen = new Set();
    for (const tok of tokens(r.t)) {
      const key = norm(tok);
      if (key.length < 3 || STOPWORDS.has(key) || skip.has(key) || seen.has(key)) continue;
      seen.add(key);
      let e = byKey.get(key);
      if (!e) { e = { term: tok.toLowerCase(), domains: new Set() }; byKey.set(key, e); }
      e.domains.add(r.domain);
    }
  }
  return Array.from(byKey.values())
    .map((e) => ({ term: e.term, count: e.domains.size }))
    .sort((a, b) => (b.count - a.count) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, 30);
}

module.exports = { buildClusters, STOPWORDS, tokens, norm };
