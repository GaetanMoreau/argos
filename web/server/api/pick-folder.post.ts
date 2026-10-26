import { existsSync } from 'node:fs';
import { appleScriptString, exec } from '../../../src/core/macos.ts';
import { expandPath } from '../../../src/core/sites.ts';

/**
 * Ouvre le sélecteur de dossier natif de macOS (Argos tourne en local) et renvoie le chemin choisi,
 * ou `null` si l'utilisateur annule.
 */
export default defineEventHandler(async (event) => {
  const { from } = (await readBody<{ from?: string }>(event)) ?? {};
  const start = from?.trim() ? expandPath(from) : '';
  const location = start && existsSync(start) ? ` default location (POSIX file ${appleScriptString(start)})` : '';
  try {
    const { stdout } = await exec('osascript', [
      '-e',
      'activate', // place la fenêtre de choix au premier plan, devant le navigateur
      '-e',
      `POSIX path of (choose folder with prompt "Dossier du projet à suivre"${location})`,
    ]);
    return { path: stdout.trim().replace(/\/$/, '') };
  } catch (err: any) {
    // -128 : l'utilisateur a cliqué sur Annuler.
    if (String(err?.stderr ?? '').includes('-128')) return { path: null };
    throw createError({ statusCode: 500, statusMessage: 'Impossible d’ouvrir le sélecteur de dossier' });
  }
});
