import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db/index.ts';
import { pagespeedRuns, sites } from '../src/core/db/schema.ts';
import type { Fetch } from '../src/core/http.ts';
import {
  fetchPageSpeed,
  lastPageSpeedScores,
  latestPageSpeed,
  needsInitialPageSpeed,
  parsePageSpeed,
  startPageSpeed,
} from '../src/core/pagespeed.ts';
import { createClient, createSite, deleteSite } from '../src/core/sites.ts';

const audit = (numericValue: number, displayValue: string, score: number) => ({ numericValue, displayValue, score });

/** Réponse PageSpeed Insights v5 réduite aux champs lus par Argos. */
const RESPONSE = {
  id: 'https://a.fr/',
  lighthouseResult: {
    finalDisplayedUrl: 'https://a.fr/accueil',
    categories: { performance: { score: 0.47 }, accessibility: { score: 0.92 }, 'best-practices': { score: 1 }, seo: { score: 0.85 } },
    audits: {
      'largest-contentful-paint': audit(4210, '4,2 s', 0.3),
      'cumulative-layout-shift': audit(0.02, '0,02', 1),
      'total-blocking-time': audit(380, '380 ms', 0.6),
      'first-contentful-paint': audit(1800, '1,8 s', 0.9),
      'speed-index': audit(5100, '5,1 s', 0.55),
    },
  },
  loadingExperience: {
    overall_category: 'AVERAGE',
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, category: 'AVERAGE' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 140, category: 'FAST' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' },
    },
  },
};

describe('parsePageSpeed', () => {
  it('lit notes, mesures de laboratoire et données terrain', () => {
    const r = parsePageSpeed(RESPONSE);
    expect(r.finalUrl).toBe('https://a.fr/accueil');
    expect(r.scores).toEqual({ performance: 47, accessibility: 92, bestPractices: 100, seo: 85 });
    expect(r.lab.lcp).toEqual({ value: 4210, display: '4,2 s', rating: 'poor' });
    expect(r.lab.tbt.rating).toBe('average');
    expect(r.lab.fcp.rating).toBe('good');
    expect(r.field).toEqual({
      overall: 'average',
      lcp: { value: 2900, display: '2,9 s', rating: 'average' },
      inp: { value: 140, display: '140 ms', rating: 'good' },
      cls: { value: 5, display: '0,05', rating: 'good' },
    });
  });

  it('sans trafic suffisant, pas de données terrain ; erreur Lighthouse remontée', () => {
    const { loadingExperience: _, ...noField } = RESPONSE;
    expect(parsePageSpeed(noField).field).toBeNull();
    const failed = { lighthouseResult: { ...RESPONSE.lighthouseResult, runtimeError: { code: 'FAILED_DOCUMENT_REQUEST' } } };
    expect(() => parsePageSpeed(failed)).toThrow(/FAILED_DOCUMENT_REQUEST/);
  });
});

describe('détail des contrôles en échec', () => {
  const node = (nodeLabel: string, selector: string) => ({ node: { type: 'node', nodeLabel, selector, snippet: `<p class="${selector}">` } });
  const withAudits = {
    ...RESPONSE,
    lighthouseResult: {
      ...RESPONSE.lighthouseResult,
      categories: {
        ...RESPONSE.lighthouseResult.categories,
        performance: {
          score: 0.47,
          auditRefs: [
            { id: 'largest-contentful-paint', weight: 25, group: 'metrics' },
            { id: 'render-blocking-insight', weight: 0, group: 'insights' },
            { id: 'interactive', weight: 0, group: 'hidden' },
          ],
        },
        accessibility: {
          score: 0.92,
          auditRefs: [
            { id: 'label-content-name-mismatch', weight: 0, group: 'hidden' },
            { id: 'color-contrast', weight: 7, group: 'a11y-color-contrast' },
            { id: 'image-alt', weight: 10 },
            { id: 'aria-roles', weight: 7 },
          ],
        },
      },
      audits: {
        ...RESPONSE.lighthouseResult.audits,
        interactive: audit(5600, '5,6 s', 0.6),
        'render-blocking-insight': {
          title: 'Requêtes de blocage du rendu',
          description: 'Retardent le rendu. [En savoir plus](https://developer.chrome.com/x)',
          score: 0,
          scoreDisplayMode: 'metricSavings',
          metricSavings: { FCP: 640, LCP: 300 },
          details: { type: 'table', items: [{ url: 'https://a.fr/app.css', wastedMs: 640 }] },
        },
        'color-contrast': {
          title: 'Contraste insuffisant',
          description: 'Texte difficile à lire. Voir `contrast`. [En savoir plus](https://dequeuniversity.com/rules/axe/color-contrast)',
          score: 0,
          scoreDisplayMode: 'binary',
          details: { type: 'table', items: Array.from({ length: 12 }, (_, i) => node(`${i}`, `p.n${i}`)) },
        },
        'label-content-name-mismatch': {
          title: 'Nom accessible différent du libellé',
          description: '',
          score: 0,
          scoreDisplayMode: 'binary',
          details: { type: 'table', items: [node('Mentions légales', 'a.footer')] },
        },
        'image-alt': { title: 'Images sans alt', description: '', score: 1, scoreDisplayMode: 'binary' },
        'aria-roles': { title: 'Rôles ARIA', description: '', score: null, scoreDisplayMode: 'notApplicable' },
        'lcp-breakdown-insight': { score: 1, details: { type: 'list', items: [{ type: 'table', items: [] }, { type: 'node', nodeLabel: 'Bannière', selector: 'img.hero' }] } },
        'total-byte-weight': { displayValue: 'La taille totale était de 940 Kio' },
      },
    },
  };

  it('garde les échecs hors métriques, les plus lourds d’abord, avec éléments et lien', () => {
    const r = parsePageSpeed(withAudits);
    expect(r.issues.map((i) => [i.category, i.id, i.weight])).toEqual([
      ['performance', 'render-blocking-insight', 0],
      ['accessibility', 'color-contrast', 7],
      ['accessibility', 'label-content-name-mismatch', 0],
    ]);
    const [blocking, contrast] = r.issues;
    expect(blocking).toMatchObject({ savingsMs: 640, learnMore: 'https://developer.chrome.com/x', description: 'Retardent le rendu.' });
    expect(blocking.items).toEqual([{ label: null, selector: null, snippet: null, url: 'https://a.fr/app.css' }]);
    expect(contrast.description).toBe('Texte difficile à lire. Voir contrast.');
    expect(contrast.itemCount).toBe(12);
    expect(contrast.items).toHaveLength(10);
    expect(contrast.items[0]).toMatchObject({ label: '0', selector: 'p.n0' });
  });

  it('identifie l’élément LCP et le poids de la page', () => {
    const r = parsePageSpeed(withAudits);
    expect(r.lcpElement).toMatchObject({ label: 'Bannière', selector: 'img.hero' });
    expect(r.totalWeight).toBe('La taille totale était de 940 Kio');
  });
});

describe('fetchPageSpeed', () => {
  it('demande le mobile et les 4 catégories, signale une clé refusée', async () => {
    let called = '';
    const ok = (async (url: string) => {
      called = url;
      return new Response(JSON.stringify(RESPONSE));
    }) as Fetch;
    await fetchPageSpeed('https://a.fr', 'CLE', ok);
    const params = new URL(called).searchParams;
    expect(params.get('strategy')).toBe('mobile');
    expect(params.getAll('category')).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);

    const refused = (async () =>
      new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 })) as Fetch;
    await expect(fetchPageSpeed('https://a.fr', 'MAUVAISE', refused)).rejects.toThrow('Clé API PageSpeed refusée par Google');
  });
});

describe('analyses en arrière-plan', () => {
  let db: Db;
  let siteId: number;
  const getKey = async () => 'CLE';

  beforeEach(async () => {
    db = openDb(':memory:');
    const client = createClient(db, 'A');
    const { site } = await createSite(db, { clientId: client.id, path: mkdtempSync(join(tmpdir(), 'argos-psi-')), url: 'a.fr' });
    siteId = site.id;
  });

  it('premier scan : à faire tant que le site n’a jamais été analysé', async () => {
    expect(needsInitialPageSpeed(db, siteId)).toBe(true);
    const { done } = await startPageSpeed(db, siteId, { getKey, fetcher: (async () => new Response(JSON.stringify(RESPONSE))) as Fetch });
    await done;
    expect(needsInitialPageSpeed(db, siteId)).toBe(false);
    db.update(sites).set({ url: null }).where(eq(sites.id, siteId)).run();
    expect(needsInitialPageSpeed(db, siteId)).toBe(false);
  });

  it('renvoie aussitôt « en cours », puis enregistre le résultat ; pas de second lancement concurrent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetcher = (async () => {
      await gate;
      return new Response(JSON.stringify(RESPONSE));
    }) as Fetch;

    const { run, done } = await startPageSpeed(db, siteId, { getKey, fetcher });
    expect(run.status).toBe('running');
    const again = await startPageSpeed(db, siteId, { getKey, fetcher });
    expect(again.run.id).toBe(run.id);

    release();
    expect((await done).status).toBe('ok');
    expect(lastPageSpeedScores(db, [siteId]).get(siteId)).toBe(47);
  });

  it('erreur enregistrée, clé absente refusée, analyse bloquée requalifiée', async () => {
    const failing = (async () => {
      throw new Error('réseau coupé');
    }) as unknown as Fetch;
    const { done } = await startPageSpeed(db, siteId, { getKey, fetcher: failing });
    expect(await done).toMatchObject({ status: 'error', error: 'réseau coupé' });

    await expect(startPageSpeed(db, siteId, { getKey: async () => null })).rejects.toThrow(/Clé API/);

    db.insert(pagespeedRuns).values({ siteId, startedAt: new Date(Date.now() - 10 * 60_000) }).run();
    expect(latestPageSpeed(db, [siteId]).get(siteId)).toMatchObject({ status: 'error', error: 'Analyse interrompue' });
  });

  it('la suppression du site efface ses analyses', async () => {
    const { done } = await startPageSpeed(db, siteId, { getKey, fetcher: (async () => new Response(JSON.stringify(RESPONSE))) as Fetch });
    await done;
    deleteSite(db, siteId);
    expect(db.select().from(pagespeedRuns).all()).toHaveLength(0);
  });
});
