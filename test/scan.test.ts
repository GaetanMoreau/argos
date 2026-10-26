import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db/index.ts';
import { clients, findings, sites, vulnerabilities } from '../src/core/db/schema.ts';
import type { Fetch } from '../src/core/http.ts';
import { scanSite } from '../src/core/scan.ts';

/** Faux OSV : `vulnerable` associe `nom@version` à des identifiants de failles. */
function fakeOsv(vulnerable: Record<string, string[]>): Fetch {
  return (async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (url.endsWith('/querybatch')) {
      const { queries } = JSON.parse(String(init?.body));
      return json({
        results: queries.map((q: any) => ({ vulns: (vulnerable[`${q.package.name}@${q.version}`] ?? []).map((id) => ({ id })) })),
      });
    }
    const id = url.split('/').pop()!;
    return json({
      id,
      summary: `Faille ${id}`,
      database_specific: { severity: 'HIGH' },
      affected: [{ package: { ecosystem: 'npm', name: 'nuxt' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '3.12.4' }] }] }],
    });
  }) as Fetch;
}

function writeProject(dir: string, nuxtVersion: string) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^3' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/nuxt': { version: nuxtVersion } } }),
  );
}

describe('scanSite', () => {
  let db: Db;
  let dir: string;
  let site: typeof sites.$inferSelect;

  beforeEach(() => {
    db = openDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'argos-'));
    const client = db.insert(clients).values({ name: 'Moi' }).returning().get();
    site = db.insert(sites).values({ clientId: client.id, name: 'site', path: dir }).returning().get();
  });

  it('ouvre, conserve puis ferme une faille au fil des scans', async () => {
    const fetcher = fakeOsv({ 'nuxt@3.10.0': ['GHSA-1'] });

    writeProject(dir, '3.10.0');
    const first = await scanSite(db, site, { fetcher });
    expect(first.error).toBeUndefined();
    expect(first.opened.map((f) => [f.componentName, f.vulnerabilityId, f.fixedIn])).toEqual([['nuxt', 'GHSA-1', '3.12.4']]);
    expect(db.select().from(sites).where(eq(sites.id, site.id)).get()?.stack).toBe('nuxt');

    const second = await scanSite(db, site, { fetcher });
    expect(second.opened).toEqual([]);

    writeProject(dir, '3.12.4');
    const third = await scanSite(db, site, { fetcher });
    expect(third.fixed).toBe(1);
    expect(db.select().from(findings).get()?.status).toBe('fixed');
  });

  it('ne ré-alerte pas une faille ignorée, ré-alerte une faille réapparue', async () => {
    const fetcher = fakeOsv({ 'nuxt@3.10.0': ['GHSA-1', 'GHSA-2'] });
    writeProject(dir, '3.10.0');
    await scanSite(db, site, { fetcher });
    db.update(findings).set({ status: 'ignored', note: 'pas exposé' }).where(eq(findings.vulnerabilityId, 'GHSA-1')).run();
    db.update(findings).set({ status: 'fixed' }).where(eq(findings.vulnerabilityId, 'GHSA-2')).run();

    const again = await scanSite(db, site, { fetcher });
    expect(again.opened.map((f) => f.vulnerabilityId)).toEqual(['GHSA-2']);
    expect(db.select().from(findings).where(eq(findings.vulnerabilityId, 'GHSA-1')).get()?.status).toBe('ignored');
  });

  it('marque les failles présentes dans le catalogue CISA KEV via leurs alias', async () => {
    const osv = fakeOsv({ 'nuxt@3.10.0': ['GHSA-1'] });
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes('cisa.gov')) return new Response(JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-1' }] }));
      const res = await osv(url, init);
      if (!url.includes('/vulns/')) return res;
      return new Response(JSON.stringify({ ...(await res.json()), aliases: ['CVE-2024-1'] }));
    }) as Fetch;
    writeProject(dir, '3.10.0');
    await scanSite(db, site, { fetcher });
    expect(db.select().from(vulnerabilities).where(eq(vulnerabilities.id, 'GHSA-1')).get()?.isKev).toBe(true);
  });

  it('enregistre l’erreur sans toucher aux failles', async () => {
    const result = await scanSite(db, site, { fetcher: fakeOsv({}) });
    expect(result.error).toMatch(/Aucune stack reconnue/);
  });
});
