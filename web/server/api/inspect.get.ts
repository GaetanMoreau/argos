import { inspectPath } from '../../../src/core/sites.ts';

/** Vérifie un dossier pendant la saisie : existence, stack détectée, sous-dossiers suggérés. */
export default defineEventHandler((event) => {
  const { path } = getQuery(event);
  if (typeof path !== 'string' || !path.trim()) return { path: '', exists: false, stack: [], registered: false, suggestions: [] };
  return inspectPath(useArgosDb(), path);
});
