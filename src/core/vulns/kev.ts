import type { Db } from '../db/index.ts';
import { getJson, type Fetch } from '../http.ts';

const FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

/** CVE activement exploitées (catalogue CISA KEV), ou `null` si le flux est indisponible. */
export async function loadKev(db: Db, fetcher: Fetch): Promise<Set<string> | null> {
  try {
    const feed = await getJson(db, fetcher, FEED);
    return new Set((feed.vulnerabilities ?? []).map((v: any) => v.cveID));
  } catch {
    return null;
  }
}
