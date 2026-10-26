import { setFindingStatus } from '../../../../src/core/queries.ts';

export default defineEventHandler(async (event) => {
  const { status, note } = await readBody<{ status: 'open' | 'ignored'; note?: string }>(event);
  if (status === 'ignored' && !note?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Une raison est obligatoire pour ignorer une faille' });
  }
  const row = setFindingStatus(useArgosDb(), Number(getRouterParam(event, 'id')), status, note?.trim());
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Faille introuvable ou déjà corrigée' });
  return { id: row.id, status: row.status, note: row.note };
});
