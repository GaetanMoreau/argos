import { mapLimit, type Fetch } from '../http.ts';
import type { Severity } from '../types.ts';
import { readBody, USER_AGENT } from './check.ts';

interface Probe {
  id: string;
  /** Chemins essayés dans l'ordre ; le premier exposé suffit. */
  paths: string[];
  /** Stacks concernées ; absent = tous les sites. */
  stacks?: string[];
  severity: Severity;
  title: string;
  /** Le contenu prouve l'exposition : beaucoup de serveurs répondent 200 avec leur page d'erreur. */
  matches: (body: string) => boolean;
}

const isHtml = (body: string) => /<(!doctype|html|head|body)\b/i.test(body.slice(0, 2000));
const isJson = (body: string, test: (json: any) => boolean) => {
  try {
    return test(JSON.parse(body));
  } catch {
    return false;
  }
};

const PROBES: Probe[] = [
  {
    id: 'git',
    paths: ['/.git/HEAD'],
    severity: 'critical',
    title: 'Dépôt Git exposé : code source et historique téléchargeables',
    matches: (b) => /^(ref: refs\/|[0-9a-f]{40}\s*$)/.test(b),
  },
  {
    id: 'env',
    paths: ['/.env'],
    severity: 'critical',
    title: 'Fichier .env exposé : mots de passe et clés lisibles',
    matches: (b) => !isHtml(b) && /^[A-Z][A-Z0-9_]*=/m.test(b),
  },
  {
    id: 'phpinfo',
    paths: ['/phpinfo.php', '/info.php'],
    severity: 'high',
    title: 'Page phpinfo() publique : configuration complète du serveur',
    matches: (b) => /phpinfo\(\)|<title>PHP \d/i.test(b),
  },
  {
    id: 'server-status',
    paths: ['/server-status'],
    severity: 'medium',
    title: 'Page d’état d’Apache publique : requêtes et visiteurs en cours',
    matches: (b) => /Apache Server Status/i.test(b),
  },
  {
    id: 'composer',
    paths: ['/composer.json', '/composer.lock'],
    severity: 'low',
    title: 'composer.json public : dépendances et versions exposées',
    matches: (b) => isJson(b, (j) => Boolean(j.require || j.packages)),
  },
  {
    id: 'ds-store',
    paths: ['/.DS_Store'],
    severity: 'low',
    title: 'Fichier .DS_Store public : liste des fichiers du dossier',
    matches: (b) => b.includes('Bud1'),
  },
  {
    id: 'wp-config-backup',
    paths: ['/wp-config.php.bak', '/wp-config.php~', '/wp-config.php.old', '/wp-config.php.save', '/wp-config.txt'],
    stacks: ['wordpress'],
    severity: 'critical',
    title: 'Copie de wp-config.php lisible : identifiants de la base exposés',
    matches: (b) => /DB_(PASSWORD|NAME|USER)/.test(b),
  },
  {
    id: 'wp-debug-log',
    paths: ['/wp-content/debug.log'],
    stacks: ['wordpress'],
    severity: 'high',
    title: 'Journal de débogage WordPress public : chemins et erreurs du serveur',
    matches: (b) => !isHtml(b) && /PHP (Fatal|Warning|Notice|Deprecated|Parse)|^\[\d{2}-\w{3}-\d{4}/m.test(b),
  },
  {
    id: 'wp-users',
    paths: ['/wp-json/wp/v2/users'],
    stacks: ['wordpress'],
    severity: 'medium',
    title: 'Liste des comptes WordPress publique : identifiants de connexion devinables',
    matches: (b) => isJson(b, (j) => Array.isArray(j) && j.some((u) => typeof u?.slug === 'string')),
  },
  {
    id: 'wp-xmlrpc',
    paths: ['/xmlrpc.php'],
    stacks: ['wordpress'],
    severity: 'medium',
    title: 'xmlrpc.php actif : porte d’entrée pour les attaques par force brute',
    matches: (b) => /XML-RPC server accepts POST requests only/i.test(b),
  },
  {
    id: 'wp-uploads-listing',
    paths: ['/wp-content/uploads/'],
    stacks: ['wordpress'],
    severity: 'medium',
    title: 'Contenu de /wp-content/uploads/ listé par le serveur',
    matches: (b) => /<title>Index of/i.test(b),
  },
  {
    id: 'wp-readme',
    paths: ['/readme.html'],
    stacks: ['wordpress'],
    severity: 'low',
    title: 'readme.html public : version de WordPress exposée',
    matches: (b) => /WordPress/.test(b) && /ReadMe|Lisez-moi/i.test(b),
  },
  {
    id: 'kirby-content',
    paths: ['/content/site.txt'],
    stacks: ['kirby'],
    severity: 'medium',
    title: 'Dossier content/ de Kirby lisible directement (brouillons compris)',
    matches: (b) => !isHtml(b) && /^Title:/m.test(b),
  },
  {
    id: 'kirby-version',
    paths: ['/kirby/composer.json'],
    stacks: ['kirby'],
    severity: 'low',
    title: 'kirby/composer.json public : version de Kirby exposée',
    matches: (b) => isJson(b, (j) => j.name === 'getkirby/cms'),
  },
];

type ExposureStatus = 'exposed' | 'ok' | 'unknown';

export interface Exposure {
  id: string;
  title: string;
  severity: Severity;
  status: ExposureStatus;
  /** Adresse du fichier exposé, ou chemin principal vérifié. */
  url: string;
}

const TIMEOUT = 8000;
const MAX_BODY = 64 * 1024;

async function probePath(fetcher: Fetch, url: string): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetcher(url, { redirect: 'manual', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, body: '' };
    }
    return { status: 200, body: await readBody(res, MAX_BODY) };
  } catch {
    return null;
  }
}

/**
 * Cherche les fichiers sensibles laissés accessibles en production. Requêtes GET en lecture seule, sans suivre les
 * redirections (une redirection n'expose rien), et seulement les vérifications de la stack du site.
 */
export async function checkExposures(baseUrl: string, stack: string[], fetcher: Fetch = fetch): Promise<Exposure[]> {
  const origin = new URL(baseUrl).origin;
  const probes = PROBES.filter((p) => !p.stacks || p.stacks.some((s) => stack.includes(s)));
  return mapLimit(probes, 4, async (probe): Promise<Exposure> => {
    let reachable = false;
    for (const path of probe.paths) {
      const res = await probePath(fetcher, origin + path);
      if (res) reachable = true;
      if (res?.status === 200 && probe.matches(res.body)) {
        return { id: probe.id, title: probe.title, severity: probe.severity, status: 'exposed', url: origin + path };
      }
    }
    return { id: probe.id, title: probe.title, severity: probe.severity, status: reachable ? 'ok' : 'unknown', url: origin + probe.paths[0] };
  });
}
