import { describe, expect, it } from 'vitest';
import type { Component } from '../src/core/types.ts';
import { fixedVersion } from '../src/core/vulns/osv.ts';

const comp = (version: string): Component => ({ ecosystem: 'npm', name: 'nuxt', version, isDev: false, source: 'lockfile' });

const osv = {
  affected: [
    { package: { ecosystem: 'npm', name: 'other' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '9.9.9' }] }] },
    {
      package: { ecosystem: 'npm', name: 'nuxt' },
      ranges: [
        {
          type: 'SEMVER',
          events: [{ introduced: '3.0.0' }, { fixed: '3.12.4' }, { introduced: '4.0.0' }, { fixed: '4.1.1' }],
        },
      ],
    },
  ],
};

describe('fixedVersion', () => {
  it('renvoie la correction de l’intervalle qui contient la version', () => {
    expect(fixedVersion(osv, comp('3.5.0'))).toBe('3.12.4');
    expect(fixedVersion(osv, comp('4.0.2'))).toBe('4.1.1');
  });

  it('ignore les autres paquets', () => {
    expect(fixedVersion(osv, { ...comp('1.0.0'), name: 'absent' })).toBeNull();
  });
});
