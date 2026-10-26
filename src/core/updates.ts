import { join } from 'node:path';
import semver from 'semver';
import type { Db } from './db/index.ts';
import { getJson, mapLimit, type Fetch } from './http.ts';
import { readJsonIfExists } from './json.ts';
import type { Component } from './types.ts';
import { compareVersions } from './version.ts';

/**
 * Marque les composants choisis par le projet : dépendances de package.json et composer.json, cœur, plugins et
 * thèmes WordPress, Kirby et ses plugins. Les dépendances indirectes (des centaines sur un projet npm) restent hors
 * du suivi des mises à jour.
 */
export async function markDirect(dir: string, components: Component[]): Promise<Component[]> {
  const pkg = await readJsonIfExists(join(dir, 'package.json'));
  const composer = await readJsonIfExists(join(dir, 'composer.json'));
  const npmRanges: Record<string, string> = { ...pkg?.devDependencies, ...pkg?.dependencies };
  const packagist = new Set(Object.keys({ ...composer?.require, ...composer?.['require-dev'] }));
  return components.map((c) => ({
    ...c,
    direct:
      c.ecosystem.startsWith('wp-') ||
      (c.ecosystem === 'npm' && isDirectNpm(c, npmRanges[c.name], components)) ||
      (c.ecosystem === 'packagist' && (packagist.has(c.name) || c.name === 'getkirby/cms' || c.source === 'file')),
  }));
}

/**
 * Un paquet demandé par package.json peut aussi être installé en d'autres versions, comme dépendance d'un autre
 * paquet : seule la version qui satisfait la plage déclarée est directe (toutes, si la plage n'est pas semver).
 */
function isDirectNpm(c: Component, range: string | undefined, all: Component[]): boolean {
  if (!range) return false;
  const sameName = all.filter((o) => o.ecosystem === 'npm' && o.name === c.name);
  if (sameName.length === 1) return true;
  const matching = sameName.filter((o) => semver.satisfies(o.version, range, { loose: true, includePrerelease: true }));
  return matching.length ? matching.includes(c) : true;
}

const isStable = (v: string) => !/-(alpha|beta|rc|dev|pre)|dev-/i.test(v);

/** Dernière version stable publiée, ou `null` si la source ne connaît pas le composant. */
async function latestOf(db: Db, fetcher: Fetch, c: Component, wpLatest: string | null): Promise<string | null> {
  switch (c.ecosystem) {
    case 'npm': {
      const name = c.name.startsWith('@') ? `@${encodeURIComponent(c.name.slice(1))}` : encodeURIComponent(c.name);
      return (await getJson(db, fetcher, `https://registry.npmjs.org/${name}/latest`)).version ?? null;
    }
    case 'packagist': {
      if (!c.name.includes('/') || c.name.startsWith('site/plugins/')) return null;
      const json = await getJson(db, fetcher, `https://repo.packagist.org/p2/${c.name}.json`);
      const versions: string[] = (json.packages?.[c.name] ?? []).map((p: any) => String(p.version).replace(/^v/, ''));
      return versions.filter(isStable).sort(compareVersions).at(-1) ?? null;
    }
    case 'wp-plugin':
    case 'wp-theme': {
      const kind = c.ecosystem === 'wp-plugin' ? 'plugin' : 'theme';
      const url = `https://api.wordpress.org/${kind}s/info/1.2/?action=${kind}_information&request[slug]=${encodeURIComponent(c.name)}`;
      return (await getJson(db, fetcher, url)).version ?? null;
    }
    case 'wp-core':
      return wpLatest;
    default:
      return null;
  }
}

/** Complète `latest` sur les composants directs ; une source injoignable laisse simplement `latest` vide. */
export async function withLatestVersions(db: Db, fetcher: Fetch, components: Component[]): Promise<Component[]> {
  const wpLatest = components.some((c) => c.ecosystem === 'wp-core')
    ? await getJson(db, fetcher, 'https://api.wordpress.org/core/stable-check/1.0/')
        .then((statuses: Record<string, string>) => Object.keys(statuses).find((v) => statuses[v] === 'latest') ?? null)
        .catch(() => null)
    : null;
  const latest = await mapLimit(components, 6, (c) =>
    c.direct ? latestOf(db, fetcher, c, wpLatest).catch(() => null) : Promise.resolve(null),
  );
  return components.map((c, i) => ({ ...c, latest: latest[i] }));
}
