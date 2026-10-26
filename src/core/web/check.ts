import { connect } from 'node:tls';
import type { Fetch } from '../http.ts';
import { analyzeResponse, type HeaderAnalysis } from './analyze.ts';
import type { DomainInfo, EmailInfo } from './domain.ts';
import type { Exposure } from './exposure.ts';

interface CertInfo {
  validTo: string; // ISO
  issuer: string | null;
  /** Chaîne de confiance et nom de domaine valides. */
  trusted: boolean;
  error: string | null;
}

export interface HttpReport extends Partial<HeaderAnalysis> {
  url: string;
  checkedAt: string;
  /** Erreur bloquante (site injoignable) : le reste du rapport est absent. */
  error: string | null;
  finalUrl?: string;
  statusCode?: number;
  https?: boolean;
  /** http:// redirige vers https:// ? `null` si la vérification n'a pas pu se faire. */
  httpsRedirect?: boolean | null;
  cert?: CertInfo | null;
  /** Fichiers sensibles cherchés en production ; absent si le site était injoignable. */
  exposures?: Exposure[];
  domain?: DomainInfo;
  email?: EmailInfo;
}

type CertReader = (host: string, port?: number) => Promise<CertInfo>;

const TIMEOUT = 10_000;
export const USER_AGENT = 'Argos (veille de sécurité ; +local)';
const HEADERS = { 'user-agent': USER_AGENT, accept: 'text/html,*/*' };

/** Certificat présenté par le serveur, lu même s'il est invalide. */
const readCert: CertReader = (host, port = 443) =>
  new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false, timeout: TIMEOUT }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return reject(new Error('Aucun certificat présenté'));
      const error = socket.authorizationError ? String(socket.authorizationError) : null;
      resolve({
        validTo: new Date(cert.valid_to).toISOString(),
        issuer: [cert.issuer?.O ?? cert.issuer?.CN ?? null].flat()[0] ?? null,
        trusted: socket.authorized,
        error,
      });
    });
    socket.on('timeout', () => socket.destroy(new Error('Délai dépassé')));
    socket.on('error', reject);
  });

/** Lit au plus `limit` octets du corps (la balise generator est dans le <head>). */
export async function readBody(res: Response, limit = 200_000): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

async function checkRedirect(fetcher: Fetch, host: string): Promise<boolean | null> {
  try {
    const res = await fetcher(`http://${host}/`, { redirect: 'manual', headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
    const location = res.headers.get('location') ?? '';
    return res.status >= 300 && res.status < 400 && location.startsWith('https://');
  } catch {
    return null;
  }
}

export async function runHttpCheck(
  url: string,
  deps: { fetcher?: Fetch; certReader?: CertReader } = {},
): Promise<HttpReport> {
  const { fetcher = fetch, certReader = readCert } = deps;
  const checkedAt = new Date().toISOString();
  const target = new URL(url);

  let res: Response;
  try {
    res = await fetcher(target.href, { redirect: 'follow', headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    const cause = String((err as any)?.cause?.code ?? (err as Error).message);
    // Refus dû au certificat : c'est précisément ce qu'il faut signaler, on lit donc le certificat.
    if (target.protocol === 'https:' && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(cause)) {
      const cert = await certReader(target.hostname, Number(target.port) || 443).catch(() => null);
      if (cert) {
        return {
          url,
          checkedAt,
          error: `Connexion refusée par le navigateur : certificat invalide (${cause})`,
          finalUrl: target.href,
          https: true,
          cert: { ...cert, trusted: false, error: cert.error ?? cause },
        };
      }
    }
    return { url, checkedAt, error: `Site injoignable (${cause})` };
  }

  const finalUrl = new URL(res.url || target.href);
  const https = finalUrl.protocol === 'https:';
  const body = await readBody(res).catch(() => '');
  const analysis = analyzeResponse({ headers: Object.fromEntries(res.headers.entries()), body, https });

  const [cert, httpsRedirect] = await Promise.all([
    https ? certReader(finalUrl.hostname, Number(finalUrl.port) || 443).catch(() => null) : Promise.resolve(null),
    checkRedirect(fetcher, finalUrl.hostname),
  ]);

  return {
    url,
    checkedAt,
    error: null,
    finalUrl: finalUrl.href,
    statusCode: res.status,
    https,
    httpsRedirect,
    cert,
    ...analysis,
  };
}
