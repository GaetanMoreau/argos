import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { pagespeedRuns, sites } from './db/schema.ts';
import type { Fetch } from './http.ts';
import { readSecret } from './keychain.ts';

export const KEY_ACCOUNT = 'pagespeed-api-key';

const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const TIMEOUT = 120_000;
/** Une analyse « en cours » plus vieille que ça a été interrompue (serveur arrêté pendant l'attente). */
const STALE = 5 * 60_000;

type Rating = 'good' | 'average' | 'poor';

interface Metric {
  value: number;
  display: string;
  rating: Rating;
}

type Category = 'performance' | 'accessibility' | 'bestPractices' | 'seo';

/** Élément de la page mis en cause par un contrôle (balise, ressource…). */
interface IssueItem {
  label: string | null;
  selector: string | null;
  snippet: string | null;
  url: string | null;
}

/** Contrôle Lighthouse en échec, avec de quoi le corriger. */
export interface Issue {
  category: Category;
  id: string;
  title: string;
  /** Explication de Lighthouse, liens Markdown retirés. */
  description: string;
  learnMore: string | null;
  displayValue: string | null;
  /** 0 : sans effet direct sur la note. Les recommandations de performance ont toutes 0 mais agissent via les mesures. */
  weight: number;
  savingsMs: number | null;
  savingsBytes: number | null;
  items: IssueItem[];
  itemCount: number;
}

export interface PageSpeedResult {
  finalUrl: string;
  /** Notes Lighthouse sur 100. */
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
  /** Mesures de laboratoire (simulation Lighthouse). */
  lab: { lcp: Metric; cls: Metric; tbt: Metric; fcp: Metric; speedIndex: Metric };
  /** Mesures réelles des utilisateurs de Chrome (75e centile), absentes si le site a trop peu de trafic. */
  field: { overall: Rating; lcp: Metric | null; inp: Metric | null; cls: Metric | null } | null;
  issues: Issue[];
  /** Élément retenu pour le Largest Contentful Paint (souvent l'image principale). */
  lcpElement: IssueItem | null;
  /** Poids total de la page, tel qu'affiché par Lighthouse. */
  totalWeight: string | null;
}

const CATEGORIES: [string, Category][] = [
  ['performance', 'performance'],
  ['accessibility', 'accessibility'],
  ['best-practices', 'bestPractices'],
  ['seo', 'seo'],
];
const MAX_ITEMS = 10;
const clip = (text: unknown, max = 200) =>
  typeof text === 'string' && text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null;

function toItem(row: any): IssueItem | null {
  const node = row?.node?.type === 'node' ? row.node : row?.type === 'node' ? row : null;
  const url = typeof row?.url === 'string' ? row.url : typeof row?.source?.url === 'string' ? row.source.url : null;
  if (!node && !url) return null;
  return { label: clip(node?.nodeLabel, 120), selector: clip(node?.selector, 160), snippet: clip(node?.snippet), url: clip(url, 300) };
}

/** Éléments en cause : lignes de tableau, ou sous-tableaux d'une liste (insights Lighthouse). */
function issueItems(details: any): IssueItem[] {
  const rows: any[] = Array.isArray(details?.items) ? details.items : [];
  const flat = rows.flatMap((r) => (Array.isArray(r?.items) ? r.items : [r]));
  return flat.map(toItem).filter((i): i is IssueItem => Boolean(i));
}

function markdownToText(md: string): { text: string; link: string | null } {
  const link = md.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)?.[1] ?? null;
  const text = md
    // Un lien « En savoir plus » est affiché à part ; un lien inclus dans une phrase garde son texte.
    .replace(/\[(en savoir plus|learn more)[^\]]*\]\([^)]*\)\.?/gi, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, link };
}

/**
 * Contrôles en échec par catégorie : note < 0,9, hors métriques (déjà dans les mesures) et hors contrôles
 * informatifs, manuels ou non applicables. Les plus lourds dans la note d'abord.
 */
function issues(lh: any): Issue[] {
  const out: Issue[] = [];
  for (const [lhId, category] of CATEGORIES) {
    for (const ref of lh.categories?.[lhId]?.auditRefs ?? []) {
      const audit = lh.audits?.[ref.id];
      if (!audit || ref.group === 'metrics' || (category === 'performance' && ref.group === 'hidden')) continue;
      if (audit.score == null || audit.score >= 0.9) continue;
      if (['notApplicable', 'manual', 'informative'].includes(audit.scoreDisplayMode)) continue;
      const { text, link } = markdownToText(audit.description ?? '');
      const all = issueItems(audit.details);
      const savingsMs = audit.details?.overallSavingsMs ?? Math.max(0, ...Object.values<number>(audit.metricSavings ?? {}));
      out.push({
        category,
        id: ref.id,
        title: audit.title,
        description: text,
        learnMore: link,
        displayValue: audit.displayValue || null,
        weight: ref.weight ?? 0,
        savingsMs: savingsMs ? Math.round(savingsMs) : null,
        savingsBytes: audit.details?.overallSavingsBytes ? Math.round(audit.details.overallSavingsBytes) : null,
        items: all.slice(0, MAX_ITEMS),
        itemCount: all.length,
      });
    }
  }
  return out.sort((a, b) => CATEGORIES.findIndex((c) => c[1] === a.category) - CATEGORIES.findIndex((c) => c[1] === b.category) || b.weight - a.weight);
}

function lcpElement(audits: any): IssueItem | null {
  for (const id of ['lcp-breakdown-insight', 'largest-contentful-paint-element']) {
    const details = audits?.[id]?.details;
    const found = [details, ...(details?.items ?? [])].map(toItem).find(Boolean) ?? issueItems(details)[0];
    if (found) return found;
  }
  return null;
}

const ratingFromScore = (score: number | null | undefined): Rating =>
  score == null ? 'poor' : score >= 0.9 ? 'good' : score >= 0.5 ? 'average' : 'poor';

const FIELD_RATINGS: Record<string, Rating> = { FAST: 'good', AVERAGE: 'average', SLOW: 'poor' };

function labMetric(audits: any, id: string): Metric {
  const audit = audits?.[id] ?? {};
  return { value: audit.numericValue ?? 0, display: audit.displayValue ?? '—', rating: ratingFromScore(audit.score) };
}

function fieldMetric(metrics: any, id: string, format: (p: number) => string): Metric | null {
  const m = metrics?.[id];
  if (!m) return null;
  return { value: m.percentile, display: format(m.percentile), rating: FIELD_RATINGS[m.category] ?? 'average' };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export function parsePageSpeed(json: any): PageSpeedResult {
  const lh = json?.lighthouseResult;
  if (!lh) throw new Error(json?.error?.message ?? 'Réponse PageSpeed inattendue');
  if (lh.runtimeError?.code && lh.runtimeError.code !== 'NO_ERROR') {
    throw new Error(`Lighthouse n’a pas pu analyser la page (${lh.runtimeError.code})`);
  }
  const score = (id: string) => Math.round((lh.categories?.[id]?.score ?? 0) * 100);
  const field = json.loadingExperience?.metrics ? json.loadingExperience : null;
  return {
    finalUrl: lh.finalDisplayedUrl ?? lh.finalUrl ?? json.id,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
    },
    lab: {
      lcp: labMetric(lh.audits, 'largest-contentful-paint'),
      cls: labMetric(lh.audits, 'cumulative-layout-shift'),
      tbt: labMetric(lh.audits, 'total-blocking-time'),
      fcp: labMetric(lh.audits, 'first-contentful-paint'),
      speedIndex: labMetric(lh.audits, 'speed-index'),
    },
    field: field && {
      overall: FIELD_RATINGS[field.overall_category] ?? 'average',
      lcp: fieldMetric(field.metrics, 'LARGEST_CONTENTFUL_PAINT_MS', seconds),
      inp: fieldMetric(field.metrics, 'INTERACTION_TO_NEXT_PAINT', (p) => `${p} ms`),
      // L'API renvoie le CLS multiplié par 100.
      cls: fieldMetric(field.metrics, 'CUMULATIVE_LAYOUT_SHIFT_SCORE', (p) => (p / 100).toFixed(2).replace('.', ',')),
    },
    issues: issues(lh),
    lcpElement: lcpElement(lh.audits),
    totalWeight: lh.audits?.['total-byte-weight']?.displayValue ?? null,
  };
}

export async function fetchPageSpeed(url: string, key: string, fetcher: Fetch = fetch): Promise<PageSpeedResult> {
  const params = new URLSearchParams({ url, key, strategy: 'mobile', locale: 'fr' });
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) params.append('category', category);
  const res = await fetcher(`${API}?${params}`, { signal: AbortSignal.timeout(TIMEOUT) });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(res.status === 400 && /API key/i.test(reason) ? 'Clé API PageSpeed refusée par Google' : reason);
  }
  return parsePageSpeed(json);
}

type Run = typeof pagespeedRuns.$inferSelect;

/** Analyse la plus récente de chaque site ; une analyse bloquée en `running` est requalifiée en erreur. */
export function latestPageSpeed(db: Db, siteIds: number[]): Map<number, Run> {
  if (!siteIds.length) return new Map();
  const latest = db
    .select({ id: sql<number>`max(${pagespeedRuns.id})` })
    .from(pagespeedRuns)
    .where(inArray(pagespeedRuns.siteId, siteIds))
    .groupBy(pagespeedRuns.siteId);
  const rows = db.select().from(pagespeedRuns).where(inArray(pagespeedRuns.id, latest)).all();
  return new Map(
    rows.map((r) => {
      const stale = r.status === 'running' && Date.now() - r.startedAt.getTime() > STALE;
      return [r.siteId, stale ? { ...r, status: 'error' as const, error: 'Analyse interrompue' } : r];
    }),
  );
}

/** Dernière analyse réussie de chaque site (pour la colonne de la liste). */
export function lastPageSpeedScores(db: Db, siteIds: number[]): Map<number, number> {
  if (!siteIds.length) return new Map();
  const rows = db
    .select({ siteId: pagespeedRuns.siteId, result: pagespeedRuns.result })
    .from(pagespeedRuns)
    .where(and(inArray(pagespeedRuns.siteId, siteIds), eq(pagespeedRuns.status, 'ok')))
    .orderBy(desc(pagespeedRuns.id))
    .all();
  const out = new Map<number, number>();
  for (const r of rows) {
    if (!out.has(r.siteId) && r.result) out.set(r.siteId, (JSON.parse(r.result) as PageSpeedResult).scores.performance);
  }
  return out;
}

/** Premier scan : le site a une URL et n'a encore jamais été analysé. */
export function needsInitialPageSpeed(db: Db, siteId: number): boolean {
  const site = db.select({ url: sites.url }).from(sites).where(eq(sites.id, siteId)).get();
  if (!site?.url) return false;
  return !db.select({ id: pagespeedRuns.id }).from(pagespeedRuns).where(eq(pagespeedRuns.siteId, siteId)).get();
}

interface PageSpeedDeps {
  fetcher?: Fetch;
  getKey?: () => Promise<string | null>;
}

/**
 * Lance l'analyse d'un site. Renvoie aussitôt l'analyse « en cours » et la promesse de fin : l'interface n'attend
 * pas (Google met 15 à 40 s), la ligne de commande attend la promesse. Une seule analyse à la fois par site.
 */
export async function startPageSpeed(
  db: Db,
  siteId: number,
  { fetcher = fetch, getKey = () => readSecret(KEY_ACCOUNT) }: PageSpeedDeps = {},
): Promise<{ run: Run; done: Promise<Run> }> {
  const site = db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site?.url) throw new Error('Ce site n’a pas d’URL');
  const current = latestPageSpeed(db, [siteId]).get(siteId);
  if (current?.status === 'running') return { run: current, done: Promise.resolve(current) };

  const key = await getKey();
  if (!key) throw new Error('Clé API PageSpeed absente');

  const run = db.insert(pagespeedRuns).values({ siteId }).returning().get();
  const finish = (values: Partial<Run>) =>
    db
      .update(pagespeedRuns)
      .set({ ...values, finishedAt: new Date() })
      .where(eq(pagespeedRuns.id, run.id))
      .returning()
      .get()!;
  const done = fetchPageSpeed(site.url, key, fetcher).then(
    (result) => finish({ status: 'ok', result: JSON.stringify(result) }),
    (err: Error) => finish({ status: 'error', error: err.message }),
  );
  return { run, done };
}
