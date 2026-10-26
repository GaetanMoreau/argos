import { clients } from '../../../../src/core/db/schema.ts';

export default defineEventHandler(() =>
  useArgosDb().select({ id: clients.id, name: clients.name }).from(clients).orderBy(clients.name).all(),
);
