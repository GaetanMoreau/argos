import type { Db } from '../db/index.ts';
import { getJson, mapLimit, type Fetch } from '../http.ts';
import type { Component, Match, VulnSourceResult } from '../types.ts';

const DAY = 24 * 60 * 60 * 1000;
const SOON = 90 * DAY;

/** Composants suivis sur endoflife.date (Vue est exclu : chaque mineure y devient EOL dès la suivante). */
const PRODUCTS: Record<string, { product: string; label: string }> = {
  'runtime:nodejs': { product: 'nodejs', label: 'Node.js' },
  'runtime:php': { product: 'php', label: 'PHP' },
  'npm:nuxt': { product: 'nuxt', label: 'Nuxt' },
  'packagist:getkirby/cms': { product: 'kirby', label: 'Kirby' },
};

const productOf = (c: Component) => (c.isDev ? undefined : PRODUCTS[`${c.ecosystem}:${c.name}`]);

/** Branche correspondant à la version : `8.1.0` → `8.1` sinon `8`. */
export function findRelease(releases: any[], version: string): any | null {
  const parts = version.split('.');
  for (const name of [parts.slice(0, 2).join('.'), parts[0]]) {
    const release = releases.find((r) => r.name === name);
    if (release) return release;
  }
  return null;
}

const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

/** Branches en fin de support (high) ou qui le seront sous 90 jours (medium). */
export async function queryEndOfLife(db: Db, fetcher: Fetch, components: Component[], now = Date.now()): Promise<VulnSourceResult> {
  const covered = components.filter(productOf);
  const products = [...new Set(covered.map((c) => productOf(c)!.product))];
  const data = new Map(
    await mapLimit(products, 4, async (p) => [p, await getJson(db, fetcher, `https://endoflife.date/api/v1/products/${p}/`)] as const),
  );

  const matches: Match[] = [];
  for (const component of covered) {
    const { product, label } = productOf(component)!;
    const releases: any[] = data.get(product)?.result?.releases ?? [];
    const release = findRelease(releases, component.version);
    if (!release?.eolFrom) continue;

    const eol = Date.parse(release.eolFrom);
    const soon = !release.isEol && eol - now <= SOON;
    if (!release.isEol && !soon) continue;

    const target = releases.find((r) => !r.isEol && r.isMaintained)?.latest?.name ?? null;
    matches.push({
      component,
      fixedIn: target,
      vulnerability: {
        id: `${soon ? 'EOL-SOON' : 'EOL'}-${product}-${release.name}`,
        source: 'endoflife',
        aliases: [],
        summary: soon
          ? `${label} ${release.name} : fin de support le ${frDate(release.eolFrom)}`
          : `${label} ${release.name} n'est plus maintenu depuis le ${frDate(release.eolFrom)}`,
        severity: soon ? 'medium' : 'high',
        cvss: null,
        url: `https://endoflife.date/${product}`,
      },
    });
  }
  return { matches, untracked: [] };
}

/** Statut officiel du cœur WordPress : `insecure` (high) ou `outdated` (low). */
export async function queryWordPressCore(db: Db, fetcher: Fetch, components: Component[]): Promise<VulnSourceResult> {
  const cores = components.filter((c) => c.ecosystem === 'wp-core');
  if (!cores.length) return { matches: [], untracked: [] };

  const statuses: Record<string, string> = await getJson(db, fetcher, 'https://api.wordpress.org/core/stable-check/1.0/');
  const latest = Object.keys(statuses).find((v) => statuses[v] === 'latest') ?? null;
  const matches: Match[] = [];
  for (const component of cores) {
    const status = statuses[component.version];
    if (status !== 'insecure' && status !== 'outdated') continue;
    matches.push({
      component,
      fixedIn: latest,
      vulnerability: {
        id: `WP-CORE-${status.toUpperCase()}`,
        source: 'wordpress.org',
        aliases: [],
        // Identifiant partagé entre sites : le texte ne cite pas la version installée.
        summary:
          status === 'insecure'
            ? 'Version de WordPress jugée non sûre par wordpress.org : mettre à jour'
            : "Version de WordPress à jour de sécurité mais pas la dernière",
        severity: status === 'insecure' ? 'high' : 'low',
        cvss: null,
        url: 'https://wordpress.org/download/releases/',
      },
    });
  }
  return { matches, untracked: [] };
}
