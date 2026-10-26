import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export const root = process.env.ARGOS_ROOT ?? join(import.meta.dirname, '../../..');
export const dbPath = process.env.ARGOS_DB ?? join(root, 'data/argos.db');
export const dataDir = dirname(dbPath);

/**
 * La base cartographie les failles des sites clients : dossier en 700 et fichiers en 600, lisibles par le seul
 * compte courant. Le dossier n'est restreint que s'il appartient à Argos (`data/` ou créé ici), jamais un dossier
 * choisi via ARGOS_DB. SQLite donne aux fichiers -wal et -shm les droits de la base.
 */
function prepareDataDir(path: string) {
  const dir = dirname(path);
  const created = mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (created || dir === join(root, 'data')) chmodSync(dir, 0o700);
}

function restrictFiles(path: string) {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}

export function openDb(path = dbPath) {
  const onDisk = path !== ':memory:';
  if (onDisk) prepareDataDir(path);
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  if (onDisk) restrictFiles(path);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(root, 'drizzle') });
  return db;
}

export type Db = ReturnType<typeof openDb>;
export { schema };
