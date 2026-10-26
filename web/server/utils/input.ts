import { InputError } from '../../../src/core/sites.ts';

/** Transforme une erreur de saisie du cœur en réponse 400 lisible. */
export async function withInput<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) throw createError({ statusCode: 400, statusMessage: err.message });
    throw err;
  }
}
