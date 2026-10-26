import { eq } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { httpCache } from './db/schema.ts';

export type Fetch = typeof fetch;

const DAY = 24 * 60 * 60 * 1000;

async function request(fetcher: Fetch, url: string, init?: RequestInit): Promise<any> {
  const res = await fetcher(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}`);
  return res.json();
}

/** GET JSON, mis en cache en base pendant `ttl` ms. */
export async function getJson(db: Db, fetcher: Fetch, url: string, ttl = DAY): Promise<any> {
  const cached = db.select().from(httpCache).where(eq(httpCache.key, url)).get();
  if (cached && Date.now() - cached.fetchedAt.getTime() < ttl) return JSON.parse(cached.body);

  const body = await request(fetcher, url);
  const row = { key: url, body: JSON.stringify(body), fetchedAt: new Date() };
  db.insert(httpCache).values(row).onConflictDoUpdate({ target: httpCache.key, set: row }).run();
  return body;
}

export function postJson(fetcher: Fetch, url: string, body: unknown): Promise<any> {
  return request(fetcher, url, { method: 'POST', body: JSON.stringify(body) });
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
