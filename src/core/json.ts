import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export async function readJsonIfExists(path: string): Promise<any | null> {
  return existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : null;
}
