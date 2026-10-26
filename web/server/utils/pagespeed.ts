import { needsInitialPageSpeed, startPageSpeed } from '../../../src/core/pagespeed.ts';

/** Premier scan d'un site : lance PageSpeed en arrière-plan, sans faire attendre la réponse HTTP. */
export function startInitialPageSpeed(siteIds: number[]) {
  const db = useArgosDb();
  for (const id of siteIds) {
    if (!needsInitialPageSpeed(db, id)) continue;
    // Sans clé ou en cas d'échec, l'onglet Performance l'indique ; le scan n'est pas concerné.
    startPageSpeed(db, id).catch(() => {});
  }
}
