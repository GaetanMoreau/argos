import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';
import { findings, scans, vulnerabilities } from '../src/core/db/schema.ts';
import { siteMaintenanceReport } from '../src/core/report.ts';
import { createClient, createSite } from '../src/core/sites.ts';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

async function setup(vulns: { id: string; severity: 'critical' | 'high' | 'medium' | 'low'; summary: string; isKev?: boolean }[], rows: {
  vulnId: string;
  component: string;
  ecosystem?: string;
  status?: 'open' | 'fixed' | 'ignored';
  fixedIn?: string;
  isDev?: boolean;
  lastSeen?: Date;
}[]) {
  const db = openDb(':memory:');
  const client = createClient(db, 'Atelier');
  const { site } = await createSite(db, { clientId: client.id, path: mkdtempSync(join(tmpdir(), 'argos-report-')), url: 'a.fr' });
  db.insert(scans).values({ siteId: site.id, status: 'ok' }).run();
  db.insert(vulnerabilities).values(vulns.map((v) => ({ ...v, source: 'osv' }))).run();
  db.insert(findings)
    .values(rows.map((r) => ({
      siteId: site.id,
      ecosystem: r.ecosystem ?? 'packagist',
      componentName: r.component,
      version: '1.0',
      vulnerabilityId: r.vulnId,
      status: r.status ?? 'open',
      fixedIn: r.fixedIn ?? null,
      isDev: r.isDev ?? false,
      lastSeenAt: r.lastSeen ?? daysAgo(0),
    })))
    .run();
  return { db, siteId: site.id };
}

describe('siteMaintenanceReport', () => {
  it('regroupe les failles par composant, ordonne les recommandations, ignore le dev', async () => {
    const { db, siteId } = await setup(
      [
        { id: 'GHSA-1', severity: 'critical', summary: 'RCE' },
        { id: 'GHSA-2', severity: 'high', summary: 'XSS' },
        { id: 'GHSA-3', severity: 'high', summary: 'outil de build' },
        { id: 'TLS-EXPIRING-30', severity: 'medium', summary: 'Certificat TLS expirant dans moins de 30 jours' },
        { id: 'EOL-SOON-kirby-4', severity: 'medium', summary: 'Kirby 4 : fin de support le 28/11/2026' },
        { id: 'WEB-NO-HTTPS-REDIRECT', severity: 'medium', summary: 'http:// ne redirige pas vers https://' },
        { id: 'EXPOSED-COMPOSER', severity: 'low', summary: 'composer.json public' },
      ],
      [
        { vulnId: 'GHSA-1', component: 'getkirby/cms', fixedIn: '4.9.0' },
        { vulnId: 'GHSA-2', component: 'getkirby/cms', fixedIn: '4.9.5' },
        { vulnId: 'GHSA-3', component: 'gulp', ecosystem: 'npm', isDev: true },
        { vulnId: 'TLS-EXPIRING-30', component: 'a.fr', ecosystem: 'web' },
        { vulnId: 'EOL-SOON-kirby-4', component: 'getkirby/cms' },
        { vulnId: 'WEB-NO-HTTPS-REDIRECT', component: 'a.fr', ecosystem: 'web' },
        { vulnId: 'EXPOSED-COMPOSER', component: 'a.fr', ecosystem: 'web' },
      ],
    );
    const { site } = siteMaintenanceReport(db, siteId, 30, NOW)!;
    expect(site.recommendations).toEqual([
      'Certificat TLS expirant dans moins de 30 jours',
      'Mettre à jour Kirby vers 4.9.5 : 2 failles de sécurité corrigées',
      'Kirby 4 : fin de support le 28/11/2026',
      'Rediriger automatiquement http:// vers https://',
      'Bloquer l’accès : composer.json public',
    ]);
    expect(site.open).toMatchObject({ total: 6, urgent: 2 });
  });

  it('composant hors support ou « non sûr » : pas de ligne de faille en double', async () => {
    const { db, siteId } = await setup(
      [
        { id: 'CVE-1', severity: 'high', summary: 'XSS' },
        { id: 'WP-CORE-INSECURE', severity: 'high', summary: 'Version de WordPress jugée non sûre par wordpress.org : mettre à jour' },
      ],
      [
        { vulnId: 'CVE-1', component: 'wordpress', ecosystem: 'wp-core' },
        { vulnId: 'WP-CORE-INSECURE', component: 'wordpress', ecosystem: 'wp-core' },
      ],
    );
    expect(siteMaintenanceReport(db, siteId, 30, NOW)!.site.recommendations).toEqual([
      'Version de WordPress jugée non sûre par wordpress.org : mettre à jour',
    ]);
  });

  it('corrections : seulement celles de la période, noms parlants', async () => {
    const { db, siteId } = await setup(
      [{ id: 'GHSA-1', severity: 'high', summary: 'RCE' }, { id: 'GHSA-2', severity: 'low', summary: 'ancienne' }],
      [
        { vulnId: 'GHSA-1', component: 'getkirby/cms', status: 'fixed', lastSeen: daysAgo(3) },
        { vulnId: 'GHSA-2', component: 'gsap', ecosystem: 'npm', status: 'fixed', lastSeen: daysAgo(60) },
      ],
    );
    const r = siteMaintenanceReport(db, siteId, 30, NOW)!;
    expect(r.client.name).toBe('Atelier');
    expect(r.site.fixed).toEqual({ total: 1, items: [{ component: 'Kirby', summary: 'RCE', severity: 'high' }] });
    expect(siteMaintenanceReport(db, siteId, 90, NOW)!.site.fixed.total).toBe(2);
    expect(siteMaintenanceReport(db, 999)).toBeNull();
  });
});
