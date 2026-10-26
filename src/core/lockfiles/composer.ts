import { dedupe, type Component } from '../types.ts';

/** Version utilisable (`v1.2.3` → `1.2.3`) ; `null` pour une branche (`dev-main`, `1.x-dev`). */
export function normalizeComposerVersion(version: string | undefined): string | null {
  if (!version || version.startsWith('dev-') || version.endsWith('-dev')) return null;
  return version.replace(/^v/, '');
}

/** composer.lock : `packages` (prod) et `packages-dev`. */
export function parseComposerLock(text: string): Component[] {
  const lock = JSON.parse(text);
  const out: Component[] = [];
  for (const [group, isDev] of [['packages', false], ['packages-dev', true]] as const) {
    for (const pkg of lock[group] ?? []) {
      const version = normalizeComposerVersion(pkg.version);
      if (version) out.push({ ecosystem: 'packagist', name: pkg.name, version, isDev, source: 'lockfile' });
    }
  }
  return dedupe(out);
}

/** Plus petite version satisfaisant une contrainte PHP (`^8.1 || ^8.2` → `8.1`). */
export function minPhpVersion(constraint: string | undefined): string | null {
  const versions = constraint?.match(/\d+\.\d+(\.\d+)?/g);
  if (!versions) return null;
  return versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
}
