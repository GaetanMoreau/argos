import { KEY_ACCOUNT } from '../../../../src/core/pagespeed.ts';
import { readSecret } from '../../../../src/core/keychain.ts';

/** Indique seulement si une clé existe ; la clé elle-même ne quitte jamais le trousseau. */
export default defineEventHandler(async () => ({ configured: Boolean(await readSecret(KEY_ACCOUNT)) }));
