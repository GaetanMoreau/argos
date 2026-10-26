import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db/index.ts';
import { createClient, createSite, deleteSite, expandPath, InputError, inspectPath, updateSite } from '../src/core/sites.ts';

describe('expandPath', () => {
  it('développe ~ et rend le chemin absolu', () => {
    expect(expandPath('~/Sites/a')).toBe(join(homedir(), 'Sites/a'));
    expect(expandPath('~')).toBe(homedir());
    expect(expandPath('  /tmp/x  ')).toBe('/tmp/x');
  });
});

describe('clients et sites', () => {
  let db: Db;
  let root: string;
  let project: string;

  beforeEach(() => {
    db = openDb(':memory:');
    root = mkdtempSync(join(tmpdir(), 'argos-sites-'));
    project = join(root, 'boutique');
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4' } }));
    mkdirSync(join(root, 'brouillon'));
  });

  it('refuse un client vide ou en double', () => {
    createClient(db, 'Atelier');
    expect(() => createClient(db, '  ')).toThrow(InputError);
    expect(() => createClient(db, 'Atelier')).toThrow(/existe déjà/);
  });

  it('crée un site : nom par défaut, URL complétée, stack détectée, doublon refusé', async () => {
    const client = createClient(db, 'Atelier');
    const { site, stack } = await createSite(db, { clientId: client.id, path: project, url: 'boutique.fr' });
    expect(site).toMatchObject({ name: 'boutique', url: 'https://boutique.fr', stack: 'nuxt' });
    expect(stack).toEqual(['nuxt']);
    await expect(createSite(db, { clientId: client.id, path: project })).rejects.toThrow(/déjà suivi/);
    await expect(createSite(db, { clientId: client.id, path: join(root, 'absent') })).rejects.toThrow(/introuvable/);
  });

  it('inspecte un chemin en cours de saisie et suggère les sous-dossiers', async () => {
    const partial = await inspectPath(db, join(root, 'bo'));
    expect(partial.exists).toBe(false);
    expect(partial.suggestions).toEqual([project]);

    const full = await inspectPath(db, `${root}/`);
    expect(full.suggestions.sort()).toEqual([join(root, 'boutique'), join(root, 'brouillon')]);

    const target = await inspectPath(db, project);
    expect(target).toMatchObject({ exists: true, stack: ['nuxt'], registered: false });
  });
});

describe('modification de site', () => {
  it('normalise et valide l’URL, vide = aucune URL', async () => {
    const db = openDb(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'argos-upd-'));
    const client = createClient(db, 'A');
    const { site } = await createSite(db, { clientId: client.id, path: dir });
    expect(updateSite(db, site.id, { url: 'mon-site.fr' }).url).toBe('https://mon-site.fr');
    expect(updateSite(db, site.id, { url: '' }).url).toBeNull();
    expect(() => updateSite(db, site.id, { url: 'pas une url' })).toThrow(/URL invalide/);
    expect(() => updateSite(db, 999, { hosting: 'x' })).toThrow(/introuvable/);
  });
});

describe('suppression de site', () => {
  it('efface le site et ses données, garde le client, les autres sites et les failles partagées', async () => {
    const { findings, httpChecks, scans, sites, vulnerabilities, clients, components } = await import('../src/core/db/schema.ts');
    const db = openDb(':memory:');
    const client = createClient(db, 'A');
    const [a, b] = await Promise.all(
      ['a', 'b'].map(async (n) => (await createSite(db, { clientId: client.id, path: mkdtempSync(join(tmpdir(), `argos-del-${n}-`)) })).site),
    );
    db.insert(vulnerabilities).values({ id: 'GHSA-1', source: 'osv', severity: 'high' }).run();
    for (const site of [a, b]) {
      const scan = db.insert(scans).values({ siteId: site.id, status: 'ok' }).returning().get();
      db.insert(components).values({ scanId: scan.id, ecosystem: 'npm', name: 'x', version: '1', source: 'lockfile' }).run();
      db.insert(findings).values({ siteId: site.id, ecosystem: 'npm', componentName: 'x', version: '1', vulnerabilityId: 'GHSA-1' }).run();
      db.insert(httpChecks).values({ siteId: site.id, scanId: scan.id, report: '{}' }).run();
    }

    expect(deleteSite(db, a.id)).toMatchObject({ scans: 1, findings: 1 });
    expect(db.select().from(sites).all().map((s) => s.id)).toEqual([b.id]);
    expect(db.select().from(scans).all()).toHaveLength(1);
    expect(db.select().from(components).all()).toHaveLength(1);
    expect(db.select().from(findings).all()).toHaveLength(1);
    expect(db.select().from(httpChecks).all()).toHaveLength(1);
    expect(db.select().from(vulnerabilities).all()).toHaveLength(1);
    expect(db.select().from(clients).all()).toHaveLength(1);
    expect(() => deleteSite(db, a.id)).toThrow(/introuvable/);
  });
});

describe('version de PHP', () => {
  it('valide la saisie, vide = retour à l’estimation', async () => {
    const { normalizePhpVersion } = await import('../src/core/sites.ts');
    expect(normalizePhpVersion('8.5')).toBe('8.5');
    expect(normalizePhpVersion(' PHP 8.5.1 ')).toBe('8.5.1');
    expect(normalizePhpVersion('')).toBeNull();
    expect(() => normalizePhpVersion('huit')).toThrow(/invalide/);
  });
});
