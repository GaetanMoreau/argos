import { and, eq, inArray } from 'drizzle-orm';
import { detectAdapters } from './adapters/index.ts';
import type { Db } from './db/index.ts';
import { components, findings, httpChecks, scans, sites, vulnerabilities } from './db/schema.ts';
import { phpFromReport, resolvePhp } from './php.ts';
import { markDirect, withLatestVersions } from './updates.ts';
import { runHttpCheck, type HttpReport } from './web/check.ts';
import { checkDomain, checkEmail } from './web/domain.ts';
import { checkExposures } from './web/exposure.ts';
import { WEB_CHECKS, webMatches } from './web/findings.ts';
import type { Fetch } from './http.ts';
import { dedupe, type Component, type Match } from './types.ts';
import { queryEndOfLife, queryWordPressCore } from './vulns/eol.ts';
import { loadKev } from './vulns/kev.ts';
import { queryOsv } from './vulns/osv.ts';
import { queryWpVulnerability } from './vulns/wpvulnerability.ts';

const SOURCES = [queryOsv, queryWpVulnerability, queryEndOfLife, queryWordPressCore];

type Site = typeof sites.$inferSelect;
type Finding = typeof findings.$inferSelect;

export interface ScanResult {
  site: Site;
  error?: string;
  components: number;
  untracked: number;
  /** Failles nouvelles ou réapparues depuis le dernier scan. */
  opened: Finding[];
  fixed: number;
}

interface ScanDeps {
  fetcher?: Fetch;
  /** Vérification du site en ligne (remplaçable dans les tests). */
  httpCheck?: (url: string) => Promise<HttpReport>;
  /** Fichiers exposés, domaine et e-mail (remplaçables dans les tests). */
  onlineChecks?: (report: HttpReport, stack: string[]) => Promise<Pick<HttpReport, 'exposures' | 'domain' | 'email'>>;
}

/** Fichiers exposés (si le site répond), nom de domaine et e-mail (indépendants du site). */
async function runOnlineChecks(db: Db, fetcher: Fetch, report: HttpReport, stack: string[]) {
  const domain = await checkDomain(db, fetcher, new URL(report.finalUrl ?? report.url).hostname);
  const [exposures, email] = await Promise.all([
    report.error ? undefined : checkExposures(report.finalUrl ?? report.url, stack, fetcher),
    checkEmail(domain.domain),
  ]);
  return { exposures, domain, email };
}

async function inventory(site: Site): Promise<{ stack: string[]; components: Component[] }> {
  const found = await detectAdapters(site.path);
  if (!found.length) throw new Error(`Aucune stack reconnue dans ${site.path}`);
  const lists = await Promise.all(found.map((a) => a.inventory(site.path)));
  return { stack: found.map((a) => a.id), components: dedupe(lists.flat()) };
}

/** Regroupe les correspondances par (écosystème, paquet, faille) : plusieurs versions installées → une seule ligne. */
function groupMatches(matches: Match[]) {
  const groups = new Map<string, { match: Match; versions: Set<string>; isDev: boolean }>();
  for (const m of matches) {
    const key = `${m.component.ecosystem}|${m.component.name}|${m.vulnerability.id}`;
    const group = groups.get(key);
    if (group) {
      group.versions.add(m.component.version);
      group.isDev &&= m.component.isDev;
    } else {
      groups.set(key, { match: m, versions: new Set([m.component.version]), isDev: m.component.isDev });
    }
  }
  return [...groups.values()];
}

export async function scanSite(db: Db, site: Site, { fetcher = fetch, httpCheck, onlineChecks }: ScanDeps = {}): Promise<ScanResult> {
  const scan = db.insert(scans).values({ siteId: site.id }).returning().get();
  try {
    const inv = await inventory(site);

    // Site en ligne (en-têtes, HTTPS, certificat) d'abord : il peut révéler la vraie version de PHP.
    const httpReport = site.url ? await (httpCheck ?? ((url) => runHttpCheck(url, { fetcher })))(site.url) : null;
    const report = httpReport && {
      ...httpReport,
      ...(await (onlineChecks ?? ((r, stack) => runOnlineChecks(db, fetcher, r, stack)))(httpReport, inv.stack)),
    };
    inv.components = resolvePhp(inv.components, inv.stack, { manual: site.phpVersion, production: phpFromReport(report) });
    inv.components = await markDirect(site.path, inv.components);

    // Les sources de failles s'appuient sur l'identité des objets (composants « non suivis ») : les dernières versions
    // sont cherchées en parallèle et reportées par position.
    const [results, withLatest] = await Promise.all([
      Promise.all(SOURCES.map((query) => query(db, fetcher, inv.components))),
      withLatestVersions(db, fetcher, inv.components),
    ]);
    const matches = results.flatMap((r) => r.matches);
    const untracked = new Set(results.flatMap((r) => r.untracked));
    if (report) matches.push(...webMatches(report));
    // Vérification impossible (site, registre ou DNS injoignable) : ses alertes existantes restent ouvertes.
    const unevaluated: string[] = report
      ? [
          ...(report.error && !report.cert ? WEB_CHECKS.http : []),
          ...(!report.exposures ? WEB_CHECKS.exposures : []),
          ...(report.domain?.error ? WEB_CHECKS.domain : []),
          ...(report.email?.error || report.domain?.error === 'Domaine inconnu du registre' ? WEB_CHECKS.email : []),
        ]
      : [];

    const kev = await loadKev(db, fetcher);
    const now = new Date();

    const result = db.transaction((tx) => {
      tx.update(sites).set({ stack: inv.stack.join(',') }).where(eq(sites.id, site.id)).run();
      if (inv.components.length) {
        tx.insert(components)
          .values(inv.components.map((c, i) => ({ ...c, latest: withLatest[i].latest, scanId: scan.id, untracked: untracked.has(c) })))
          .run();
      }

      for (const { vulnerability: v } of matches) {
        const row = { ...v, aliases: v.aliases.join(',') };
        // Sans flux KEV disponible, on conserve la valeur connue.
        const kevFlag = kev ? { isKev: [v.id, ...v.aliases].some((id) => kev.has(id)) } : {};
        tx.insert(vulnerabilities)
          .values({ ...row, ...kevFlag })
          .onConflictDoUpdate({ target: vulnerabilities.id, set: { ...row, ...kevFlag } })
          .run();
      }

      const existing = tx.select().from(findings).where(eq(findings.siteId, site.id)).all();
      const keyOf = (f: { ecosystem: string; componentName: string; vulnerabilityId: string }) =>
        `${f.ecosystem}|${f.componentName}|${f.vulnerabilityId}`;
      const byKey = new Map(existing.map((f) => [keyOf(f), f]));
      const seen = new Set<string>();
      const opened: Finding[] = [];

      for (const { match, versions, isDev } of groupMatches(matches)) {
        const values = {
          siteId: site.id,
          ecosystem: match.component.ecosystem,
          componentName: match.component.name,
          vulnerabilityId: match.vulnerability.id,
          version: [...versions].join(','),
          isDev,
          fixedIn: match.fixedIn,
          lastSeenAt: now,
        };
        const key = keyOf(values);
        seen.add(key);
        const prev = byKey.get(key);
        if (!prev) {
          opened.push(tx.insert(findings).values({ ...values, firstSeenAt: now }).returning().get());
        } else {
          const reopened = prev.status === 'fixed';
          const row = tx
            .update(findings)
            .set({ ...values, ...(reopened && { status: 'open' as const }) })
            .where(eq(findings.id, prev.id))
            .returning()
            .get();
          if (reopened) opened.push(row);
        }
      }

      const gone = existing
        .filter((f) => f.status !== 'fixed' && !seen.has(keyOf(f)) && !unevaluated.some((p) => f.vulnerabilityId.startsWith(p)))
        .map((f) => f.id);

      if (report) {
        tx.insert(httpChecks)
          .values({ siteId: site.id, scanId: scan.id, checkedAt: now, grade: report.grade ?? null, report: JSON.stringify(report) })
          .run();
      }
      if (gone.length) {
        tx.update(findings).set({ status: 'fixed' }).where(and(eq(findings.siteId, site.id), inArray(findings.id, gone))).run();
      }

      tx.update(scans).set({ status: 'ok', finishedAt: now }).where(eq(scans.id, scan.id)).run();
      return { opened, fixed: gone.length };
    });

    return { site, components: inv.components.length, untracked: untracked.size, ...result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.update(scans).set({ status: 'error', error, finishedAt: new Date() }).where(eq(scans.id, scan.id)).run();
    return { site, error, components: 0, untracked: 0, opened: [], fixed: 0 };
  }
}

/** Scanne les sites un par un ; l'échec d'un site n'arrête pas les autres. */
export async function scanAll(db: Db, deps: ScanDeps = {}, onResult?: (r: ScanResult) => void): Promise<ScanResult[]> {
  const active = db.select().from(sites).where(eq(sites.archived, false)).all();
  const results: ScanResult[] = [];
  for (const site of active) {
    const result = await scanSite(db, site, deps);
    onResult?.(result);
    results.push(result);
  }
  return results;
}
