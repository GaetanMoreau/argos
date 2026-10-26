import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { clients, components, findings, httpChecks, scans, sites, vulnerabilities } from './db/schema.ts';
import type { Severity } from './types.ts';
import { updateLag } from './version.ts';
import { lastPageSpeedScores, latestPageSpeed, type PageSpeedResult } from './pagespeed.ts';
import type { HttpReport } from './web/check.ts';

/** critical : faille high+ ou exploitée hors dev · warning : autre chose d'ouvert · ok : rien · unknown : jamais scanné ou en erreur. */
type SiteStatus = 'critical' | 'warning' | 'ok' | 'unknown';

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  kev: number;
  /** Fins de support et cœur WordPress non sûr. */
  lifecycle: number;
  dev: number;
  total: number;
}

const emptyCounts = (): SeverityCounts => ({
  critical: 0, high: 0, medium: 0, low: 0, unknown: 0, kev: 0, lifecycle: 0, dev: 0, total: 0,
});

const LIFECYCLE = sql`(${vulnerabilities.id} like 'EOL-%' or ${vulnerabilities.id} like 'WP-CORE-%')`;

function openCounts(db: Db, siteIds?: number[]) {
  const rows = db
    .select({
      siteId: findings.siteId,
      severity: vulnerabilities.severity,
      isDev: findings.isDev,
      isKev: vulnerabilities.isKev,
      lifecycle: sql<number>`${LIFECYCLE}`,
    })
    .from(findings)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, findings.vulnerabilityId))
    .where(and(eq(findings.status, 'open'), siteIds ? inArray(findings.siteId, siteIds) : undefined))
    .all();
  const bySite = new Map<number, SeverityCounts>();
  const urgent = new Set<number>();
  for (const r of rows) {
    const c = bySite.get(r.siteId) ?? emptyCounts();
    bySite.set(r.siteId, c);
    c.total++;
    if (r.isDev) {
      c.dev++;
      continue;
    }
    c[r.severity]++;
    if (r.isKev) c.kev++;
    if (r.lifecycle) c.lifecycle++;
    if (r.isKev || r.severity === 'critical' || r.severity === 'high') urgent.add(r.siteId);
  }
  return { bySite, urgent };
}

/** Dernière ligne de `table` pour chaque site (plus grand id). */
function latestPerSite<T extends typeof scans | typeof httpChecks>(db: Db, table: T, siteIds: number[]) {
  if (!siteIds.length) return new Map<number, T['$inferSelect']>();
  const latest = db
    .select({ id: sql<number>`max(${table.id})` })
    .from(table)
    .where(inArray(table.siteId, siteIds))
    .groupBy(table.siteId);
  const rows = db.select().from(table).where(inArray(table.id, latest)).all() as T['$inferSelect'][];
  return new Map(rows.map((r) => [r.siteId, r]));
}

function lastOkScans(db: Db, siteIds: number[]) {
  if (!siteIds.length) return new Map<number, number>();
  const rows = db
    .select({ siteId: scans.siteId, id: sql<number>`max(${scans.id})` })
    .from(scans)
    .where(and(inArray(scans.siteId, siteIds), eq(scans.status, 'ok')))
    .groupBy(scans.siteId)
    .all();
  return new Map(rows.map((r) => [r.siteId, r.id]));
}

function statusOf(scan: typeof scans.$inferSelect | undefined, counts: SeverityCounts, urgent: boolean): SiteStatus {
  if (!scan || scan.status !== 'ok') return 'unknown';
  if (urgent) return 'critical';
  // Les dépendances de dev ne changent pas l'état du site.
  return counts.total > counts.dev ? 'warning' : 'ok';
}

export function overview(db: Db) {
  const allSites = db.select().from(sites).where(eq(sites.archived, false)).orderBy(sites.name).all();
  const ids = allSites.map((s) => s.id);
  const { bySite, urgent } = openCounts(db, ids);
  const scansBySite = latestPerSite(db, scans, ids);
  const okScans = lastOkScans(db, ids);
  const http = latestPerSite(db, httpChecks, ids);
  const perf = lastPageSpeedScores(db, ids);
  const perfRuns = latestPageSpeed(db, ids);

  const componentCounts = new Map<number, { total: number; untracked: number; updates: number; majorUpdates: number }>();
  const okIds = [...okScans.values()];
  if (okIds.length) {
    const rows = db
      .select({
        scanId: components.scanId,
        total: sql<number>`count(*)`,
        untracked: sql<number>`sum(${components.untracked})`,
      })
      .from(components)
      // Composants choisis par le projet : le total des dépendances indirectes (des centaines) n'apprend rien.
      .where(and(inArray(components.scanId, okIds), eq(components.direct, true)))
      .groupBy(components.scanId)
      .all();
    const byScan = new Map(rows.map((r) => [r.scanId, r]));
    const lags = db
      .select({ scanId: components.scanId, version: components.version, latest: components.latest })
      .from(components)
      .where(and(inArray(components.scanId, okIds), eq(components.direct, true), isNotNull(components.latest)))
      .all()
      .map((c) => ({ scanId: c.scanId, lag: updateLag(c.version, c.latest) }))
      .filter((c) => c.lag);
    for (const [siteId, scanId] of okScans) {
      const r = byScan.get(scanId);
      const siteLags = lags.filter((l) => l.scanId === scanId);
      componentCounts.set(siteId, {
        total: r?.total ?? 0,
        untracked: r?.untracked ?? 0,
        updates: siteLags.length,
        majorUpdates: siteLags.filter((l) => l.lag === 'major').length,
      });
    }
  }

  const siteRows = allSites.map((s) => {
    const counts = bySite.get(s.id) ?? emptyCounts();
    const scan = scansBySite.get(s.id);
    return {
      id: s.id,
      clientId: s.clientId,
      name: s.name,
      url: s.url,
      stack: s.stack ? s.stack.split(',') : [],
      status: statusOf(scan, counts, urgent.has(s.id)),
      counts,
      components: componentCounts.get(s.id) ?? { total: 0, untracked: 0, updates: 0, majorUpdates: 0 },
      httpGrade: s.url ? (http.get(s.id)?.grade ?? null) : null,
      perfScore: perf.get(s.id) ?? null,
      perfRunning: perfRuns.get(s.id)?.status === 'running',
      lastScan: scan ? { at: scan.startedAt.toISOString(), status: scan.status, error: scan.error } : null,
    };
  });

  const clientRows = db.select().from(clients).orderBy(clients.name).all();
  const totals = {
    clients: clientRows.length,
    sites: siteRows.length,
    critical: siteRows.filter((s) => s.status === 'critical').length,
    warning: siteRows.filter((s) => s.status === 'warning').length,
    openFindings: siteRows.reduce((n, s) => n + s.counts.total - s.counts.dev, 0),
    // Comptés en sites, comme les autres chiffres du résumé.
    lifecycle: siteRows.filter((s) => s.counts.lifecycle > 0).length,
    unknown: siteRows.filter((s) => s.status === 'unknown').length,
    lastScanAt: siteRows.map((s) => s.lastScan?.at).filter(Boolean).sort().at(-1) ?? null,
  };

  return {
    totals,
    clients: clientRows
      .map((c) => ({ id: c.id, name: c.name, sites: siteRows.filter((s) => s.clientId === c.id) }))
      .filter((c) => c.sites.length),
  };
}

/** Date de modification la plus récente des fichiers d'inventaire : la copie locale est-elle fraîche ? */
function copyFreshness(path: string): string | null {
  const candidates = [
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock',
    'wp-includes/version.php', 'wp-content/plugins', 'web/app/plugins', 'kirby/composer.json', 'site/plugins',
  ];
  const times = candidates
    .map((f) => join(path, f))
    .filter((p) => existsSync(p))
    .map((p) => statSync(p).mtimeMs);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

const findingColumns = {
  id: findings.id,
  siteId: findings.siteId,
  siteName: sites.name,
  ecosystem: findings.ecosystem,
  component: findings.componentName,
  version: findings.version,
  isDev: findings.isDev,
  fixedIn: findings.fixedIn,
  status: findings.status,
  note: findings.note,
  firstSeenAt: findings.firstSeenAt,
  lastSeenAt: findings.lastSeenAt,
  vulnId: vulnerabilities.id,
  source: vulnerabilities.source,
  aliases: vulnerabilities.aliases,
  summary: vulnerabilities.summary,
  severity: vulnerabilities.severity,
  isKev: vulnerabilities.isKev,
  url: vulnerabilities.url,
};

const SEVERITY_ORDER = sql`case ${vulnerabilities.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;

export interface FindingFilters {
  status?: 'open' | 'ignored' | 'fixed' | 'all';
  siteId?: number;
  severity?: Severity;
  prodOnly?: boolean;
}

export function listFindings(db: Db, filters: FindingFilters = {}) {
  const status = filters.status ?? 'open';
  return db
    .select(findingColumns)
    .from(findings)
    .innerJoin(sites, eq(sites.id, findings.siteId))
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, findings.vulnerabilityId))
    .where(
      and(
        eq(sites.archived, false),
        status === 'all' ? undefined : eq(findings.status, status),
        filters.siteId ? eq(findings.siteId, filters.siteId) : undefined,
        filters.severity ? eq(vulnerabilities.severity, filters.severity) : undefined,
        filters.prodOnly ? eq(findings.isDev, false) : undefined,
      ),
    )
    // Fins de support et statut du cœur en tête : ils résument l'action à mener mieux qu'une faille isolée.
    .orderBy(findings.isDev, desc(vulnerabilities.isKev), SEVERITY_ORDER, desc(LIFECYCLE), sites.name, findings.componentName)
    .all()
    .map((f) => ({
      ...f,
      aliases: f.aliases ? f.aliases.split(',') : [],
      firstSeenAt: f.firstSeenAt.toISOString(),
      lastSeenAt: f.lastSeenAt.toISOString(),
    }));
}

/** Dernière analyse PageSpeed telle qu'affichée : état, dates et résultat décodé. */
export function pageSpeedView(run: ReturnType<typeof latestPageSpeed> extends Map<number, infer R> ? R | undefined : never) {
  if (!run) return null;
  return {
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    error: run.error,
    result: run.result ? (JSON.parse(run.result) as PageSpeedResult) : null,
  };
}

export function siteDetail(db: Db, id: number) {
  const site = db.select().from(sites).where(eq(sites.id, id)).get();
  if (!site) return null;
  const client = db.select().from(clients).where(eq(clients.id, site.clientId)).get()!;
  const { bySite, urgent } = openCounts(db, [id]);
  const history = db.select().from(scans).where(eq(scans.siteId, id)).orderBy(desc(scans.id)).limit(15).all();
  const lastOk = lastOkScans(db, [id]).get(id);
  const counts = bySite.get(id) ?? emptyCounts();

  const inventory = lastOk
    ? db.select().from(components).where(eq(components.scanId, lastOk)).orderBy(components.ecosystem, components.name).all()
    : [];
  const httpRow = site.url ? latestPerSite(db, httpChecks, [id]).get(id) : undefined;

  return {
    site: {
      id: site.id,
      name: site.name,
      url: site.url,
      path: site.path,
      hosting: site.hosting,
      notes: site.notes,
      stack: site.stack ? site.stack.split(',') : [],
      status: statusOf(history[0], counts, urgent.has(id)),
      copyModifiedAt: existsSync(site.path) ? copyFreshness(site.path) : null,
    },
    client: { id: client.id, name: client.name },
    counts,
    http: httpRow ? (JSON.parse(httpRow.report) as HttpReport) : null,
    pagespeed: pageSpeedView(latestPageSpeed(db, [id]).get(id)),
    /** PHP retenu au dernier scan et d'où il vient ; `manual` = valeur saisie (peut être plus récente que le scan). */
    php: (() => {
      const c = inventory.find((x) => x.ecosystem === 'runtime' && x.name === 'php');
      if (!c && !site.phpVersion) return null;
      return { version: c?.version ?? site.phpVersion, source: c?.source ?? 'manual', manual: site.phpVersion };
    })(),
    /** Versions de la copie locale, à comparer avec la techno détectée en production (clé : nom en minuscules). */
    localVersions: Object.fromEntries(
      (
        [
          ['wordpress', inventory.find((c) => c.ecosystem === 'wp-core')],
          // Nuxt est souvent déclaré en devDependencies : on prend la version quel que soit le flag.
          ['nuxt', inventory.find((c) => c.ecosystem === 'npm' && c.name === 'nuxt')],
          ['kirby', inventory.find((c) => c.ecosystem === 'packagist' && c.name === 'getkirby/cms')],
        ] as const
      ).flatMap(([key, c]) => (c ? [[key, c.version]] : [])),
    ) as Record<string, string>,
    components: inventory.map((c) => ({
      ecosystem: c.ecosystem,
      name: c.name,
      version: c.version,
      isDev: c.isDev,
      untracked: c.untracked,
      direct: c.direct,
      latest: c.latest,
    })),
    findings: listFindings(db, { siteId: id, status: 'all' }).filter(
      (f) => f.status !== 'fixed' || Date.now() - Date.parse(f.lastSeenAt) < 90 * 24 * 3600 * 1000,
    ),
    scans: history.map((s) => ({
      id: s.id,
      at: s.startedAt.toISOString(),
      finishedAt: s.finishedAt?.toISOString() ?? null,
      status: s.status,
      error: s.error,
    })),
  };
}

export function setFindingStatus(db: Db, id: number, status: 'open' | 'ignored', note?: string) {
  return db
    .update(findings)
    .set({ status, note: status === 'ignored' ? note : null })
    .where(and(eq(findings.id, id), inArray(findings.status, ['open', 'ignored'])))
    .returning()
    .get();
}
