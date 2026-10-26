import type { Component, Match, Severity } from '../types.ts';
import type { HttpReport } from './check.ts';

const DAY = 24 * 60 * 60 * 1000;

/** Préfixes des alertes produites par chaque vérification du site en ligne. */
export const WEB_CHECKS = {
  http: ['WEB-', 'TLS-'],
  exposures: ['EXPOSED-'],
  domain: ['DOMAIN-'],
  email: ['DNS-'],
} as const;

/** Échéance : expiré, moins de 7 jours, moins de 30 jours, ou rien à signaler. */
function expiry(isoDate: string, now: number): 'EXPIRED' | 'EXPIRING-7' | 'EXPIRING-30' | null {
  const left = Date.parse(isoDate) - now;
  if (left <= 0) return 'EXPIRED';
  if (left <= 7 * DAY) return 'EXPIRING-7';
  if (left <= 30 * DAY) return 'EXPIRING-30';
  return null;
}
const EXPIRY_SEVERITY = { EXPIRED: 'critical', 'EXPIRING-7': 'high', 'EXPIRING-30': 'medium' } as const;

/**
 * Alertes du site en ligne : HTTPS, certificat, fichiers exposés, nom de domaine et e-mail. Les en-têtes manquants
 * restent dans le rapport sans changer l'état du site. Identifiants partagés entre sites : les textes ne citent
 * ni domaine ni date.
 */
export function webMatches(report: HttpReport, now = Date.now()): Match[] {
  const host = new URL(report.finalUrl ?? report.url).hostname;
  const match = (name: string, version: string, id: string, severity: Severity, summary: string, url: string): Match => ({
    component: { ecosystem: 'web', name, version, isDev: false, source: 'manual' } satisfies Component,
    fixedIn: null,
    vulnerability: { id, source: 'http', aliases: [], summary, severity, cvss: null, url },
  });
  const out: Match[] = [];

  // Site injoignable : rien à conclure côté HTTP. Certificat refusé : on a le certificat, mais pas les en-têtes.
  if (report.finalUrl) {
    const site = (version: string, id: string, severity: Severity, summary: string) =>
      out.push(match(host, version, id, severity, summary, report.finalUrl!));
    if (!report.https) {
      site('http', 'WEB-NO-HTTPS', 'high', 'Le site n’est pas servi en HTTPS');
    } else {
      if (!report.error && report.httpsRedirect === false) {
        site('http', 'WEB-NO-HTTPS-REDIRECT', 'medium', 'http:// ne redirige pas vers https://');
      }
      const cert = report.cert;
      const level = cert && expiry(cert.validTo, now);
      const version = cert?.validTo.slice(0, 10) ?? '';
      if (level === 'EXPIRED') site(version, 'TLS-EXPIRED', 'critical', 'Certificat TLS expiré : le site affiche une alerte de sécurité');
      else if (cert && !cert.trusted) site(version, 'TLS-UNTRUSTED', 'high', 'Certificat TLS refusé par les navigateurs (chaîne ou nom de domaine invalide)');
      else if (level) site(version, `TLS-${level}`, EXPIRY_SEVERITY[level], `Certificat TLS expirant dans moins de ${level === 'EXPIRING-7' ? 7 : 30} jours`);
    }
  }

  for (const e of report.exposures ?? []) {
    if (e.status !== 'exposed') continue;
    out.push(match(host, new URL(e.url).pathname, `EXPOSED-${e.id.toUpperCase()}`, e.severity, e.title, e.url));
  }

  const domain = report.domain;
  const domainLevel = domain?.expiresAt ? expiry(domain.expiresAt, now) : null;
  if (domain && domainLevel) {
    const days = domainLevel === 'EXPIRING-7' ? 7 : 30;
    out.push(
      match(
        domain.domain,
        domain.expiresAt!.slice(0, 10),
        `DOMAIN-${domainLevel}`,
        EXPIRY_SEVERITY[domainLevel],
        domainLevel === 'EXPIRED'
          ? 'Nom de domaine expiré : site et e-mails coupés, domaine rachetable par un tiers'
          : `Nom de domaine expirant dans moins de ${days} jours : renouvellement à vérifier`,
        `https://lookup.icann.org/fr/lookup?name=${domain.domain}`,
      ),
    );
  }

  const email = report.email;
  if (domain && email && !email.error) {
    const dns = (id: string, severity: Severity, summary: string) =>
      out.push(match(domain.domain, 'dns', id, severity, summary, 'https://www.cloudflare.com/fr-fr/learning/email-security/dmarc-dkim-spf/'));
    if (email.mx) {
      if (!email.spf) dns('DNS-NO-SPF', 'medium', 'Pas d’enregistrement SPF : n’importe quel serveur peut envoyer des e-mails au nom du domaine');
      else if (/\+all\b/.test(email.spf)) dns('DNS-SPF-PERMISSIVE', 'high', 'SPF en « +all » : tous les serveurs du monde sont autorisés à envoyer au nom du domaine');
      if (!email.dmarc) dns('DNS-NO-DMARC', 'medium', 'Pas de politique DMARC : les e-mails usurpant le domaine ne sont pas rejetés');
      else if (email.dmarc.policy === 'none') dns('DNS-DMARC-NONE', 'low', 'DMARC en « p=none » : surveillance seule, les e-mails usurpés passent');
    } else if (!email.spf || !email.dmarc || email.dmarc.policy === 'none') {
      dns('DNS-NOMAIL-UNPROTECTED', 'low', 'Domaine sans e-mail mais usurpable : SPF « -all » et DMARC « p=reject » le protègent');
    }
  }
  return out;
}
