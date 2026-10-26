import { writeSecret } from '../../../../src/core/keychain.ts';
import { KEY_ACCOUNT } from '../../../../src/core/pagespeed.ts';

export default defineEventHandler(async (event) => {
  const { key } = await readBody<{ key?: string }>(event);
  if (!key?.trim() || !/^[\w-]{20,}$/.test(key.trim())) {
    throw createError({ statusCode: 400, statusMessage: 'Clé API invalide (attendu : AIza…)' });
  }
  await writeSecret(KEY_ACCOUNT, key.trim());
  return { configured: true };
});
