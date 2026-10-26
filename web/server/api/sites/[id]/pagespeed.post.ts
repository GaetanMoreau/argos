import { startPageSpeed } from '../../../../../src/core/pagespeed.ts';
import { pageSpeedView } from '../../../../../src/core/queries.ts';

/** Lance une analyse et répond aussitôt « en cours » ; le résultat arrive en base 15 à 40 s plus tard. */
export default defineEventHandler(async (event) => {
  try {
    const { run } = await startPageSpeed(useArgosDb(), Number(getRouterParam(event, 'id')));
    return pageSpeedView(run);
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message });
  }
});
