// Utilitários de formatação para pt-BR (SPEC-008 e SPEC-009)

export function formatScore(score: number | undefined | null): string {
  if (score === undefined || score === null || isNaN(score)) return '0';
  return String(Math.round(score));
}

export function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  return n.toLocaleString('pt-BR');
}

export function formatCompactNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  if (n >= 1000000) {
    const v = (n / 1000000).toFixed(1).replace('.', ',');
    return `${v.endsWith(',0') ? v.slice(0, -2) : v} mi`;
  }
  if (n >= 1000) {
    const v = (n / 1000).toFixed(1).replace('.', ',');
    return `${v.endsWith(',0') ? v.slice(0, -2) : v} mil`;
  }
  return n.toLocaleString('pt-BR');
}

export function formatCurrency(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return 'R$ 0,00';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDatePtBr(iso: string | undefined | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function formatShortDate(iso: string | undefined | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch {
    return iso;
  }
}

export function pluralize(count: number | undefined | null, singular: string, plural: string): string {
  const c = Math.abs(count ?? 0);
  return c === 1 ? singular : plural;
}

export function formatCount(count: number | undefined | null, singular: string, plural: string): string {
  const c = count ?? 0;
  return `${formatNumber(c)} ${pluralize(c, singular, plural)}`;
}

export function formatGrowth(growth: number | undefined | null): { text: string; color: string } {
  if (growth === undefined || growth === null || isNaN(growth) || growth === 0) {
    return { text: '0', color: 'var(--text-2)' };
  }
  if (growth > 0) {
    return { text: `+${growth}`, color: 'var(--ok)' };
  }
  return { text: `${growth}`, color: 'var(--bad)' };
}

// 1) Números decimais com vírgula em pt-BR (ex: 34,7 dias)
export function formatDecimal(val: number | string | undefined | null, decimals = 1): string {
  if (val === undefined || val === null || val === '') return '0';
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return String(val);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

// 2) Formatos crus da API traduzidos (IMAGE, VIDEO, CAROUSEL, DCO, OTHER)
export const FORMAT_LABELS: Record<string, string> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  CAROUSEL: 'Carrossel',
  DCO: 'Dinâmico',
  OTHER: 'Outro',
};

export function formatAdFormat(fmt: string | undefined | null): string {
  if (!fmt) return 'Outro';
  const upper = fmt.toUpperCase().trim();
  return FORMAT_LABELS[upper] || fmt;
}

// 2) Checkouts em minúsculo convertidos para nome próprio
export const CHECKOUT_LABELS: Record<string, string> = {
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
  eduzz: 'Eduzz',
  monetizze: 'Monetizze',
  'perfect pay': 'Perfect Pay',
  perfectpay: 'Perfect Pay',
  greenn: 'Greenn',
  ticto: 'Ticto',
  braip: 'Braip',
  cakto: 'Cakto',
  lastlink: 'Lastlink',
  pepper: 'Pepper',
  shopify: 'Shopify',
  yampi: 'Yampi',
};

export function formatCheckoutPlatform(plat: string | undefined | null): string {
  if (!plat) return '';
  const lower = plat.toLowerCase().trim();
  return CHECKOUT_LABELS[lower] || (plat.charAt(0).toUpperCase() + plat.slice(1));
}

// 2) Mapeamento de nomes de países para exibir no atributo title
export const COUNTRY_NAMES: Record<string, string> = {
  BR: 'Brasil',
  PT: 'Portugal',
  US: 'Estados Unidos',
  ES: 'Espanha',
  AR: 'Argentina',
  MX: 'México',
  CO: 'Colômbia',
  CL: 'Chile',
  PE: 'Peru',
  UY: 'Uruguai',
  PY: 'Paraguai',
  BO: 'Bolívia',
  FR: 'França',
  DE: 'Alemanha',
  IT: 'Itália',
  GB: 'Reino Unido',
  CA: 'Canadá',
  AO: 'Angola',
  MZ: 'Moçambique',
};

export function getCountryName(code: string | undefined | null): string {
  if (!code) return '';
  const upper = code.toUpperCase().trim();
  return COUNTRY_NAMES[upper] || code;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  pt: 'Português',
  es: 'Espanhol',
  en: 'Inglês',
  fr: 'Francês',
  de: 'Alemão',
  it: 'Italiano',
};

export function formatLanguage(lang: string | undefined | null): string {
  if (!lang) return '';
  const lower = lang.toLowerCase().trim();
  return LANGUAGE_NAMES[lower] || lang.toUpperCase();
}

// Helper para BarList: devolve label formatado e title completo
export function formatBarListLabel(id: string): { label: string; title: string } {
  if (!id) return { label: '', title: '' };
  const upper = id.toUpperCase().trim();
  if (COUNTRY_NAMES[upper]) {
    return { label: upper, title: COUNTRY_NAMES[upper] };
  }
  if (FORMAT_LABELS[upper]) {
    return { label: FORMAT_LABELS[upper], title: FORMAT_LABELS[upper] };
  }
  const lower = id.toLowerCase().trim();
  if (LANGUAGE_NAMES[lower]) {
    return { label: LANGUAGE_NAMES[lower], title: LANGUAGE_NAMES[lower] };
  }
  if (CHECKOUT_LABELS[lower]) {
    return { label: CHECKOUT_LABELS[lower], title: CHECKOUT_LABELS[lower] };
  }
  return { label: id, title: id };
}
