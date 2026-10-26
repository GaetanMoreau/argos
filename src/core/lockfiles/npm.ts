import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { dedupe, type Component } from '../types.ts';

const npm = (name: string, version: string, isDev: boolean): Component => ({
  ecosystem: 'npm',
  name,
  version,
  isDev,
  source: 'lockfile',
});

/** package-lock.json (v1, v2, v3). */
export function parsePackageLock(text: string): Component[] {
  const lock = JSON.parse(text);
  const out: Component[] = [];

  if (lock.packages) {
    for (const [path, entry] of Object.entries<any>(lock.packages)) {
      if (!path || entry.link || !entry.version) continue;
      const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      out.push(npm(name, entry.version, Boolean(entry.dev || entry.devOptional)));
    }
  } else {
    const walk = (deps: Record<string, any> = {}) => {
      for (const [name, entry] of Object.entries(deps)) {
        if (entry.version && !entry.version.startsWith('file:')) out.push(npm(name, entry.version, Boolean(entry.dev)));
        walk(entry.dependencies);
      }
    };
    walk(lock.dependencies);
  }
  return dedupe(out);
}

/** Découpe une clé pnpm (`/@scope/a@1.0.0(peer@2)`, `a@1.0.0`, `/a/1.0.0`) en nom et version. */
function splitPnpmKey(key: string): { name: string; version: string } | null {
  const clean = key.replace(/^\//, '').replace(/\(.*$/, '');
  const at = clean.indexOf('@', 1);
  if (at > 0) return { name: clean.slice(0, at), version: clean.slice(at + 1) };
  const slash = clean.lastIndexOf('/');
  return slash > 0 ? { name: clean.slice(0, slash), version: clean.slice(slash + 1) } : null;
}

/** pnpm-lock.yaml (v5 à v9). */
export function parsePnpmLock(text: string): Component[] {
  const lock = parseYaml(text) ?? {};
  const packages: Record<string, any> = lock.packages ?? {};
  const keys = Object.keys(packages);

  // Avant v9, chaque paquet porte son propre flag `dev`.
  if (keys.some((k) => typeof packages[k]?.dev === 'boolean')) {
    return dedupe(
      keys.flatMap((k) => {
        const p = splitPnpmKey(k);
        return p ? [npm(p.name, p.version, packages[k].dev === true)] : [];
      }),
    );
  }

  // v9 : on recalcule ce qui est atteignable depuis les dépendances de prod.
  const snapshots: Record<string, any> = lock.snapshots ?? {};
  const depKey = (name: string, version: string): string | null => {
    if (version.startsWith('link:') || version.startsWith('file:')) return null;
    return /^\d/.test(version) ? `${name}@${version}` : version; // sinon alias `vrai-nom@1.0.0`
  };
  const prod = new Set<string>();
  const stack: string[] = [];
  for (const importer of Object.values<any>(lock.importers ?? {})) {
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const [name, dep] of Object.entries<any>(importer[group] ?? {})) {
        const k = depKey(name, typeof dep === 'string' ? dep : dep.version);
        if (k) stack.push(k);
      }
    }
  }
  while (stack.length) {
    const k = stack.pop()!;
    if (prod.has(k)) continue;
    prod.add(k);
    const snap = snapshots[k] ?? {};
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries<string>(snap[group] ?? {})) {
        const next = depKey(name, version);
        if (next) stack.push(next);
      }
    }
  }
  const prodBase = new Set([...prod].map((k) => k.replace(/\(.*$/, '')));

  return dedupe(
    keys.flatMap((k) => {
      const p = splitPnpmKey(k);
      return p ? [npm(p.name, p.version, !prodBase.has(`${p.name}@${p.version}`))] : [];
    }),
  );
}

/** yarn.lock (classic et berry). Yarn n'indique pas les dépendances de dev : tout est considéré prod. */
export function parseYarnLock(text: string): Component[] {
  const out: Component[] = [];
  let name: string | null = null;
  for (const line of text.split('\n')) {
    if (/^\S.*:$/.test(line) && !line.startsWith('#') && !line.startsWith('__metadata')) {
      const firstSpec = line.slice(0, -1).split(',')[0].trim().replace(/^"|"$/g, '');
      name = firstSpec.slice(0, firstSpec.indexOf('@', 1));
    } else if (name) {
      const m = line.match(/^ {2}version:? "?([^"\s]+)"?/);
      if (m) {
        if (!m[1].includes('use.local')) out.push(npm(name, m[1], false));
        name = null;
      }
    }
  }
  return dedupe(out);
}

/** Lit le premier lockfile trouvé dans le dossier, ou `null` s'il n'y en a pas. */
export async function readNpmLockfile(dir: string): Promise<Component[] | null> {
  const parsers: [string, (text: string) => Component[]][] = [
    ['pnpm-lock.yaml', parsePnpmLock],
    ['package-lock.json', parsePackageLock],
    ['yarn.lock', parseYarnLock],
  ];
  for (const [file, parse] of parsers) {
    const path = join(dir, file);
    if (existsSync(path)) return parse(await readFile(path, 'utf8'));
  }
  return null;
}
