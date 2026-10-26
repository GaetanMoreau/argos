import { listFindings, type FindingFilters } from '../../../../src/core/queries.ts';

export default defineEventHandler((event) => {
  const q = getQuery(event);
  return listFindings(useArgosDb(), {
    status: (q.status as FindingFilters['status']) ?? 'open',
    siteId: q.site ? Number(q.site) : undefined,
    severity: (q.severity as FindingFilters['severity']) || undefined,
    prodOnly: q.prod === '1',
  });
});
