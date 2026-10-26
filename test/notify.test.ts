import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';
import { vulnerabilities } from '../src/core/db/schema.ts';
import { buildReport } from '../src/core/notify.ts';
import type { ScanResult } from '../src/core/scan.ts';
import { buildPlist } from '../src/core/schedule.ts';

describe('buildReport', () => {
  const db = openDb(':memory:');
  db.insert(vulnerabilities)
    .values([
      { id: 'CRIT', source: 'osv', severity: 'critical', summary: 'RCE' },
      { id: 'MED', source: 'osv', severity: 'medium', summary: 'XSS' },
      { id: 'KEV', source: 'osv', severity: 'medium', summary: 'Exploitée', isKev: true },
      { id: 'DEV', source: 'osv', severity: 'critical', summary: 'Outil de build' },
    ])
    .run();

  const finding = (vulnerabilityId: string, componentName: string, isDev = false) =>
    ({ vulnerabilityId, componentName, version: '1.0', isDev, fixedIn: '1.1' }) as ScanResult['opened'][number];
  const result = (name: string, opened: ScanResult['opened'], error?: string) =>
    ({ site: { name }, opened, error, components: 1, untracked: 0, fixed: 0 }) as ScanResult;

  it('sépare urgences (critical/high/KEV hors dev) et résumé', () => {
    const report = buildReport(db, [
      result('site-a', [finding('MED', 'a'), finding('CRIT', 'b'), finding('DEV', 'vite', true)]),
      result('site-b', [finding('KEV', 'c')]),
      result('site-c', [], 'Aucune stack reconnue'),
    ]);
    expect(report.urgent?.title).toBe('⚠ 2 alerte(s) urgente(s)');
    expect(report.urgent?.body).toBe(
      '[EXPLOITÉE] site-b · c@1.0 → 1.1\n   Exploitée\n[critical] site-a · b@1.0 → 1.1\n   RCE',
    );
    expect(report.urgent?.short).toBe('site-b, site-a\nExploitée');
    expect(report.digest?.short).toBe('2 nouveauté(s) : site-a\n1 site(s) en erreur');
    expect(report.digest?.body).toContain('[ERREUR] site-c : Aucune stack reconnue');
  });

  it('rien à signaler → aucun message', () => {
    expect(buildReport(db, [result('site-a', [])])).toEqual({ urgent: null, digest: null });
  });
});

describe('buildPlist', () => {
  it('planifie `scan --notify` à l’heure demandée', () => {
    const plist = buildPlist(7, 30);
    expect(plist).toContain('<string>scan</string>\n    <string>--notify</string>');
    expect(plist).toMatch(/<key>Hour<\/key>\s*<integer>7<\/integer>\s*<key>Minute<\/key>\s*<integer>30<\/integer>/);
  });
});
