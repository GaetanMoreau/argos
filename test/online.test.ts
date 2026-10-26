import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';
import { clients, findings, sites } from '../src/core/db/schema.ts';
import type { Fetch } from '../src/core/http.ts';
import { scanSite } from '../src/core/scan.ts';
import type { HttpReport } from '../src/core/web/check.ts';
import { checkDomain, checkEmail } from '../src/core/web/domain.ts';
import { checkExposures } from '../src/core/web/exposure.ts';
import { webMatches } from '../src/core/web/findings.ts';

const ids = (report: HttpReport, now = Date.parse('2026-10-26')) =>
  webMatches(report, now).map((m) => `${m.vulnerability.id}:${m.vulnerability.severity}`);

describe('checkExposures', () => {
  const site = (pages: Record<string, { status?: number; body: string }>) =>
    (async (url: string) => {
      const page = pages[new URL(url).pathname];
      // Comme beaucoup de serveurs : 200 et une page HTML d'erreur pour une adresse inconnue.
      return page ? new Response(page.body, { status: page.status ?? 200 }) : new Response('<!doctype html><title>Introuvable</title>', { status: 200 });
    }) as Fetch;

  it('repère les vrais fichiers exposés, ignore les fausses pages 200', async () => {
    const r = await checkExposures(
      'https://a.fr/accueil',
      ['wordpress'],
      site({
        '/.git/HEAD': { body: 'ref: refs/heads/main\n' },
        '/wp-config.php~': { body: "define('DB_PASSWORD', 'secret');" },
        '/xmlrpc.php': { body: 'XML-RPC server accepts POST requests only.' },
        '/.env': { body: '<!doctype html><p>APP_KEY=dans une page</p>' },
      }),
    );
    expect(r.filter((e) => e.status === 'exposed').map((e) => `${e.id} ${e.url}`)).toEqual([
      'git https://a.fr/.git/HEAD',
      'wp-config-backup https://a.fr/wp-config.php~',
      'wp-xmlrpc https://a.fr/xmlrpc.php',
    ]);
    expect(r.find((e) => e.id === 'env')?.status).toBe('ok');
  });

  it('vérifications propres à la stack, redirection = non exposé, injoignable = inconnu', async () => {
    const redirect = (async () => new Response(null, { status: 301, headers: { location: '/' } })) as Fetch;
    const kirby = await checkExposures('https://a.fr', ['kirby'], redirect);
    expect(kirby.some((e) => e.id.startsWith('wp-'))).toBe(false);
    expect(kirby.some((e) => e.id === 'kirby-content')).toBe(true);
    expect(kirby.every((e) => e.status === 'ok')).toBe(true);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as Fetch;
    expect((await checkExposures('https://a.fr', ['nuxt'], down)).every((e) => e.status === 'unknown')).toBe(true);
  });
});

describe('checkEmail', () => {
  const resolver = (records: Record<string, string[]>, mx: boolean) => ({
    resolveTxt: async (name: string) => {
      if (!records[name]) throw Object.assign(new Error('nodata'), { code: 'ENODATA' });
      return records[name].map((r) => [r]);
    },
    resolveMx: async () => (mx ? [{ exchange: 'mx.a.fr', priority: 10 }] : []),
  });

  it('lit SPF, DMARC (politique) et DKIM parmi les sélecteurs courants', async () => {
    const e = await checkEmail(
      'a.fr',
      resolver({ 'a.fr': ['google-site-verification=x', 'v=spf1 include:_spf.google.com ~all'], '_dmarc.a.fr': ['v=DMARC1; p=quarantine; rua=mailto:x@a.fr'], 'google._domainkey.a.fr': ['v=DKIM1; k=rsa; p=MIIB'] }, true),
    );
    expect(e).toEqual({ mx: true, spf: 'v=spf1 include:_spf.google.com ~all', dmarc: { record: 'v=DMARC1; p=quarantine; rua=mailto:x@a.fr', policy: 'quarantine' }, dkim: ['google'], error: null });
  });

  it('erreur DNS réelle signalée (pas confondue avec « pas d’enregistrement »)', async () => {
    const broken = { resolveTxt: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); }, resolveMx: async () => [] };
    expect((await checkEmail('a.fr', broken)).error).toBe('DNS injoignable (ETIMEOUT)');
  });
});

describe('checkDomain', () => {
  const boot = { services: [[['fr', 'uk'], ['https://rdap.test/']]] };
  const registry = (known: Record<string, object>) =>
    (async (url: string) => {
      if (url.includes('iana.org')) return new Response(JSON.stringify(boot));
      const name = url.split('/domain/')[1];
      return known[name] ? new Response(JSON.stringify(known[name])) : new Response('{}', { status: 404 });
    }) as Fetch;
  const record = (expiration: string) => ({
    events: [{ eventAction: 'expiration', eventDate: expiration }],
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'OVH']]] }],
  });

  it('du nom le plus long au plus court : sous-domaine inconnu, puis domaine ; bbc.co.uk avant co.uk', async () => {
    const db = openDb(':memory:');
    expect(await checkDomain(db, registry({ 'site.fr': record('2027-02-06T00:00:00Z') }), 'blog.site.fr')).toEqual({
      domain: 'site.fr', expiresAt: '2027-02-06T00:00:00Z', registrar: 'OVH', error: null,
    });
    const uk = await checkDomain(openDb(':memory:'), registry({ 'bbc.co.uk': record('2034-12-13T00:00:00Z'), 'co.uk': record('2099-01-01T00:00:00Z') }), 'www.bbc.co.uk');
    expect(uk.domain).toBe('bbc.co.uk');
    expect((await checkDomain(openDb(':memory:'), registry({}), 'absent.fr')).error).toBe('Domaine inconnu du registre');
  });
});

describe('alertes en ligne', () => {
  const base: HttpReport = { url: 'https://a.fr', checkedAt: '', error: null, finalUrl: 'https://a.fr/', https: true, httpsRedirect: true };
  const domain = (expiresAt: string) => ({ domain: 'a.fr', expiresAt, registrar: 'OVH', error: null });
  const email = (mx: boolean, spf: string | null, policy: string | null) => ({ mx, spf, dmarc: policy ? { record: `v=DMARC1; p=${policy}`, policy } : null, dkim: [], error: null });

  it('fichier exposé avec sa sévérité, domaine selon l’échéance', () => {
    const exposures = [
      { id: 'env', title: '.env', severity: 'critical' as const, status: 'exposed' as const, url: 'https://a.fr/.env' },
      { id: 'git', title: 'git', severity: 'critical' as const, status: 'ok' as const, url: 'https://a.fr/.git/HEAD' },
    ];
    expect(ids({ ...base, exposures })).toEqual(['EXPOSED-ENV:critical']);
    expect(ids({ ...base, domain: domain('2026-10-01') })).toEqual(['DOMAIN-EXPIRED:critical']);
    expect(ids({ ...base, domain: domain('2026-10-30') })).toEqual(['DOMAIN-EXPIRING-7:high']);
    expect(ids({ ...base, domain: domain('2026-11-20') })).toEqual(['DOMAIN-EXPIRING-30:medium']);
    expect(ids({ ...base, domain: domain('2027-06-01') })).toEqual([]);
  });

  it('e-mail : sévérité selon que le domaine reçoit des e-mails', () => {
    const d = domain('2027-06-01');
    expect(ids({ ...base, domain: d, email: email(true, null, null) })).toEqual(['DNS-NO-SPF:medium', 'DNS-NO-DMARC:medium']);
    expect(ids({ ...base, domain: d, email: email(true, 'v=spf1 +all', 'none') })).toEqual(['DNS-SPF-PERMISSIVE:high', 'DNS-DMARC-NONE:low']);
    expect(ids({ ...base, domain: d, email: email(true, 'v=spf1 -all', 'reject') })).toEqual([]);
    expect(ids({ ...base, domain: d, email: email(false, null, null) })).toEqual(['DNS-NOMAIL-UNPROTECTED:low']);
    expect(ids({ ...base, domain: d, email: email(false, 'v=spf1 -all', 'reject') })).toEqual([]);
  });

  it('site injoignable : domaine et e-mail vérifiés quand même', () => {
    expect(ids({ url: 'https://a.fr', checkedAt: '', error: 'Site injoignable', domain: domain('2026-10-30') })).toEqual(['DOMAIN-EXPIRING-7:high']);
  });
});

describe('scan : vérification impossible = alertes conservées', () => {
  it('fichier exposé gardé ouvert si le site ne répond plus, fermé quand il est corrigé', async () => {
    const db = openDb(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'argos-online-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));
    const client = db.insert(clients).values({ name: 'A' }).returning().get();
    const site = db.insert(sites).values({ clientId: client.id, name: 's', path: dir, url: 'https://a.fr' }).returning().get();
    const fetcher = (async () => new Response(JSON.stringify({ results: [] }))) as Fetch;
    const ok: HttpReport = { url: 'https://a.fr', checkedAt: '', error: null, finalUrl: 'https://a.fr/', https: true, httpsRedirect: true };
    const env = { id: 'env', title: '.env', severity: 'critical' as const, url: 'https://a.fr/.env' };
    const status = () => db.select().from(findings).where(eq(findings.vulnerabilityId, 'EXPOSED-ENV')).get()?.status;

    await scanSite(db, site, { fetcher, httpCheck: async () => ok, onlineChecks: async () => ({ exposures: [{ ...env, status: 'exposed' }] }) });
    expect(status()).toBe('open');
    await scanSite(db, site, { fetcher, httpCheck: async () => ({ ...ok, error: 'Site injoignable', finalUrl: undefined }), onlineChecks: async () => ({}) });
    expect(status()).toBe('open');
    await scanSite(db, site, { fetcher, httpCheck: async () => ok, onlineChecks: async () => ({ exposures: [{ ...env, status: 'ok' }] }) });
    expect(status()).toBe('fixed');
  });
});
