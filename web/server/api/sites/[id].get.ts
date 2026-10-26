import { siteDetail } from '../../../../src/core/queries.ts';

export default defineEventHandler((event) => {
  const detail = siteDetail(useArgosDb(), Number(getRouterParam(event, 'id')));
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'Site introuvable' });
  return detail;
});
