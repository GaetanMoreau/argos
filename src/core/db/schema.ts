import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch())`;

export const clients = sqliteTable('client', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  notes: text(),
});

export const sites = sqliteTable('site', {
  id: integer().primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  name: text().notNull(),
  path: text().notNull().unique(),
  url: text(),
  stack: text(), // adaptateurs détectés, séparés par des virgules
  hosting: text(),
  /** Version de PHP du serveur, saisie à la main ; prime sur l'estimation et sur la production. */
  phpVersion: text('php_version'),
  notes: text(),
  archived: integer({ mode: 'boolean' }).notNull().default(false),
});

export const scans = sqliteTable('scan', {
  id: integer().primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(now),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  status: text({ enum: ['running', 'ok', 'error'] }).notNull().default('running'),
  error: text(),
});

export const components = sqliteTable('component', {
  id: integer().primaryKey({ autoIncrement: true }),
  scanId: integer('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  ecosystem: text().notNull(),
  name: text().notNull(),
  version: text().notNull(),
  isDev: integer('is_dev', { mode: 'boolean' }).notNull().default(false),
  source: text().notNull(),
  untracked: integer({ mode: 'boolean' }).notNull().default(false), // inconnu des bases de failles
  /** Choisi par le projet (package.json, composer.json, plugin, thème…), par opposition aux dépendances indirectes. */
  direct: integer({ mode: 'boolean' }).notNull().default(false),
  /** Dernière version stable publiée, connue pour les composants directs. */
  latest: text(),
});

export const vulnerabilities = sqliteTable('vulnerability', {
  id: text().primaryKey(), // identifiant de la source (GHSA-…, CVE-…)
  source: text().notNull(),
  aliases: text(), // séparés par des virgules
  summary: text(),
  severity: text({ enum: ['critical', 'high', 'medium', 'low', 'unknown'] }).notNull(),
  cvss: text(), // vecteur CVSS brut
  isKev: integer('is_kev', { mode: 'boolean' }).notNull().default(false),
  url: text(),
});

export const findings = sqliteTable(
  'finding',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    siteId: integer('site_id').notNull().references(() => sites.id),
    ecosystem: text().notNull(),
    componentName: text('component_name').notNull(),
    version: text().notNull(), // versions installées concernées, séparées par des virgules
    isDev: integer('is_dev', { mode: 'boolean' }).notNull().default(false),
    vulnerabilityId: text('vulnerability_id').notNull().references(() => vulnerabilities.id),
    fixedIn: text('fixed_in'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull().default(now),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().default(now),
    status: text({ enum: ['open', 'ignored', 'fixed'] }).notNull().default('open'),
    note: text(),
  },
  (t) => [uniqueIndex('finding_key').on(t.siteId, t.ecosystem, t.componentName, t.vulnerabilityId)],
);

/** Rapport « Sécurité HTTP » d'un site en ligne, un par scan. */
export const httpChecks = sqliteTable('http_check', {
  id: integer().primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id),
  scanId: integer('scan_id').references(() => scans.id, { onDelete: 'set null' }),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull().default(now),
  grade: text(), // null si le site était injoignable
  report: text().notNull(), // HttpReport en JSON
});

/** Analyse PageSpeed Insights (mobile), lancée en arrière-plan : `running` tant que Google n'a pas répondu. */
export const pagespeedRuns = sqliteTable('pagespeed_run', {
  id: integer().primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(now),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  status: text({ enum: ['running', 'ok', 'error'] }).notNull().default('running'),
  error: text(),
  result: text(), // PageSpeedResult en JSON
});

export const httpCache = sqliteTable('http_cache', {
  key: text().primaryKey(),
  body: text().notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull().default(now),
});
