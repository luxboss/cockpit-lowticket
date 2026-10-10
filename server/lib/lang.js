'use strict';
// Idioma do anuncio: heuristica por palavras frequentes de pt, es e en (copiada da v1/BE-013).
// So conta a palavra exclusiva de um idioma. Sem sinal claro devolve null.
const WORDS = {
  pt: 'de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele vc pra obrigado hoje agora grátis desconto comprar aproveite frete garantia saiba clique aqui resultado resultados seu sua nosso nossa produto emagrecer queimar gordura barriga',
  es: 'de la que el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas es son está hoy ahora gratis descuento comprar aprovecha envío garantía haz clic aquí resultado resultados nuestro nuestra producto adelgazar quemar grasa vientre',
  en: 'the of and to a in is that it for as with was on be by at this have from or an they which you are but not what all were we when your can said there use each do how if will up other about out many then them these so some her would make like him into time has look two more write go see no way could people my than first been who its now find today free discount buy shop shipping guarantee learn click here result results our product lose burn fat belly weight'
};

const SETS = (() => {
  const raw = {};
  const count = new Map();
  for (const [lang, str] of Object.entries(WORDS)) {
    raw[lang] = new Set(str.split(/\s+/).filter(Boolean));
    for (const w of raw[lang]) count.set(w, (count.get(w) || 0) + 1);
  }
  const out = {};
  for (const lang of Object.keys(raw)) out[lang] = new Set(Array.from(raw[lang]).filter((w) => count.get(w) === 1));
  return out;
})();

/** pt | es | en | null: vence quem tem ao menos 2 acertos e o dobro do segundo (ou 1 acerto sozinho em texto curto). */
function detectLanguage(text) {
  if (typeof text !== 'string' || !text) return null;
  const clean = text.slice(0, 6000).toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/\{\{[^{}]*\}\}/g, ' ').replace(/[#@]\S+/g, ' ');
  const words = clean.match(/\p{L}+/gu);
  if (!words || !words.length) return null;
  const hits = { pt: 0, es: 0, en: 0 };
  for (const w of words) for (const lang of ['pt', 'es', 'en']) if (SETS[lang].has(w)) hits[lang]++;
  const ranked = Object.entries(hits).sort((x, y) => y[1] - x[1]);
  const best = ranked[0];
  const second = ranked[1];
  if (best[1] >= 2 && best[1] >= 2 * second[1]) return best[0];
  if (best[1] === 1 && second[1] === 0 && words.length <= 8) return best[0];
  return null;
}

module.exports = { detectLanguage };
