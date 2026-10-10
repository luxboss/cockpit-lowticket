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
