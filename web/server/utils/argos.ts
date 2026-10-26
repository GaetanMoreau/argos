import { openDb, type Db } from '../../../src/core/db/index.ts';

let db: Db | undefined;

/** Connexion unique à la base Argos, partagée par toutes les routes. */
export function useArgosDb(): Db {
  db ??= openDb();
  return db;
}
