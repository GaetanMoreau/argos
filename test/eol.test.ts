import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';
import type { Fetch } from '../src/core/http.ts';
import type { Component } from '../src/core/types.ts';
import { findRelease, queryEndOfLife, queryWordPressCore } from '../src/core/vulns/eol.ts';

const c = (ecosystem: Component['ecosystem'], name: string, version: string, isDev = false): Component => ({
  ecosystem,
  name,
  version,
  isDev,
  source: 'file',
});

const fakeFetch = (responses: Record<string, unknown>) =>
  (async (url: string) => new Response(JSON.stringify(responses[url] ?? {}))) as Fetch;

const releases = (list: object[]) => ({ result: { releases: list } });

describe('findRelease', () => {
  const list = [{ name: '8.1' }, { name: '3' }];
  it('essaie majeure.mineure puis majeure', () => {
    expect(findRelease(list, '8.1.27')?.name).toBe('8.1');
    expect(findRelease(list, '3.21.0')?.name).toBe('3');
    expect(findRelease(list, '9.0')).toBeNull();
  });
});

describe('queryEndOfLife', () => {
  const now = Date.parse('2026-10-23');
  const fetcher = fakeFetch({
    'https://endoflife.date/api/v1/products/nuxt/': releases([
      { name: '4', isEol: false, isMaintained: true, eolFrom: null, latest: { name: '4.6.2' } },
      { name: '3', isEol: true, isMaintained: false, eolFrom: '2026-07-31' },
    ]),
    'https://endoflife.date/api/v1/products/kirby/': releases([
      { name: '5', isEol: false, isMaintained: true, eolFrom: null, latest: { name: '5.6.1' } },
      { name: '4', isEol: false, isMaintained: true, eolFrom: '2026-11-28' },
    ]),
    'https://endoflife.date/api/v1/products/nodejs/': releases([
      { name: '24', isEol: false, isMaintained: true, eolFrom: '2028-04-30', latest: { name: '24.22.1' } },
    ]),
  });

  it('signale les branches terminées, bientôt terminées, et ignore le reste', async () => {
    const { matches } = await queryEndOfLife(
      openDb(':memory:'),
      fetcher,
      [
        c('npm', 'nuxt', '3.13.0'),
        c('packagist', 'getkirby/cms', '4.3.0'),
        c('runtime', 'nodejs', '24'),
        c('npm', 'nuxt', '3.0.0', true), // dev : ignoré
        c('npm', 'lodash', '4.17.21'),
      ],
      now,
    );
    expect(matches.map((m) => [m.vulnerability.id, m.vulnerability.severity, m.fixedIn])).toEqual([
      ['EOL-nuxt-3', 'high', '4.6.2'],
      ['EOL-SOON-kirby-4', 'medium', '5.6.1'],
    ]);
    expect(matches[1].vulnerability.summary).toBe('Kirby 4 : fin de support le 28/11/2026');
  });
});

describe('queryWordPressCore', () => {
  const fetcher = fakeFetch({
    'https://api.wordpress.org/core/stable-check/1.0/': { '6.0': 'insecure', '7.1.2': 'outdated', '7.1.3': 'latest' },
  });

  it('traduit le statut officiel', async () => {
    const { matches } = await queryWordPressCore(openDb(':memory:'), fetcher, [
      c('wp-core', 'wordpress', '6.0'),
      c('wp-core', 'wordpress', '7.1.2'),
      c('wp-core', 'wordpress', '7.1.3'),
    ]);
    expect(matches.map((m) => [m.component.version, m.vulnerability.id, m.vulnerability.severity, m.fixedIn])).toEqual([
      ['6.0', 'WP-CORE-INSECURE', 'high', '7.1.3'],
      ['7.1.2', 'WP-CORE-OUTDATED', 'low', '7.1.3'],
    ]);
  });
});
