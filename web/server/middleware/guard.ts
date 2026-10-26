import { rejectRequest } from '../../../src/core/request-guard.ts';

export default defineEventHandler((event) => {
  const reason = rejectRequest({
    method: event.method,
    host: getRequestHeader(event, 'host'),
    origin: getRequestHeader(event, 'origin'),
    contentType: getRequestHeader(event, 'content-type'),
  });
  if (reason) throw createError({ statusCode: 403, statusMessage: reason });
});
