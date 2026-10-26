import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';
import { clients, findings, httpChecks, sites } from '../src/core/db/schema.ts';
import type { Fetch } from '../src/core/http.ts';
import { scanSite } from '../src/core/scan.ts';
import { analyzeResponse, detectTech } from '../src/core/web/analyze.ts';
import { runHttpCheck, type HttpReport } from '../src/core/web/check.ts';
import { webMatches } from '../src/core/web/findings.ts';

const STRONG = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=()',
};

describe('analyzeResponse', () => {
  it('A+ : tous les en-têtes, sans avertissement ni fuite (frame-ancestors couvre X-Frame-Options)', () => {
    const a = analyzeResponse({ headers: STRONG, body: '', https: true });
    expect(a.grade).toBe('A+');
    expect(a.headers.find((h) => h.id === 'xfo')?.status).toBe('ok');
  });

  it('A seulement si une fuite de version ou un avertissement', () => {
    expect(analyzeResponse({ headers: { ...STRONG, server: 'Apache/2.4.41' }, body: '', https: true }).grade).toBe('A');
    const weak = { ...STRONG, 'content-security-policy': "script-src 'self' 'unsafe-inline'", 'x-frame-options': 'SAMEORIGIN' };
    const a = analyzeResponse({ headers: weak, body: '', https: true });
    expect(a.grade).toBe('A');
    expect(a.headers.find((h) => h.id === 'csp')?.status).toBe('warn');
  });

  it('une lettre de moins par en-tête manquant, F sans HTTPS', () => {
    expect(analyzeResponse({ headers: { 'x-content-type-options': 'nosniff' }, body: '', https: true }).grade).toBe('F');
    const { 'permissions-policy': _, ...five } = STRONG;
    expect(analyzeResponse({ headers: five, body: '', https: true }).grade).toBe('B');
    expect(analyzeResponse({ headers: STRONG, body: '', https: false }).grade).toBe('F');
  });

  it('repère les fuites de version et la balise generator WordPress', () => {
    const a = analyzeResponse({
      headers: { server: 'nginx', 'x-powered-by': 'PHP/7.4.3' },
      body: '<head><meta name="generator" content="WordPress 6.4.3" /></head>',
      https: true,
    });
    expect(a.leaks).toEqual([{ header: 'X-Powered-By', value: 'PHP/7.4.3' }]);
    expect(a.tech).toMatchObject({ name: 'WordPress', version: '6.4.3' });
  });
});

describe('detectTech', () => {
  const none = () => null;
  const tech = (html: string, headers: Record<string, string> = {}) => {
    const t = detectTech((n) => headers[n] ?? null, html);
    return t && `${t.name}${t.version ? ` ${t.version}` : ''}`;
  };

  it('balise generator : CMS prioritaire sur les plugins, formats variés', () => {
    expect(tech('<meta name="generator" content="Elementor 3.20"><meta name="generator" content="WordPress 6.5.2">')).toBe('WordPress 6.5.2');
    expect(tech('<meta name="generator" content="Astro v4.5.0">')).toBe('Astro 4.5.0');
    expect(tech('<meta name="Generator" content="Drupal 10 (https://www.drupal.org)">')).toBe('Drupal 10');
    expect(tech('<meta name="generator" content="Joomla! - Open Source Content Management">')).toBe('Joomla!');
  });

  it('WordPress sans balise generator : version lue sur les scripts du cœur', () => {
    expect(tech('<script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script><link href="/wp-includes/css/dist/block-library/style.min.css?ver=6.4.3"><script src="/wp-includes/js/wp-emoji-release.min.js?ver=6.4.3"></script>')).toBe('WordPress 6.4.3');
    expect(tech('<link href="/wp-content/themes/x/style.css">')).toBe('WordPress');
  });

  it('frameworks sans version exposée', () => {
    expect(tech('<div id="__nuxt"></div>')).toBe('Nuxt');
    expect(tech('', { 'x-powered-by': 'Nuxt' })).toBe('Nuxt');
    expect(tech('<script id="__NEXT_DATA__"></script>')).toBe('Next.js');
    expect(tech('<img src="https://cdn.example/media/pages/accueil/ce9722132a-1717846665/photo.jpg">')).toBe('Kirby');
    expect(tech('<img src="/media/logo.png">')).toBeNull();
    expect(tech('', { 'set-cookie': 'kirby_session=abc; path=/' })).toBe('Kirby');
    expect(detectTech(none, '<html><body>rien</body></html>')).toBeNull();
  });
});

describe('webMatches', () => {
  const base: HttpReport = { url: 'https://a.fr', checkedAt: '', error: null, finalUrl: 'https://a.fr/', https: true, httpsRedirect: true };
  const now = Date.parse('2026-10-23');
  const cert = (validTo: string, trusted = true) => ({ validTo, issuer: "Let's Encrypt", trusted, error: null });
  const ids = (r: HttpReport) => webMatches(r, now).map((m) => `${m.vulnerability.id}:${m.vulnerability.severity}`);

  it('certificat : expiré, refusé, < 7 jours, < 30 jours, sain', () => {
    expect(ids({ ...base, cert: cert('2026-10-01') })).toEqual(['TLS-EXPIRED:critical']);
    expect(ids({ ...base, cert: cert('2027-06-01', false) })).toEqual(['TLS-UNTRUSTED:high']);
    expect(ids({ ...base, cert: cert('2026-10-27') })).toEqual(['TLS-EXPIRING-7:high']);
    expect(ids({ ...base, cert: cert('2026-11-10') })).toEqual(['TLS-EXPIRING-30:medium']);
    expect(ids({ ...base, cert: cert('2027-06-01') })).toEqual([]);
  });

  it('HTTPS absent ou sans redirection, et rien si le site est injoignable', () => {
    expect(ids({ ...base, https: false, finalUrl: 'http://a.fr/' })).toEqual(['WEB-NO-HTTPS:high']);
    expect(ids({ ...base, httpsRedirect: false })).toEqual(['WEB-NO-HTTPS-REDIRECT:medium']);
    expect(ids({ url: 'https://a.fr', checkedAt: '', error: 'Site injoignable' })).toEqual([]);
  });
});

describe('runHttpCheck', () => {
  it('suit les redirections, lit les en-têtes et vérifie http → https', async () => {
    const fetcher = (async (url: string) => {
      if (url.startsWith('http://')) return new Response(null, { status: 301, headers: { location: 'https://a.fr/' } });
      const res = new Response('<meta name="generator" content="WordPress 6.6">', { headers: STRONG });
      Object.defineProperty(res, 'url', { value: 'https://a.fr/accueil' });
      return res;
    }) as Fetch;
    const report = await runHttpCheck('https://a.fr', {
      fetcher,
      certReader: async () => ({ validTo: '2027-01-01T00:00:00.000Z', issuer: 'R3', trusted: true, error: null }),
    });
    expect(report).toMatchObject({ error: null, https: true, httpsRedirect: true, grade: 'A+', tech: { name: 'WordPress', version: '6.6' }, finalUrl: 'https://a.fr/accueil' });
  });

  it('certificat refusé à la connexion : le certificat est quand même lu et signalé', async () => {
    const fetcher = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    }) as unknown as Fetch;
    const report = await runHttpCheck('https://expire.example', {
      fetcher,
      certReader: async () => ({ validTo: '2020-01-01T00:00:00.000Z', issuer: 'R3', trusted: false, error: 'CERT_HAS_EXPIRED' }),
    });
    expect(report.error).toMatch(/certificat invalide/);
    expect(webMatches(report).map((m) => m.vulnerability.id)).toEqual(['TLS-EXPIRED']);
  });

  it('site injoignable : rapport avec erreur', async () => {
    const fetcher = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as unknown as Fetch;
    expect(await runHttpCheck('https://absent.example', { fetcher })).toMatchObject({ error: 'Site injoignable (ENOTFOUND)' });
  });
});

describe('scan avec site en ligne', () => {
  it('enregistre le rapport et ne ferme pas les alertes web quand le site est injoignable', async () => {
    const db = openDb(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'argos-web-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));
    const client = db.insert(clients).values({ name: 'A' }).returning().get();
    const site = db.insert(sites).values({ clientId: client.id, name: 's', path: dir, url: 'https://a.fr' }).returning().get();
    const fetcher = (async () => new Response(JSON.stringify({ results: [] }))) as Fetch;

    const expiring: HttpReport = {
      url: 'https://a.fr', checkedAt: '', error: null, finalUrl: 'https://a.fr/', https: true, httpsRedirect: true, grade: 'B',
      cert: { validTo: new Date(Date.now() + 3 * 86400000).toISOString(), issuer: null, trusted: true, error: null },
    };
    const onlineChecks = async () => ({});
    const first = await scanSite(db, site, { fetcher, httpCheck: async () => expiring, onlineChecks });
    expect(first.opened.map((f) => f.vulnerabilityId)).toEqual(['TLS-EXPIRING-7']);
    expect(db.select().from(httpChecks).get()?.grade).toBe('B');

    await scanSite(db, site, { fetcher, onlineChecks, httpCheck: async () => ({ url: 'https://a.fr', checkedAt: '', error: 'Site injoignable (ETIMEDOUT)' }) });
    expect(db.select().from(findings).where(eq(findings.vulnerabilityId, 'TLS-EXPIRING-7')).get()?.status).toBe('open');
  });
});
