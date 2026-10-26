import { mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db/index.ts';

const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

describe('droits des données', () => {
  it('dossier créé par Argos en 700, base et fichiers WAL en 600', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'argos-perm-')), 'data');
    const db = join(dir, 'argos.db');
    openDb(db);
    expect(mode(dir)).toBe('700');
    for (const file of [db, `${db}-wal`, `${db}-shm`]) expect(mode(file)).toBe('600');
  });

  it('ne touche pas aux droits d’un dossier existant choisi via ARGOS_DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'argos-perm-'));
    mkdirSync(join(dir, 'partage'), { mode: 0o755 });
    openDb(join(dir, 'partage', 'argos.db'));
    expect(mode(join(dir, 'partage'))).toBe('755');
    expect(mode(join(dir, 'partage', 'argos.db'))).toBe('600');
  });
});
