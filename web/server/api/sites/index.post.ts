import { createClient, createSite, inspectPath, type NewSite } from '../../../../src/core/sites.ts';

/** Ajoute un site ; `newClient` crée le client au passage. */
export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<NewSite> & { newClient?: string }>(event);
  const db = useArgosDb();
  return withInput(async () => {
    if (!body.path?.trim()) throw createError({ statusCode: 400, statusMessage: 'Le dossier du projet est obligatoire' });
    // Dossier vérifié avant de créer le client : pas de client orphelin si le chemin est faux.
    const target = await inspectPath(db, body.path);
    if (!target.exists) throw createError({ statusCode: 400, statusMessage: `Dossier introuvable : ${target.path}` });
    if (target.registered) throw createError({ statusCode: 400, statusMessage: 'Ce dossier est déjà suivi' });
    const clientId = body.newClient?.trim() ? createClient(db, body.newClient).id : Number(body.clientId);
    const { site, stack } = await createSite(db, { ...body, clientId, path: body.path });
    return { id: site.id, name: site.name, stack };
  });
});
