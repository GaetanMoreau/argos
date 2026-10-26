import { inArray } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { vulnerabilities } from './db/schema.ts';
import { appleScriptString, exec } from './macos.ts';
import type { ScanResult } from './scan.ts';

interface Message {
  title: string;
  /** Texte court pour la notification macOS. */
  short: string;
  /** Détail complet, écrit dans le journal du scan. */
  body: string;
}

interface Report {
  urgent: Message | null;
  digest: Message | null;
}

const RANK = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 } as const;

/**
 * Urgent : faille critical/high ou exploitée (KEV), hors dépendances de dev.
 * Le reste (y compris les erreurs de scan) part dans le résumé.
 */
export function buildReport(db: Db, results: ScanResult[]): Report {
  const opened = results.flatMap((r) => r.opened.map((f) => ({ site: r.site.name, f })));
  const ids = [...new Set(opened.map((o) => o.f.vulnerabilityId))];
  const vulns = new Map(
    ids.length ? db.select().from(vulnerabilities).where(inArray(vulnerabilities.id, ids)).all().map((v) => [v.id, v]) : [],
  );

  const lines = opened
    .map(({ site, f }) => {
      const v = vulns.get(f.vulnerabilityId)!;
      const urgent = !f.isDev && (v.isKev || v.severity === 'critical' || v.severity === 'high');
      const tag = v.isKev ? 'EXPLOITÉE' : v.severity;
      const fix = f.fixedIn ? ` → ${f.fixedIn}` : '';
      return {
        urgent,
        rank: v.isKev ? -1 : RANK[v.severity],
        site,
        text: `[${tag}] ${site} · ${f.componentName}@${f.version}${fix}\n   ${v.summary ?? v.id}`,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  const urgent = lines.filter((l) => l.urgent);
  const rest = lines.filter((l) => !l.urgent);
  const errors = results.filter((r) => r.error).map((r) => `${r.site.name} : ${r.error}`);
  const sitesOf = (ls: typeof lines) => [...new Set(ls.map((l) => l.site))].join(', ');

  return {
    urgent: urgent.length
      ? {
          title: `⚠ ${urgent.length} alerte(s) urgente(s)`,
          short: `${sitesOf(urgent)}\n${urgent[0].text.split('\n')[1].trim()}`,
          body: urgent.map((l) => l.text).join('\n'),
        }
      : null,
    digest:
      rest.length || errors.length
        ? {
            title: 'Argos : résumé du scan',
            short: [
              rest.length && `${rest.length} nouveauté(s) : ${sitesOf(rest)}`,
              errors.length && `${errors.length} site(s) en erreur`,
            ]
              .filter(Boolean)
              .join('\n'),
            body: [...rest.map((l) => l.text), ...errors.map((e) => `[ERREUR] ${e}`)].join('\n'),
          }
        : null,
  };
}

async function notifyMac(m: Message, urgent: boolean) {
  const sound = urgent ? ' sound name "Basso"' : '';
  await exec('osascript', ['-e', `display notification ${appleScriptString(m.short)} with title ${appleScriptString(m.title)}${sound}`]);
}

/** Affiche le rapport en notifications macOS ; renvoie les échecs. */
export async function sendReport(report: Report): Promise<string[]> {
  const failures: string[] = [];
  for (const [message, urgent] of [
    [report.urgent, true],
    [report.digest, false],
  ] as const) {
    if (message) await notifyMac(message, urgent).catch((e) => failures.push(e.message));
  }
  return failures;
}
