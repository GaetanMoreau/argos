import { siteMaintenanceReport } from '../../../../../src/core/report.ts';

export default defineEventHandler((event) => {
  const days = Math.min(365, Math.max(1, Number(getQuery(event).days) || 30));
  const report = siteMaintenanceReport(useArgosDb(), Number(getRouterParam(event, 'id')), days);
  if (!report) throw createError({ statusCode: 404, statusMessage: 'Site introuvable' });
  return report;
});
