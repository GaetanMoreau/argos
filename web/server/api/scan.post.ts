import { eq } from 'drizzle-orm';
import { sites } from '../../../src/core/db/schema.ts';
import { scanAll, scanSite, type ScanResult } from '../../../src/core/scan.ts';

let running: Promise<ScanResult[]> | null = null;

/** Lance un scan (un site ou tous). Un seul scan à la fois. */
export default defineEventHandler(async (event) => {
  const { siteId } = (await readBody<{ siteId?: number }>(event)) ?? {};
  if (running) throw createError({ statusCode: 409, statusMessage: 'Un scan est déjà en cours' });
  const db = useArgosDb();
  running = siteId
    ? (async () => {
        const site = db.select().from(sites).where(eq(sites.id, siteId)).get();
        if (!site) throw createError({ statusCode: 404, statusMessage: 'Site introuvable' });
        return [await scanSite(db, site)];
      })()
    : scanAll(db);
  try {
    const results = await running;
    startInitialPageSpeed(results.filter((r) => !r.error).map((r) => r.site.id));
    return results.map((r) => ({ site: r.site.name, error: r.error ?? null, opened: r.opened.length, fixed: r.fixed }));
  } finally {
    running = null;
  }
});
