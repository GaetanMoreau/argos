import type { Component } from './types.ts';
import type { HttpReport } from './web/check.ts';

const PHP_STACKS = new Set(['kirby', 'wordpress']);

/** Version de PHP annoncée par le serveur (`X-Powered-By: PHP/8.5.1`), si l'en-tête n'est pas masqué. */
export function phpFromReport(report: HttpReport | null): string | null {
  for (const leak of report?.leaks ?? []) {
    const version = leak.value.match(/PHP\/(\d+\.\d+(?:\.\d+)?)/i)?.[1];
    if (version) return version;
  }
  return null;
}

/**
 * Version de PHP retenue pour le site, par ordre de fiabilité :
 * saisie manuelle > annoncée par la production > estimée d'après composer.json (déjà dans l'inventaire).
 */
export function resolvePhp(
  components: Component[],
  stack: string[],
  { manual, production }: { manual: string | null; production: string | null },
): Component[] {
  const known = manual ? { version: manual, source: 'manual' as const } : production ? { version: production, source: 'production' as const } : null;
  const index = components.findIndex((c) => c.ecosystem === 'runtime' && c.name === 'php');
  if (!known) return components;

  const php: Component = { ecosystem: 'runtime', name: 'php', version: known.version, isDev: false, source: known.source };
  if (index >= 0) return components.map((c, i) => (i === index ? php : c));
  return stack.some((s) => PHP_STACKS.has(s)) ? [...components, php] : components;
}
