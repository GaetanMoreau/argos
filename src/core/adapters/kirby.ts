import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonIfExists } from '../json.ts';
import { minPhpVersion, normalizeComposerVersion, parseComposerLock } from '../lockfiles/composer.ts';
import { readNpmLockfile } from '../lockfiles/npm.ts';
import type { Component, StackAdapter } from '../types.ts';

const packagist = (name: string, version: string, source: Component['source']): Component => ({
  ecosystem: 'packagist',
  name,
  version,
  isDev: false,
  source,
});

/** Plugins de `site/plugins` absents du composer.lock (installés à la main). */
async function plugins(dir: string, known: Set<string>): Promise<Component[]> {
  const root = join(dir, 'site/plugins');
  if (!existsSync(root)) return [];
  const out: Component[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const composer = await readJsonIfExists(join(root, entry.name, 'composer.json'));
    const pkg = await readJsonIfExists(join(root, entry.name, 'package.json'));
    const name = composer?.name ?? `site/plugins/${entry.name}`;
    const version = normalizeComposerVersion(composer?.version ?? pkg?.version);
    if (version && !known.has(name)) out.push(packagist(name, version, 'file'));
  }
  return out;
}

/** Version de PHP ciblée : `config.platform.php`, sinon la plus basse autorisée par `require.php`. */
function phpRuntime(composer: any): Component | null {
  const version = composer?.config?.platform?.php ?? minPhpVersion(composer?.require?.php);
  return version ? { ecosystem: 'runtime', name: 'php', version, isDev: false, source: 'file' } : null;
}

export const kirby: StackAdapter = {
  id: 'kirby',

  async detect(dir) {
    if (existsSync(join(dir, 'kirby/bootstrap.php'))) return true;
    const composer = await readJsonIfExists(join(dir, 'composer.json'));
    return Boolean(composer?.require?.['getkirby/cms']);
  },

  async inventory(dir) {
    const composer = await readJsonIfExists(join(dir, 'composer.json'));
    const out: Component[] = [];

    const lockPath = join(dir, 'composer.lock');
    if (existsSync(lockPath)) {
      out.push(...parseComposerLock(await readFile(lockPath, 'utf8')));
    }
    if (!out.some((c) => c.name === 'getkirby/cms')) {
      // Kirby copié à la main : sa version est dans kirby/composer.json.
      const core = await readJsonIfExists(join(dir, 'kirby/composer.json'));
      const version = normalizeComposerVersion(core?.version);
      if (!version) throw new Error(`Version de Kirby introuvable dans ${dir}`);
      out.push(packagist('getkirby/cms', version, 'file'));
    }

    out.push(...(await plugins(dir, new Set(out.map((c) => c.name)))));

    const runtime = phpRuntime(composer);
    if (runtime) out.push(runtime);

    // Build front éventuel : ses dépendances finissent dans les assets publiés.
    out.push(...((await readNpmLockfile(dir)) ?? []));
    return out;
  },
};
