import { createClient } from '../../../../src/core/sites.ts';

export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name?: string }>(event);
  const row = await withInput(() => createClient(useArgosDb(), name ?? ''));
  return { id: row.id, name: row.name };
});
