import { deleteSite } from '../../../../src/core/sites.ts';

export default defineEventHandler(async (event) => {
  const result = await withInput(() => deleteSite(useArgosDb(), Number(getRouterParam(event, 'id'))));
  return { name: result.site.name, scans: result.scans, findings: result.findings };
});
