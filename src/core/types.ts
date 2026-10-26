/** `web` : le site en ligne lui-même (HTTPS, certificat). */
export type Ecosystem = 'npm' | 'packagist' | 'wp-core' | 'wp-plugin' | 'wp-theme' | 'runtime' | 'web';

export interface Component {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  isDev: boolean;
  /** `production` : lu sur le site en ligne (ex. PHP via X-Powered-By). */
  source: 'lockfile' | 'file' | 'manual' | 'production';
  direct?: boolean;
  latest?: string | null;
}

export interface StackAdapter {
  id: 'nuxt' | 'kirby' | 'wordpress';
  detect(dir: string): Promise<boolean>;
  inventory(dir: string): Promise<Component[]>;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface Vulnerability {
  id: string;
  source: string;
  aliases: string[];
  summary: string | null;
  severity: Severity;
  cvss: string | null;
  url: string;
}

export interface Match {
  component: Component;
  vulnerability: Vulnerability;
  fixedIn: string | null;
}

export interface VulnSourceResult {
  matches: Match[];
  /** Composants que la source ne connaît pas : ni sains ni vulnérables, à suivre à la main. */
  untracked: Component[];
}

/** Fusionne les doublons (même paquet, même version) ; dev seulement si toutes les occurrences le sont. */
export function dedupe(components: Component[]): Component[] {
  const byKey = new Map<string, Component>();
  for (const c of components) {
    const key = `${c.ecosystem}|${c.name}|${c.version}`;
    const prev = byKey.get(key);
    if (prev) prev.isDev &&= c.isDev;
    else byKey.set(key, { ...c });
  }
  return [...byKey.values()];
}
