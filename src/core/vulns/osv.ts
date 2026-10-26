import semver from 'semver';
import type { Db } from '../db/index.ts';
import { getJson, mapLimit, postJson, type Fetch } from '../http.ts';
import type { Component, Ecosystem, Severity, Vulnerability, VulnSourceResult } from '../types.ts';

const API = 'https://api.osv.dev/v1';
const BATCH_SIZE = 1000;

const OSV_ECOSYSTEMS: Partial<Record<Ecosystem, string>> = {
  npm: 'npm',
  packagist: 'Packagist',
};

const SEVERITIES: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

function toVulnerability(osv: any): Vulnerability {
  return {
    id: osv.id,
    source: 'osv',
    aliases: osv.aliases ?? [],
    summary: osv.summary ?? osv.details?.split('\n')[0] ?? null,
    severity: SEVERITIES[String(osv.database_specific?.severity).toUpperCase()] ?? 'unknown',
    cvss: osv.severity?.find((s: any) => s.type.startsWith('CVSS'))?.score ?? null,
    url: `https://osv.dev/vulnerability/${osv.id}`,
  };
}

const cmp = (a: string, b: string): number | null => {
  const [x, y] = [semver.coerce(a, { includePrerelease: true }), semver.coerce(b, { includePrerelease: true })];
  return x && y ? semver.compare(x, y) : null;
};

/** Version corrigeant `osv` pour ce composant : fin de l'intervalle qui contient la version installée. */
export function fixedVersion(osv: any, component: Component): string | null {
  const ecosystem = OSV_ECOSYSTEMS[component.ecosystem];
  const candidates: string[] = [];
  for (const affected of osv.affected ?? []) {
    if (affected.package?.name !== component.name || affected.package?.ecosystem !== ecosystem) continue;
    for (const range of affected.ranges ?? []) {
      let introduced: string | null = null;
      for (const event of range.events ?? []) {
        if (event.introduced) introduced = event.introduced;
        if (event.fixed) {
          const inRange =
            (introduced === '0' || (cmp(component.version, introduced ?? '0') ?? 0) >= 0) &&
            (cmp(component.version, event.fixed) ?? 0) < 0;
          if (inRange) return event.fixed;
          candidates.push(event.fixed);
        }
      }
    }
  }
  // À défaut, la plus petite version corrigée supérieure à la version installée.
  return candidates.filter((v) => (cmp(v, component.version) ?? 0) > 0).sort((a, b) => cmp(a, b) ?? 0)[0] ?? null;
}

export async function queryOsv(db: Db, fetcher: Fetch, components: Component[]): Promise<VulnSourceResult> {
  const covered = components.filter((c) => OSV_ECOSYSTEMS[c.ecosystem]);
  const hits: { component: Component; id: string }[] = [];

  for (let i = 0; i < covered.length; i += BATCH_SIZE) {
    const batch = covered.slice(i, i + BATCH_SIZE);
    const query = (c: Component, pageToken?: string) => ({
      package: { name: c.name, ecosystem: OSV_ECOSYSTEMS[c.ecosystem] },
      version: c.version,
      ...(pageToken && { page_token: pageToken }),
    });
    const { results } = await postJson(fetcher, `${API}/querybatch`, { queries: batch.map((c) => query(c)) });
    for (const [j, result] of (results as any[]).entries()) {
      let page = result;
      for (;;) {
        for (const v of page.vulns ?? []) hits.push({ component: batch[j], id: v.id });
        if (!page.next_page_token) break;
        const next = await postJson(fetcher, `${API}/querybatch`, { queries: [query(batch[j], page.next_page_token)] });
        page = next.results[0];
      }
    }
  }

  const ids = [...new Set(hits.map((h) => h.id))];
  const details = new Map(
    await mapLimit(ids, 8, async (id) => [id, await getJson(db, fetcher, `${API}/vulns/${id}`)] as const),
  );

  const matches = hits.map(({ component, id }) => {
    const osv = details.get(id);
    return { component, vulnerability: toVulnerability(osv), fixedIn: fixedVersion(osv, component) };
  });
  // OSV ne distingue pas un paquet inconnu d'un paquet sain.
  return { matches, untracked: [] };
}
