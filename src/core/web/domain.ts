import { promises as dns } from 'node:dns';
import type { Db } from '../db/index.ts';
import { getJson, type Fetch } from '../http.ts';

export interface DomainInfo {
  domain: string;
  expiresAt: string | null;
  registrar: string | null;
  error: string | null;
}

export interface EmailInfo {
  /** Le domaine reçoit-il des e-mails ? */
  mx: boolean;
  spf: string | null;
  dmarc: { record: string; policy: string | null } | null;
  /** Sélecteurs DKIM trouvés parmi les plus courants (le vrai sélecteur peut être ailleurs). */
  dkim: string[];
  error: string | null;
}

/** Sélecteurs DKIM des services les plus répandus ; DKIM ne se découvre pas sans connaître le sélecteur. */
const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'mail', 'dkim', 's1', 's2', 'smtp', 'mailjet', 'sendgrid', 'zoho', 'protonmail', 'hostingermail1'];

type Resolver = { resolveTxt: (name: string) => Promise<string[][]>; resolveMx: (name: string) => Promise<unknown[]> };

async function txt(resolver: Resolver, name: string): Promise<string[]> {
  try {
    return (await resolver.resolveTxt(name)).map((parts) => parts.join(''));
  } catch (err: any) {
    if (['ENODATA', 'ENOTFOUND'].includes(err?.code)) return [];
    throw err;
  }
}

export async function checkEmail(domain: string, resolver: Resolver = dns): Promise<EmailInfo> {
  try {
    const [mx, root, dmarcTxt] = await Promise.all([
      resolver.resolveMx(domain).then((r) => r.length > 0, () => false),
      txt(resolver, domain),
      txt(resolver, `_dmarc.${domain}`),
    ]);
    const dmarc = dmarcTxt.find((r) => /^v=DMARC1/i.test(r)) ?? null;
    const dkim = (
      await Promise.all(DKIM_SELECTORS.map(async (s) => ((await txt(resolver, `${s}._domainkey.${domain}`)).some((r) => /p=/.test(r)) ? s : null)))
    ).filter((s): s is string => Boolean(s));
    return {
      mx,
      spf: root.find((r) => /^v=spf1/i.test(r)) ?? null,
      dmarc: dmarc ? { record: dmarc, policy: dmarc.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase() ?? null } : null,
      dkim,
      error: null,
    };
  } catch (err) {
    return { mx: false, spf: null, dmarc: null, dkim: [], error: `DNS injoignable (${(err as any)?.code ?? (err as Error).message})` };
  }
}

const vcardName = (entity: any): string | null => entity?.vcardArray?.[1]?.find((v: any[]) => v[0] === 'fn')?.[3] ?? null;

/**
 * Date d'expiration du nom de domaine via RDAP (successeur officiel du WHOIS). Le serveur du registre vient de la
 * liste de l'IANA. Du nom le plus long au plus court (3 labels puis 2) : `bbc.co.uk` avant `co.uk`, qui existe aussi
 * chez le registre ; `blog.site.fr` est inconnu (404) et cède la place à `site.fr`.
 */
export async function checkDomain(db: Db, fetcher: Fetch, hostname: string): Promise<DomainInfo> {
  const labels = hostname.replace(/^www\./, '').split('.');
  const candidates = [labels.length > 2 ? labels.slice(-3).join('.') : null, labels.slice(-2).join('.')].filter(
    (d): d is string => Boolean(d),
  );
  try {
    const boot = await getJson(db, fetcher, 'https://data.iana.org/rdap/dns.json');
    const tld = labels.at(-1)!;
    const base: string | undefined = boot.services?.find(([tlds]: [string[]]) => tlds.includes(tld))?.[1]?.[0];
    if (!base) return { domain: candidates.at(-1)!, expiresAt: null, registrar: null, error: `Pas de serveur RDAP pour .${tld}` };
    for (const domain of candidates) {
      const res = await fetcher(`${base.replace(/\/?$/, '/')}domain/${domain}`, {
        headers: { accept: 'application/rdap+json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        domain,
        expiresAt: data.events?.find((e: any) => e.eventAction === 'expiration')?.eventDate ?? null,
        registrar: vcardName(data.entities?.find((e: any) => e.roles?.includes('registrar'))),
        error: null,
      };
    }
    return { domain: candidates.at(-1)!, expiresAt: null, registrar: null, error: 'Domaine inconnu du registre' };
  } catch (err) {
    return { domain: candidates.at(-1)!, expiresAt: null, registrar: null, error: `Registre injoignable (${(err as Error).message})` };
  }
}
