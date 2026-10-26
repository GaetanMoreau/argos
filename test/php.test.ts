import { describe, expect, it } from 'vitest';
import { phpFromReport, resolvePhp } from '../src/core/php.ts';
import type { Component } from '../src/core/types.ts';
import type { HttpReport } from '../src/core/web/check.ts';

const estimated: Component = { ecosystem: 'runtime', name: 'php', version: '8.2', isDev: false, source: 'file' };
const kirby: Component = { ecosystem: 'packagist', name: 'getkirby/cms', version: '4.3.0', isDev: false, source: 'lockfile' };
const php = (cs: Component[]) => cs.find((c) => c.name === 'php');

describe('phpFromReport', () => {
  it('lit X-Powered-By, ignore les autres fuites', () => {
    const report = (leaks: { header: string; value: string }[]) => ({ url: '', checkedAt: '', error: null, leaks }) as HttpReport;
    expect(phpFromReport(report([{ header: 'Server', value: 'Apache/2.4' }, { header: 'X-Powered-By', value: 'PHP/8.5.1' }]))).toBe('8.5.1');
    expect(phpFromReport(report([{ header: 'X-Powered-By', value: 'Nuxt' }]))).toBeNull();
    expect(phpFromReport(null)).toBeNull();
  });
});

describe('resolvePhp', () => {
  it('saisie > production > estimation', () => {
    expect(php(resolvePhp([kirby, estimated], ['kirby'], { manual: '8.5', production: '8.4.3' }))).toMatchObject({ version: '8.5', source: 'manual' });
    expect(php(resolvePhp([kirby, estimated], ['kirby'], { manual: null, production: '8.4.3' }))).toMatchObject({ version: '8.4.3', source: 'production' });
    expect(php(resolvePhp([kirby, estimated], ['kirby'], { manual: null, production: null }))).toEqual(estimated);
  });

  it('ajoute PHP aux sites WordPress (aucune estimation possible) mais pas aux sites Nuxt', () => {
    expect(php(resolvePhp([], ['wordpress'], { manual: '8.3', production: null }))).toMatchObject({ version: '8.3' });
    expect(php(resolvePhp([], ['nuxt'], { manual: '8.3', production: null }))).toBeUndefined();
  });
});
