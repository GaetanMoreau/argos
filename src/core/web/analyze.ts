/** Analyse des en-têtes HTTP d'un site en ligne, barème inspiré de securityheaders.com. */

type CheckStatus = 'ok' | 'warn' | 'missing';

interface HeaderCheck {
  id: 'hsts' | 'csp' | 'xfo' | 'xcto' | 'referrer' | 'permissions';
  name: string;
  status: CheckStatus;
  value: string | null;
  /** Ce que l'en-tête apporte, ou ce qui cloche. */
  note: string;
}

interface Leak {
  header: string;
  value: string;
}

interface DetectedTech {
  name: string;
  version: string | null;
  /** D'où vient l'information (affichée en infobulle). */
  evidence: string;
}

type Grade ='A+' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface HeaderAnalysis {
  headers: HeaderCheck[];
  leaks: Leak[];
  /** CMS ou framework reconnu sur la page d'accueil, avec sa version si elle est exposée. */
  tech: DetectedTech | null;
  grade: Grade;
}

const SIX_MONTHS = 15_552_000;

type Getter = (name: string) => string | null;

function hsts(get: Getter, https: boolean): HeaderCheck {
  const value = get('strict-transport-security');
  const base = { id: 'hsts' as const, name: 'Strict-Transport-Security', value };
  if (!https) return { ...base, status: 'missing', note: 'Sans HTTPS, HSTS ne peut pas s’appliquer.' };
  if (!value) return { ...base, status: 'missing', note: 'Le navigateur peut encore tenter une connexion non chiffrée.' };
  const maxAge = Number(value.match(/max-age=(\d+)/i)?.[1] ?? 0);
  if (maxAge < SIX_MONTHS) {
    return { ...base, status: 'warn', note: `max-age trop court (${maxAge} s) : au moins 6 mois recommandés.` };
  }
  return { ...base, status: 'ok', note: 'Force HTTPS côté navigateur.' };
}

function csp(get: Getter): HeaderCheck {
  const value = get('content-security-policy');
  const base = { id: 'csp' as const, name: 'Content-Security-Policy', value };
  if (!value) return { ...base, status: 'missing', note: 'Aucune limite sur les scripts et ressources chargés : protection XSS absente.' };
  if (/'unsafe-(inline|eval)'/.test(value)) {
    return { ...base, status: 'warn', note: 'Autorise unsafe-inline ou unsafe-eval : la protection XSS est affaiblie.' };
  }
  return { ...base, status: 'ok', note: 'Limite les sources de scripts et de ressources.' };
}

function xfo(get: Getter): HeaderCheck {
  const value = get('x-frame-options');
  const base = { id: 'xfo' as const, name: 'X-Frame-Options', value };
  if (/frame-ancestors/i.test(get('content-security-policy') ?? '')) {
    return { ...base, status: 'ok', note: 'Couvert par la directive CSP frame-ancestors.' };
  }
  if (!value) return { ...base, status: 'missing', note: 'Le site peut être intégré dans une iframe (clickjacking).' };
  if (/allow-from/i.test(value)) return { ...base, status: 'warn', note: 'ALLOW-FROM est ignoré par les navigateurs récents.' };
  return { ...base, status: 'ok', note: 'Empêche l’intégration dans une iframe tierce.' };
}

function xcto(get: Getter): HeaderCheck {
  const value = get('x-content-type-options');
  const base = { id: 'xcto' as const, name: 'X-Content-Type-Options', value };
  if (value?.toLowerCase().trim() === 'nosniff') return { ...base, status: 'ok', note: 'Empêche le navigateur de deviner le type des fichiers.' };
  return { ...base, status: value ? 'warn' : 'missing', note: 'Attendu : nosniff.' };
}

function referrer(get: Getter): HeaderCheck {
  const value = get('referrer-policy');
  const base = { id: 'referrer' as const, name: 'Referrer-Policy', value };
  if (!value) return { ...base, status: 'missing', note: 'L’adresse complète des pages peut fuiter vers les sites tiers.' };
  if (/unsafe-url|no-referrer-when-downgrade/i.test(value)) {
    return { ...base, status: 'warn', note: 'Politique permissive : préférer strict-origin-when-cross-origin.' };
  }
  return { ...base, status: 'ok', note: 'Limite les informations transmises aux autres sites.' };
}

function permissions(get: Getter): HeaderCheck {
  const value = get('permissions-policy');
  const base = { id: 'permissions' as const, name: 'Permissions-Policy', value };
  if (!value) return { ...base, status: 'missing', note: 'Caméra, micro, géolocalisation… non restreints explicitement.' };
  return { ...base, status: 'ok', note: 'Restreint les fonctions sensibles du navigateur.' };
}

/** Révèle une version précise du serveur ou du langage. */
function leaks(get: Getter): Leak[] {
  const out: Leak[] = [];
  const server = get('server');
  if (server && /\d/.test(server)) out.push({ header: 'Server', value: server });
  for (const header of ['X-Powered-By', 'X-AspNet-Version', 'X-Generator']) {
    const value = get(header.toLowerCase());
    if (value) out.push({ header, value });
  }
  return out;
}

/** `Drupal 10 (https://…)` → { Drupal, 10 } ; `Astro v4.5.0` → { Astro, 4.5.0 } ; `Joomla! - Open Source…` → { Joomla!, null }. */
function parseGenerator(content: string): DetectedTech {
  const clean = content.replace(/\s*\(.*\)\s*$/, '').split(/\s+-\s+/)[0].trim();
  const version = clean.match(/\bv?(\d+(?:\.\d+)*)/)?.[1] ?? null;
  const name = clean.replace(/\s*\bv?\d.*$/, '').trim() || clean;
  return { name, version, evidence: 'balise generator' };
}

/**
 * Sans balise generator, les fichiers du cœur portent `?ver=<version de WordPress>`, sauf les bibliothèques
 * embarquées (jQuery…) qui portent leur propre version : on écarte celles-ci et on garde la plus fréquente.
 */
function wpVersionFromAssets(html: string): string | null {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/\/wp-includes\/([^"'?\s]+)\?ver=(\d+(?:\.\d+)+)/g)) {
    if (/jquery|underscore|backbone|moxie|plupload|tinymce|imagesloaded|masonry/i.test(m[1])) continue;
    counts.set(m[2], (counts.get(m[2]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Techno du site en ligne : balise generator, puis en-têtes, puis structure de la page. */
export function detectTech(get: Getter, html: string): DetectedTech | null {
  const generators = [...html.matchAll(/<meta[^>]+name=["']generator["'][^>]*>/gi)]
    .map((m) => m[0].match(/content=["']([^"']+)["']/i)?.[1])
    .filter((c): c is string => Boolean(c))
    .map(parseGenerator);
  // Un thème ou un plugin peut ajouter sa propre balise : le CMS passe en premier.
  const cms = generators.find((g) => /^(wordpress|drupal|joomla|ghost|typo3|kirby)/i.test(g.name));
  if (cms ?? generators[0]) return cms ?? generators[0];

  const poweredBy = get('x-powered-by') ?? '';
  if (/nuxt/i.test(poweredBy)) return { name: 'Nuxt', version: null, evidence: 'en-tête X-Powered-By' };
  if (/next\.js/i.test(poweredBy)) return { name: 'Next.js', version: null, evidence: 'en-tête X-Powered-By' };

  if (/\/wp-(content|includes)\//.test(html)) {
    return { name: 'WordPress', version: wpVersionFromAssets(html), evidence: 'structure de la page' };
  }
  if (/id=["']__nuxt["']|\/_nuxt\//.test(html)) return { name: 'Nuxt', version: null, evidence: 'structure de la page' };
  if (/__NEXT_DATA__|\/_next\/static\//.test(html)) return { name: 'Next.js', version: null, evidence: 'structure de la page' };
  // Médias Kirby : /media/pages/<page>/<hash>-<horodatage>/<fichier>, éventuellement sur un CDN.
  if (/kirby_session/i.test(get('set-cookie') ?? '') || /\/media\/(pages|site|users)\/[^"'\s]*\/[a-f0-9]{8,}-\d+\//.test(html)) {
    return { name: 'Kirby', version: null, evidence: 'structure de la page' };
  }
  return null;
}

/**
 * Note : 6 en-têtes présents → A (A+ sans avertissement ni fuite de version), puis une lettre de moins
 * par en-tête manquant ; un site sans HTTPS est noté F.
 */
export function grade(checks: HeaderCheck[], leakCount: number, https: boolean): Grade {
  if (!https) return 'F';
  const present = checks.filter((c) => c.status !== 'missing').length;
  const scale: Grade[] = ['F', 'F', 'E', 'D', 'C', 'B', 'A'];
  const base = scale[present];
  return base === 'A' && leakCount === 0 && checks.every((c) => c.status === 'ok') ? 'A+' : base;
}

export function analyzeResponse(input: { headers: Record<string, string>; body: string; https: boolean }): HeaderAnalysis {
  const lower = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const get: Getter = (name) => lower[name] ?? null;
  const checks = [hsts(get, input.https), csp(get), xfo(get), xcto(get), referrer(get), permissions(get)];
  const found = leaks(get);
  return {
    headers: checks,
    leaks: found,
    tech: detectTech(get, input.body),
    grade: grade(checks, found.length, input.https),
  };
}
