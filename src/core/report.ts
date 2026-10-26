import type { Db } from './db/index.ts';
import { siteDetail } from './queries.ts';
import { updateLag } from './version.ts';

const DAY = 24 * 60 * 60 * 1000;

type Detail = NonNullable<ReturnType<typeof siteDetail>>;
type Finding = Detail['findings'][number];

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown'];

const STACK_NAMES: Record<string, [string, string, string]> = {
  wordpress: ['WordPress', 'wp-core', 'wordpress'],
  kirby: ['Kirby', 'packagist', 'getkirby/cms'],
  nuxt: ['Nuxt', 'npm', 'nuxt'],
};

const isLifecycle = (f: Finding) => /^(EOL-|WP-CORE-)/.test(f.vulnId);

/** Noms parlants pour le client ; les autres composants gardent leur nom technique. */
const FRIENDLY_NAMES: Record<string, string> = {
  'getkirby/cms': 'Kirby',
  wordpress: 'WordPress',
  nuxt: 'Nuxt',
  nodejs: 'Node.js',
  php: 'PHP',
};
const friendly = (component: string) => FRIENDLY_NAMES[component] ?? component;
const isUrgent = (f: Finding) => !f.isDev && (f.isKev || f.severity === 'critical' || f.severity === 'high');

/**
 * Actions recommandées, de la plus urgente à la moins urgente, formulées pour le client. Une faille de code se
 * corrige par une mise à jour : on regroupe donc par composant plutôt que de lister chaque faille.
 */
function recommendations(d: Detail): string[] {
  const open = d.findings.filter((f) => f.status === 'open' && !f.isDev);
  const out: string[] = [];

  for (const f of open.filter((f) => /^(TLS-|DOMAIN-)|^WEB-NO-HTTPS$/.test(f.vulnId))) out.push(f.summary ?? f.vulnId);
  for (const f of open.filter((f) => f.vulnId.startsWith('EXPOSED-') && f.severity !== 'low')) out.push(`Bloquer l’accès : ${f.summary}`);

  // Composant déjà hors support ou « non sûr » : sa ligne de cycle de vie dit déjà de le mettre à jour. Une fin de
  // support seulement prochaine ne dispense pas de corriger ses failles tout de suite.
  const lifecycleComponents = new Set(open.filter((f) => isLifecycle(f) && !f.vulnId.startsWith('EOL-SOON-')).map((f) => f.component));
  const byComponent = new Map<string, Finding[]>();
  for (const f of open.filter((f) => isUrgent(f) && f.ecosystem !== 'web' && !isLifecycle(f) && !lifecycleComponents.has(f.component))) {
    byComponent.set(f.component, [...(byComponent.get(f.component) ?? []), f]);
  }
  for (const [component, list] of byComponent) {
    const target = list.map((f) => f.fixedIn).filter(Boolean).sort().at(-1);
    out.push(`Mettre à jour ${friendly(component)}${target ? ` vers ${target}` : ''} : ${list.length > 1 ? `${list.length} failles de sécurité` : 'une faille de sécurité'} corrigée${list.length > 1 ? 's' : ''}`);
  }
  for (const f of open.filter(isLifecycle)) out.push(f.summary ?? f.vulnId);
  if (open.some((f) => f.vulnId === 'WEB-NO-HTTPS-REDIRECT')) out.push('Rediriger automatiquement http:// vers https://');
  for (const f of open.filter((f) => f.vulnId.startsWith('DNS-'))) out.push(f.summary ?? f.vulnId);
  for (const f of open.filter((f) => f.vulnId.startsWith('EXPOSED-') && f.severity === 'low')) out.push(`Bloquer l’accès : ${f.summary}`);

  const grade = d.http?.grade;
  if (grade && ['D', 'E', 'F'].includes(grade)) out.push(`Ajouter les en-têtes de sécurité manquants (note actuelle : ${grade})`);
  const perf = d.pagespeed?.result?.scores.performance;
  if (perf != null && perf < 90) out.push(`Améliorer la vitesse d’affichage sur mobile (note actuelle : ${perf}/100)`);
  const majors = d.components.filter((c) => c.direct && updateLag(c.version, c.latest) === 'major').length;
  if (majors) out.push(`Planifier ${majors} mise${majors > 1 ? 's' : ''} à jour majeure${majors > 1 ? 's' : ''} de composants`);

  return [...new Set(out)];
}

function siteReport(d: Detail, since: number) {
  const open = d.findings.filter((f) => f.status === 'open' && !f.isDev);
  const fixed = d.findings.filter((f) => f.status === 'fixed' && !f.isDev && Date.parse(f.lastSeenAt) >= since);
  const technologies = d.site.stack.map((s) => {
    const [label, ecosystem, name] = STACK_NAMES[s] ?? [s, '', ''];
    const version = d.components.find((c) => c.ecosystem === ecosystem && c.name === name)?.version;
    return version ? `${label} ${version}` : label;
  });
  const updates = d.components.filter((c) => c.direct && updateLag(c.version, c.latest));
  const status = d.site.status === 'critical' ? 'action' : d.site.status === 'warning' ? 'watch' : d.site.status === 'ok' ? 'healthy' : 'unknown';

  return {
    id: d.site.id,
    name: d.site.name,
    url: d.site.url,
    status,
    technologies,
    php: d.php?.manual ?? d.php?.version ?? null,
    lastScanAt: d.scans.find((s) => s.status === 'ok')?.at ?? null,
    online: {
      grade: d.http?.grade ?? null,
      https: d.http?.https ?? null,
      certExpiresAt: d.http?.cert?.validTo ?? null,
      domain: d.http?.domain?.domain ?? null,
      domainExpiresAt: d.http?.domain?.expiresAt ?? null,
      performance: d.pagespeed?.result?.scores.performance ?? null,
      accessibility: d.pagespeed?.result?.scores.accessibility ?? null,
    },
    open: {
      total: open.length,
      urgent: open.filter(isUrgent).length,
      bySeverity: Object.fromEntries(
        SEVERITY_ORDER.map((s) => [s, open.filter((f) => f.severity === s).length]).filter(([, n]) => n),
      ) as Record<string, number>,
    },
    fixed: {
      total: fixed.length,
      items: [...new Map(fixed.map((f) => [`${f.component}|${f.summary}`, f])).values()]
        .slice(0, 8)
        .map((f) => ({ component: friendly(f.component), summary: f.summary ?? f.vulnId, severity: f.severity })),
    },
    ignored: d.findings.filter((f) => f.status === 'ignored').length,
    updates: { total: updates.length, major: updates.filter((c) => updateLag(c.version, c.latest) === 'major').length },
    recommendations: recommendations(d),
  };
}

/** Rapport de maintenance d'un site, lisible par le client : état, corrections de la période, recommandations. */
export function siteMaintenanceReport(db: Db, siteId: number, days = 30, now = Date.now()) {
  const detail = siteDetail(db, siteId);
  if (!detail) return null;
  return {
    client: detail.client,
    generatedAt: new Date(now).toISOString(),
    days,
    site: siteReport(detail, now - days * DAY),
  };
}
