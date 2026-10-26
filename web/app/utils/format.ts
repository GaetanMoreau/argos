const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** « il y a 3 heures », « hier »… */
export function fromNow(iso: string | null | undefined): string {
  if (!iso) return 'jamais';
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "à l'instant";
}

/** Jours entiers jusqu'à une date (négatif si elle est passée). */
export function daysUntil(iso: string | null | undefined): number | null {
  return iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : null;
}

/** « 7 févr. 2027 » (ou « 7 février 2027 » en style long) ; « — » sans date. */
export function formatDay(iso: string | null | undefined, style: 'medium' | 'long' = 'medium'): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR', { dateStyle: style }) : '—';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critique',
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
  unknown: 'Non évaluée',
};

export const STACK_LABELS: Record<string, string> = {
  wordpress: 'WordPress',
  kirby: 'Kirby',
  nuxt: 'Nuxt',
};

export const ECOSYSTEM_LABELS: Record<string, string> = {
  npm: 'npm',
  packagist: 'Composer',
  'wp-core': 'WordPress',
  'wp-plugin': 'Plugin',
  'wp-theme': 'Thème',
  runtime: 'Runtime',
  web: 'Site en ligne',
};

/** Libellés de PageSpeed Insights. */
export const RATING_LABELS: Record<string, string> = {
  good: 'Bon',
  average: 'À améliorer',
  poor: 'Mauvais',
};

/** Garde les deux derniers dossiers d'un chemin long : `…/clients/mon-site`. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path;
}

/** `https://mon-site.fr/` → `mon-site.fr` */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}
