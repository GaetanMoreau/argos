import { updateSite } from '../../../../src/core/sites.ts';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string | null; hosting?: string | null; phpVersion?: string | null }>(event);
  const row = await withInput(() => updateSite(useArgosDb(), Number(getRouterParam(event, 'id')), body));
  return { id: row.id, url: row.url, hosting: row.hosting, phpVersion: row.phpVersion };
});
