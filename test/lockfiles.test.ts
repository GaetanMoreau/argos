import { describe, expect, it } from 'vitest';
import { parsePackageLock, parsePnpmLock, parseYarnLock } from '../src/core/lockfiles/npm.ts';

const pick = (cs: { name: string; version: string; isDev: boolean }[]) =>
  cs.map(({ name, version, isDev }) => ({ name, version, isDev })).sort((a, b) => a.name.localeCompare(b.name));

describe('parsePackageLock', () => {
  it('lit le format v3 (scopes, imbrication, dev, liens ignorés)', () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'site', version: '1.0.0' },
        'node_modules/nuxt': { version: '3.13.0' },
        'node_modules/@vue/shared': { version: '3.5.0' },
        'node_modules/vitest': { version: '2.0.0', dev: true },
        'node_modules/nuxt/node_modules/ufo': { version: '1.5.0' },
        'node_modules/local': { resolved: 'packages/local', link: true },
      },
    };
    expect(pick(parsePackageLock(JSON.stringify(lock)))).toEqual([
      { name: '@vue/shared', version: '3.5.0', isDev: false },
      { name: 'nuxt', version: '3.13.0', isDev: false },
      { name: 'ufo', version: '1.5.0', isDev: false },
      { name: 'vitest', version: '2.0.0', isDev: true },
    ]);
  });

  it('lit le format v1', () => {
    const lock = {
      lockfileVersion: 1,
      dependencies: {
        vue: { version: '2.7.0', dependencies: { '@vue/compiler-sfc': { version: '2.7.0' } } },
        jest: { version: '29.0.0', dev: true },
      },
    };
    expect(pick(parsePackageLock(JSON.stringify(lock)))).toEqual([
      { name: '@vue/compiler-sfc', version: '2.7.0', isDev: false },
      { name: 'jest', version: '29.0.0', isDev: true },
      { name: 'vue', version: '2.7.0', isDev: false },
    ]);
  });
});

describe('parsePnpmLock', () => {
  it('v9 : déduit dev/prod du graphe', () => {
    const lock = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      nuxt:
        specifier: ^3.13.0
        version: 3.13.0(vue@3.5.0)
    devDependencies:
      vitest:
        specifier: ^2.0.0
        version: 2.0.0
packages:
  nuxt@3.13.0:
    resolution: {integrity: sha512-x}
  vue@3.5.0:
    resolution: {integrity: sha512-x}
  '@vue/shared@3.5.0':
    resolution: {integrity: sha512-x}
  vitest@2.0.0:
    resolution: {integrity: sha512-x}
  tinyspy@3.0.0:
    resolution: {integrity: sha512-x}
snapshots:
  nuxt@3.13.0(vue@3.5.0):
    dependencies:
      vue: 3.5.0
  vue@3.5.0:
    dependencies:
      '@vue/shared': 3.5.0
  '@vue/shared@3.5.0': {}
  vitest@2.0.0:
    dependencies:
      tinyspy: 3.0.0
  tinyspy@3.0.0: {}
`;
    expect(pick(parsePnpmLock(lock))).toEqual([
      { name: '@vue/shared', version: '3.5.0', isDev: false },
      { name: 'nuxt', version: '3.13.0', isDev: false },
      { name: 'tinyspy', version: '3.0.0', isDev: true },
      { name: 'vitest', version: '2.0.0', isDev: true },
      { name: 'vue', version: '3.5.0', isDev: false },
    ]);
  });

  it('v6 : utilise le flag dev', () => {
    const lock = `
lockfileVersion: '6.0'
packages:
  /nuxt@3.8.0(vue@3.3.0):
    dev: false
  /@types/node@20.0.0:
    dev: true
`;
    expect(pick(parsePnpmLock(lock))).toEqual([
      { name: '@types/node', version: '20.0.0', isDev: true },
      { name: 'nuxt', version: '3.8.0', isDev: false },
    ]);
  });
});

describe('parseYarnLock', () => {
  it('lit yarn classic', () => {
    const lock = `# yarn lockfile v1

"@vue/shared@^3.5.0", "@vue/shared@3.5.0":
  version "3.5.0"
  resolved "https://registry.yarnpkg.com/x"

nuxt@^3.13.0:
  version "3.13.0"
`;
    expect(pick(parseYarnLock(lock))).toEqual([
      { name: '@vue/shared', version: '3.5.0', isDev: false },
      { name: 'nuxt', version: '3.13.0', isDev: false },
    ]);
  });

  it('lit yarn berry et ignore le projet local', () => {
    const lock = `__metadata:
  version: 8

"nuxt@npm:^3.13.0":
  version: 3.13.0
  resolution: "nuxt@npm:3.13.0"

"site@workspace:.":
  version: 0.0.0-use.local
`;
    expect(pick(parseYarnLock(lock))).toEqual([{ name: 'nuxt', version: '3.13.0', isDev: false }]);
  });
});
