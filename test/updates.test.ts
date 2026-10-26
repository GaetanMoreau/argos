import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';
import type { Fetch } from '../src/core/http.ts';
import type { Component } from '../src/core/types.ts';
import { markDirect, withLatestVersions } from '../src/core/updates.ts';
import { updateLag } from '../src/core/version.ts';

const c = (ecosystem: Component['ecosystem'], name: string, version: string, extra: Partial<Component> = {}): Component => ({
  ecosystem,
  name,
  version,
  isDev: false,
  source: 'lockfile',
  ...extra,
});

describe('markDirect', () => {
  it('directs : package.json, composer.json, WordPress, Kirby et ses plugins ; pas les dépendances indirectes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argos-direct-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4.6.0' }, devDependencies: { gulp: '~4.0.0' } }));
    writeFileSync(join(dir, 'composer.json'), JSON.stringify({ require: { php: '>=8.2', 'tobimori/kirby-seo': '^1' } }));
    const comps = [
      c('npm', 'nuxt', '4.6.2'),
      c('npm', 'vue', '3.5.44'),
      c('npm', 'gulp', '4.0.2', { isDev: true }),
      c('npm', 'gulp', '3.9.1', { isDev: true }),
      c('packagist', 'tobimori/kirby-seo', '1.1.2'),
      c('packagist', 'getkirby/cms', '5.6.1'),
      c('packagist', 'site/plugins/maison', '1.0', { source: 'file' }),
      c('packagist', 'symfony/yaml', '7.1.0'),
      c('wp-plugin', 'akismet', '5.3', { source: 'file' }),
    ];
    const direct = (await markDirect(dir, comps)).filter((x) => x.direct).map((x) => `${x.name}@${x.version}`);
    expect(direct).toEqual([
      'nuxt@4.6.2',
      'gulp@4.0.2',
      'tobimori/kirby-seo@1.1.2',
      'getkirby/cms@5.6.1',
      'site/plugins/maison@1.0',
      'akismet@5.3',
    ]);
  });
});

describe('withLatestVersions', () => {
  const responses: Record<string, unknown> = {
    'https://registry.npmjs.org/@nuxt%2Ficon/latest': { version: '2.6.1' },
    'https://repo.packagist.org/p2/tobimori/kirby-seo.json': {
      packages: { 'tobimori/kirby-seo': [{ version: 'v2.1.0-beta.1' }, { version: 'v2.0.1' }, { version: '1.1.2' }] },
    },
    'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=akismet': { version: '5.4' },
    'https://api.wordpress.org/core/stable-check/1.0/': { '6.0': 'insecure', '7.1.3': 'latest' },
  };
  const fetcher = (async (url: string) =>
    responses[url] ? new Response(JSON.stringify(responses[url])) : new Response('{"error":"not found"}', { status: 404 })) as Fetch;

  it('npm (scope encodé), Packagist (stable seulement), wordpress.org ; inconnu = null ; indirects ignorés', async () => {
    const out = await withLatestVersions(openDb(':memory:'), fetcher, [
      c('npm', '@nuxt/icon', '2.5.1', { direct: true }),
      c('packagist', 'tobimori/kirby-seo', '1.1.2', { direct: true }),
      c('wp-plugin', 'akismet', '5.3', { direct: true }),
      c('wp-core', 'wordpress', '6.0', { direct: true }),
      c('wp-plugin', 'acf-pro', '6.0', { direct: true }),
      c('npm', 'picomatch', '2.3.1'),
    ]);
    expect(out.map((x) => x.latest)).toEqual(['2.6.1', '2.0.1', '5.4', '7.1.3', null, null]);
  });
});

describe('updateLag', () => {
  it('majeure, mineure, correctif ou à jour', () => {
    expect(updateLag('0.14.0', '1.2.0')).toBe('major');
    expect(updateLag('3.12.5', '3.15.0')).toBe('minor');
    expect(updateLag('8.4.35', '8.4.36')).toBe('patch');
    expect(updateLag('5.6.1', '5.6.1')).toBeNull();
    expect(updateLag('5.7.0', '5.6.1')).toBeNull();
    expect(updateLag('1.0', null)).toBeNull();
  });
});
