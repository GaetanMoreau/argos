import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { detectAdapters } from './adapters/index.ts';
import type { Db } from './db/index.ts';
import { clients, findings, httpChecks, pagespeedRuns, scans, sites } from './db/schema.ts';

/** Erreur de saisie : le message est destiné à l'utilisateur. */
export class InputError extends Error {}

/** Chemin absolu ; `~` désigne le dossier personnel. */
export function expandPath(path: string): string {
  const trimmed = path.trim();
  return resolve(trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(1)) : trimmed);
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export function createClient(db: Db, name: string) {
  const clean = name.trim();
  if (!clean) throw new InputError('Le nom du client est obligatoire');
  const row = db.insert(clients).values({ name: clean }).onConflictDoNothing().returning().get();
  if (!row) throw new InputError(`Le client « ${clean} » existe déjà`);
  return row;
}

/** État d'un dossier candidat : existe-t-il, quelle stack, est-il déjà suivi, et ses sous-dossiers (pour l'autocomplétion). */
export async function inspectPath(db: Db, input: string) {
  const path = expandPath(input);
  const exists = isDir(path);
  // Pour un chemin en cours de saisie, on suggère depuis le dernier dossier existant.
  const base = exists && input.endsWith('/') ? path : dirname(path);
  const prefix = exists && input.endsWith('/') ? '' : basename(path).toLowerCase();
  const suggestions = isDir(base)
    ? readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .filter((e) => e.name.toLowerCase().startsWith(prefix))
        .slice(0, 30)
        .map((e) => join(base, e.name))
    : [];
  return {
    path,
    exists,
    stack: exists ? (await detectAdapters(path)).map((a) => a.id) : [],
    registered: Boolean(db.select({ id: sites.id }).from(sites).where(eq(sites.path, path)).get()),
    suggestions,
  };
}

export interface NewSite {
  clientId: number;
  path: string;
  name?: string;
  url?: string;
  hosting?: string;
}

/** `mon-site.fr` → `https://mon-site.fr` ; vide → null. */
function normalizeUrl(input: string | null | undefined): string | null {
  const url = input?.trim();
  if (!url) return null;
  const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
  try {
    new URL(full);
  } catch {
    throw new InputError(`URL invalide : ${url}`);
  }
  return full;
}

/** `8.5`, `8.5.1` ; vide → null (retour à l'estimation). */
export function normalizePhpVersion(input: string | null | undefined): string | null {
  const version = input?.trim().replace(/^php\s*/i, '');
  if (!version) return null;
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) throw new InputError(`Version de PHP invalide : ${input} (attendu : 8.5 ou 8.5.1)`);
  return version;
}

export function updateSite(
  db: Db,
  id: number,
  changes: { url?: string | null; hosting?: string | null; phpVersion?: string | null },
) {
  const set: Partial<typeof sites.$inferInsert> = {};
  if ('url' in changes) set.url = normalizeUrl(changes.url);
  if ('hosting' in changes) set.hosting = changes.hosting?.trim() || null;
  if ('phpVersion' in changes) set.phpVersion = normalizePhpVersion(changes.phpVersion);
  const row = db.update(sites).set(set).where(eq(sites.id, id)).returning().get();
  if (!row) throw new InputError('Site introuvable');
  return row;
}

/**
 * Supprime un site et tout ce qu'Argos en sait (scans, inventaires, failles, rapports HTTP, analyses PageSpeed).
 * Les fichiers du projet ne sont pas touchés ; le client est conservé.
 */
export function deleteSite(db: Db, id: number) {
  return db.transaction((tx) => {
    const site = tx.select().from(sites).where(eq(sites.id, id)).get();
    if (!site) throw new InputError('Site introuvable');
    tx.delete(httpChecks).where(eq(httpChecks.siteId, id)).run();
    tx.delete(pagespeedRuns).where(eq(pagespeedRuns.siteId, id)).run();
    const removedFindings = tx.delete(findings).where(eq(findings.siteId, id)).returning({ id: findings.id }).all().length;
    // Les composants suivent leurs scans (ON DELETE CASCADE).
    const removedScans = tx.delete(scans).where(eq(scans.siteId, id)).returning({ id: scans.id }).all().length;
    tx.delete(sites).where(eq(sites.id, id)).run();
    return { site, scans: removedScans, findings: removedFindings };
  });
}

export async function createSite(db: Db, input: NewSite) {
  if (!db.select().from(clients).where(eq(clients.id, input.clientId)).get()) {
    throw new InputError('Client introuvable');
  }
  const path = expandPath(input.path);
  if (!existsSync(path) || !isDir(path)) throw new InputError(`Dossier introuvable : ${path}`);
  if (db.select().from(sites).where(eq(sites.path, path)).get()) throw new InputError(`Ce dossier est déjà suivi : ${path}`);

  const url = normalizeUrl(input.url);
  const stack = (await detectAdapters(path)).map((a) => a.id);
  const site = db
    .insert(sites)
    .values({
      clientId: input.clientId,
      path,
      name: input.name?.trim() || basename(path),
      url,
      hosting: input.hosting?.trim() || null,
      stack: stack.join(','),
    })
    .returning()
    .get();
  return { site, stack };
}
