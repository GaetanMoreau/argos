#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { eq, sql } from 'drizzle-orm';
import { detectAdapters } from '../core/adapters/index.ts';
import { dbPath, openDb, root } from '../core/db/index.ts';
import { clients, sites } from '../core/db/schema.ts';
import { buildReport, sendReport } from '../core/notify.ts';
import { readSecret, writeSecret } from '../core/keychain.ts';
import { KEY_ACCOUNT, needsInitialPageSpeed, startPageSpeed, type PageSpeedResult } from '../core/pagespeed.ts';
import { listFindings, setFindingStatus, siteDetail, type FindingFilters } from '../core/queries.ts';
import { scanAll, scanSite, type ScanResult } from '../core/scan.ts';
import { install, isLoaded, logPath, plistPath, uninstall } from '../core/schedule.ts';
import { createClient, createSite, deleteSite, InputError, updateSite } from '../core/sites.ts';
import { updateLag } from '../core/version.ts';
import { table } from './table.ts';

const db = openDb();
const program = new Command('argos').description('Inventaire et veille de sécurité de sites web (WordPress, Kirby, Nuxt)');

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function findClient(ref: string) {
  const byId = /^\d+$/.test(ref) && db.select().from(clients).where(eq(clients.id, Number(ref))).get();
  return (
    byId ||
    db.select().from(clients).where(eq(clients.name, ref)).get() ||
    fail(`Client inconnu : ${ref}\n  Créez-le d’abord : argos client add "${ref}"`)
  );
}

function findSite(ref: string) {
  const byId = /^\d+$/.test(ref) && db.select().from(sites).where(eq(sites.id, Number(ref))).get();
  return byId || db.select().from(sites).where(eq(sites.name, ref)).get() || fail(`Site inconnu : ${ref}`);
}

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) fail(err.message);
    throw err;
  }
}

async function addSite(clientRef: string, dir: string, opts: { name?: string; url?: string; hosting?: string }) {
  const client = findClient(clientRef);
  const { site, stack } = await guard(() => createSite(db, { clientId: client.id, path: dir, ...opts }));
  console.log(`✓ Site #${site.id} « ${site.name} » (${stack.join(', ') || 'stack non reconnue'})`);
  if (!stack.length) console.log('  ⚠ Aucune stack reconnue : le scan échouera tant que ce dossier n’est pas supporté.');
}

const client = program.command('client').description('Gérer les clients');

client
  .command('add <name>')
  .option('--notes <text>')
  .action(async (name: string, opts: { notes?: string }) => {
    const row = await guard(() => createClient(db, name));
    if (opts.notes) db.update(clients).set({ notes: opts.notes }).where(eq(clients.id, row.id)).run();
    console.log(`✓ Client #${row.id} « ${row.name} »`);
  });

client.command('list').action(() => {
  const rows = db
    .select({ id: clients.id, name: clients.name, sites: sql<number>`count(${sites.id})` })
    .from(clients)
    .leftJoin(sites, eq(sites.clientId, clients.id))
    .groupBy(clients.id)
    .orderBy(clients.name)
    .all();
  console.log(table(rows));
});

const site = program.command('site').description('Gérer les sites');

site
  .command('add')
  .requiredOption('--client <id|nom>')
  .requiredOption('--path <dossier>')
  .option('--name <nom>', 'par défaut : nom du dossier')
  .option('--url <url>')
  .option('--hosting <texte>')
  .action((opts) => addSite(opts.client, opts.path, opts));

site.command('list').action(() => {
  const rows = db
    .select({ id: sites.id, client: clients.name, name: sites.name, stack: sites.stack, url: sites.url, path: sites.path })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(eq(sites.archived, false))
    .orderBy(clients.name, sites.name)
    .all();
  console.log(table(rows));
});

site
  .command('discover <dossier>')
  .description('Reconnaît un site dans le dossier, ou dans ses sous-dossiers (et les ajoute avec --client)')
  .option('--client <id|nom>', 'ajoute tous les sites trouvés à ce client')
  .action(async (dir: string, opts: { client?: string }) => {
    const root = resolve(dir);
    if (!existsSync(root)) fail(`Dossier introuvable : ${root}`);
    const known = new Set(db.select({ path: sites.path }).from(sites).all().map((s) => s.path));
    const isSite = (await detectAdapters(root)).length > 0;
    if (isSite && known.has(root)) return console.log(`Déjà enregistré : ${root}`);
    const candidates = isSite
      ? [root]
      : readdirSync(root)
        .filter((n) => !n.startsWith('.') && n !== 'node_modules')
        .map((n) => join(root, n))
        .filter((p) => statSync(p).isDirectory() && !known.has(p));
    const found: { path: string; stack: string }[] = [];
    for (const path of candidates) {
      const stack = (await detectAdapters(path)).map((a) => a.id);
      if (stack.length) found.push({ path, stack: stack.join(',') });
    }
    if (!found.length) return console.log('Aucun nouveau site détecté.');
    if (!opts.client) {
      console.log(table(found));
      console.log('\nPour les ajouter : argos site discover <dossier> --client <id|nom>');
      return;
    }
    for (const f of found) await addSite(opts.client, f.path, {});
  });

site
  .command('archive <id|nom>')
  .description('Exclut le site des scans')
  .action((ref: string) => {
    const s = findSite(ref);
    db.update(sites).set({ archived: true }).where(eq(sites.id, s.id)).run();
    console.log(`✓ Site « ${s.name} » archivé`);
  });

site
  .command('set <id|nom>')
  .description('Modifie un site ; une valeur vide efface (ex. --php "" revient à l’estimation)')
  .option('--php <version>', 'version de PHP du serveur (ex. 8.5)')
  .option('--url <url>')
  .option('--hosting <texte>')
  .action(async (ref: string, opts: { php?: string; url?: string; hosting?: string }) => {
    const s = findSite(ref);
    const changes = {
      ...(opts.php !== undefined && { phpVersion: opts.php }),
      ...(opts.url !== undefined && { url: opts.url }),
      ...(opts.hosting !== undefined && { hosting: opts.hosting }),
    };
    if (!Object.keys(changes).length) fail('Rien à modifier : --php, --url ou --hosting');
    const row = await guard(() => updateSite(db, s.id, changes));
    console.log(`✓ « ${row.name} » : PHP ${row.phpVersion ?? 'estimé'}, URL ${row.url ?? '—'}, hébergement ${row.hosting ?? '—'}`);
    console.log(`  Pris en compte au prochain scan : argos scan --site ${row.id}`);
  });

site
  .command('remove <id|nom>')
  .description('Supprime le site et ses données Argos (les fichiers du projet ne sont pas touchés)')
  .option('--yes', 'confirme la suppression')
  .action(async (ref: string, opts: { yes?: boolean }) => {
    const s = findSite(ref);
    if (!opts.yes) {
      console.log(`Supprimer « ${s.name} » effacera son historique de scans, ses failles et son inventaire.`);
      console.log(`Les fichiers de ${s.path} ne sont pas touchés. Pour confirmer :`);
      console.log(`  argos site remove ${s.id} --yes`);
      return;
    }
    const result = await guard(() => deleteSite(db, s.id));
    const n = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
    console.log(`✓ Site « ${s.name} » supprimé (${n(result.scans, 'scan', 'scans')}, ${n(result.findings, 'faille', 'failles')} effacés)`);
  });

function printResult(r: ScanResult) {
  if (r.error) return console.log(`✗ ${r.site.name} : ${r.error}`);
  const parts = [`${r.components} composants`];
  if (r.untracked) parts.push(`${r.untracked} non suivi(s)`);
  if (r.opened.length) parts.push(`${r.opened.length} nouvelle(s) faille(s)`);
  if (r.fixed) parts.push(`${r.fixed} corrigée(s)`);
  console.log(`${r.opened.length ? '⚠' : '✓'} ${r.site.name} : ${parts.join(', ')}`);
}

/** Premier scan d'un site : la ligne de commande attend PageSpeed (elle ne peut pas le laisser tourner après elle). */
async function initialPageSpeed(siteIds: number[]) {
  const pending = siteIds.filter((i) => needsInitialPageSpeed(db, i));
  if (!pending.length) return;
  if (!(await readSecret(KEY_ACCOUNT))) {
    return console.log(`  PageSpeed non lancé pour ${pending.length} nouveau(x) site(s) : clé absente (argos pagespeed key <clé>)`);
  }
  for (const id of pending) {
    const name = db.select({ name: sites.name }).from(sites).where(eq(sites.id, id)).get()!.name;
    try {
      const { done } = await startPageSpeed(db, id);
      printPageSpeed(name, await done);
    } catch (err) {
      console.log(`  PageSpeed ${name} : ${(err as Error).message}`);
    }
  }
}

function printPageSpeed(name: string, run: { status: string; error: string | null; result: string | null }) {
  if (run.status !== 'ok' || !run.result) return console.log(`✗ PageSpeed ${name} : ${run.error}`);
  const { scores } = JSON.parse(run.result) as PageSpeedResult;
  console.log(
    `✓ PageSpeed ${name} (mobile) : performance ${scores.performance}, accessibilité ${scores.accessibility}, bonnes pratiques ${scores.bestPractices}, SEO ${scores.seo}`,
  );
}

program
  .command('scan')
  .description('Scanne les sites actifs')
  .option('--site <id|nom>')
  .option('--notify', 'envoie les notifications macOS pour les nouveautés (détail dans le journal)')
  .action(async (opts: { site?: string; notify?: boolean }) => {
    console.log(`— Scan du ${new Date().toLocaleString('fr-FR')}`);
    const results = opts.site ? [await scanSite(db, findSite(opts.site))] : await scanAll(db, {}, printResult);
    if (opts.site) printResult(results[0]);
    await initialPageSpeed(results.filter((r) => !r.error).map((r) => r.site.id));
    if (!opts.notify) return;
    const report = buildReport(db, results);
    for (const message of [report.urgent, report.digest]) if (message) console.log(`\n${message.title}\n${message.body}`);
    for (const failure of await sendReport(report)) console.error(`✗ Notification : ${failure}`);
    if (report.urgent || report.digest) console.log('✓ Notifications envoyées');
  });

program
  .command('serve')
  .description('Interface web locale')
  .option('--port <port>', 'port HTTP', '4000')
  .option('--no-open', 'ne pas ouvrir le navigateur')
  .option('--dev', 'mode développement Nuxt (rechargement à chaud)')
  .action(async (opts: { port: string; open: boolean; dev?: boolean }) => {
    // Boucle locale uniquement : l'interface n'a pas de compte et ne doit pas être joignable depuis le réseau.
    const env = { ...process.env, ARGOS_ROOT: root, ARGOS_DB: dbPath, PORT: opts.port, NUXT_PORT: opts.port, HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' };
    const url = `http://localhost:${opts.port}`;
    if (opts.dev) {
      spawn('npx', ['nuxt', 'dev', 'web', '--port', opts.port, '--host', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' });
      return;
    }
    if (uiNeedsBuild()) {
      console.log('Compilation de l’interface…');
      const build = spawnSync('npx', ['nuxt', 'build', 'web'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
      if (build.status !== 0) fail('La compilation de l’interface a échoué');
    }
    const server = spawn(process.execPath, [join(root, 'web/.output/server/index.mjs')], { env, stdio: 'inherit' });
    console.log(`✓ Argos sur ${url} (Ctrl+C pour arrêter)`);
    if (opts.open) setTimeout(() => spawn('open', [url]), 800);
    server.on('exit', (code) => process.exit(code ?? 0));
  });

function uiNeedsBuild(): boolean {
  const output = join(root, 'web/.output/server/index.mjs');
  if (!existsSync(output)) return true;
  const builtAt = statSync(output).mtimeMs;
  const newest = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => !['.output', '.nuxt', 'node_modules'].includes(e.name))
      .reduce((max, e) => {
        const path = join(dir, e.name);
        return Math.max(max, e.isDirectory() ? newest(path) : statSync(path).mtimeMs);
      }, 0);
  return Math.max(newest(join(root, 'web')), newest(join(root, 'src/core'))) > builtAt;
}

const notify = program.command('notify').description('Notifications');

notify
  .command('test')
  .description('Affiche une notification macOS de test')
  .action(async () => {
    const message = { title: 'Argos', short: 'Notification de test ✓', body: 'Notification de test ✓' };
    const failures = await sendReport({ urgent: null, digest: message });
    for (const failure of failures) console.error(`✗ ${failure}`);
    if (!failures.length) console.log('✓ Envoyée');
  });

const pagespeed = program.command('pagespeed').description('Analyse PageSpeed Insights (mobile)');

pagespeed
  .command('key <cle>')
  .description('Enregistre la clé API Google dans le trousseau macOS')
  .action(async (key: string) => {
    await writeSecret(KEY_ACCOUNT, key.trim());
    console.log('✓ Clé enregistrée dans le trousseau (service « argos »)');
  });

pagespeed
  .command('run <site>')
  .description('Analyse un site maintenant (15 à 40 s)')
  .action(async (ref: string) => {
    const s = findSite(ref);
    try {
      const { done } = await startPageSpeed(db, s.id);
      printPageSpeed(s.name, await done);
    } catch (err) {
      fail((err as Error).message);
    }
  });

const schedule = program.command('schedule').description('Scan quotidien automatique (launchd)');

schedule
  .command('install')
  .option('--at <HH:MM>', 'heure du scan', '09:00')
  .action(async (opts: { at: string }) => {
    const m = opts.at.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) fail(`Heure invalide : ${opts.at}`);
    await install(Number(m[1]), Number(m[2]));
    console.log(`✓ Scan quotidien à ${opts.at} (${plistPath})`);
    console.log(`  Logs : ${logPath}`);
    console.log(`  Node utilisé : ${process.execPath} — à réinstaller si cette version de Node est supprimée.`);
  });

schedule.command('uninstall').action(async () => {
  console.log((await uninstall()) ? '✓ Scan quotidien supprimé' : 'Aucun scan planifié.');
});

schedule.command('status').action(async () => {
  console.log((await isLoaded()) ? `✓ Actif (${plistPath})\n  Logs : ${logPath}` : 'Inactif.');
});

program
  .command('components <site>')
  .description('Inventaire du dernier scan réussi d’un site')
  .option('--all', 'inclut les dépendances de dev')
  .option('--untracked', 'uniquement les composants inconnus des bases de failles')
  .option('--outdated', 'uniquement les composants directs qui ont une version plus récente')
  .action((ref: string, opts: { all?: boolean; untracked?: boolean; outdated?: boolean }) => {
    const detail = siteDetail(db, findSite(ref).id)!;
    const lastOk = detail.scans.find((scan) => scan.status === 'ok');
    if (!lastOk) fail(`Aucun scan réussi pour « ${detail.site.name} »`);
    const rows = detail.components
      .filter((c) => (opts.untracked ? c.untracked : opts.outdated ? updateLag(c.version, c.latest) : opts.all || !c.isDev))
      .map((c) => ({
        ecosystem: c.ecosystem,
        name: c.name,
        version: c.version,
        derniere: updateLag(c.version, c.latest) ? `${c.latest} (${updateLag(c.version, c.latest)})` : '',
        suivi: c.untracked ? 'non suivi' : '',
      }));
    console.log(`Scan du ${new Date(lastOk.at).toLocaleString('fr-FR')}`);
    console.log(table(rows));
  });

program
  .command('findings')
  .description('Liste les failles')
  .option('--site <id|nom>')
  .option('--status <statut>', 'open | ignored | fixed | all', 'open')
  .option('--prod', 'masque les dépendances de dev')
  .action((opts: { site?: string; status: string; prod?: boolean }) => {
    const rows = listFindings(db, {
      status: opts.status as FindingFilters['status'],
      siteId: opts.site ? findSite(opts.site).id : undefined,
      prodOnly: opts.prod,
    }).map((f) => ({
      id: f.id,
      site: f.siteName,
      severity: f.severity,
      kev: f.isKev ? 'KEV' : '',
      package: `${f.component}@${f.version}`,
      dev: f.isDev ? 'dev' : '',
      fixedIn: f.fixedIn,
      vuln: f.vulnId,
      summary: f.summary,
    }));
    console.log(rows.length ? table(rows, { summary: 60 }) : 'Aucune faille.');
  });

program
  .command('ignore <findingId>')
  .description('Ignore une faille (justification obligatoire)')
  .requiredOption('--note <raison>')
  .action((id: string, opts: { note: string }) => {
    if (!setFindingStatus(db, Number(id), 'ignored', opts.note)) fail(`Faille #${id} introuvable ou déjà corrigée`);
    console.log(`✓ Faille #${id} ignorée`);
  });

await program.parseAsync();
