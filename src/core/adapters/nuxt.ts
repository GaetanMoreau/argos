import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonIfExists } from '../json.ts';
import { readNpmLockfile } from '../lockfiles/npm.ts';
import type { Component, StackAdapter } from '../types.ts';

/** Version de Node demandée par le projet (.nvmrc, .node-version, puis engines.node). */
async function nodeRuntime(dir: string, pkg: any): Promise<Component | null> {
  let raw: string | undefined;
  for (const file of ['.nvmrc', '.node-version']) {
    const path = join(dir, file);
    if (existsSync(path)) {
      raw = (await readFile(path, 'utf8')).trim();
      break;
    }
  }
  raw ??= pkg.engines?.node;
  const version = raw?.match(/\d+(\.\d+){0,2}/)?.[0];
  return version ? { ecosystem: 'runtime', name: 'nodejs', version, isDev: false, source: 'file' } : null;
}

export const nuxt: StackAdapter = {
  id: 'nuxt',

  async detect(dir) {
    const pkg = await readJsonIfExists(join(dir, 'package.json'));
    return Boolean(pkg?.dependencies?.nuxt || pkg?.devDependencies?.nuxt);
  },

  async inventory(dir) {
    const pkg = await readJsonIfExists(join(dir, 'package.json'));
    const components = await readNpmLockfile(dir);
    if (!components) throw new Error(`Aucun lockfile npm/pnpm/yarn dans ${dir}`);
    const runtime = await nodeRuntime(dir, pkg);
    return runtime ? [...components, runtime] : components;
  },
};
