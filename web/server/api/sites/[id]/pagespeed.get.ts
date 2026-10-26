import { latestPageSpeed } from '../../../../../src/core/pagespeed.ts';
import { pageSpeedView } from '../../../../../src/core/queries.ts';

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'));
  return pageSpeedView(latestPageSpeed(useArgosDb(), [id]).get(id));
});
