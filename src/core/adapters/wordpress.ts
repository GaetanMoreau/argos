import { existsSync, readdirSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseComposerLock } from '../lockfiles/composer.ts';
import type { Component, Ecosystem, StackAdapter } from '../types.ts';

/** Emplacements connus : installation classique, sous-dossier, Bedrock. */
const LAYOUTS = [
  { core: '', content: 'wp-content' },
  { core: 'wordpress', content: 'wordpress/wp-content' },
  { core: 'public', content: 'public/wp-content' },
  { core: 'www', content: 'www/wp-content' },
  { core: 'htdocs', content: 'htdocs/wp-content' },
  { core: 'web/wp', content: 'web/app' },
];

function findLayout(dir: string) {
  return LAYOUTS.find((l) => existsSync(join(dir, l.core, 'wp-includes/version.php')));
}

/** Lit un en-tête de fichier comme WordPress (`get_file_data`, 8 Ko). */
async function readHeaders(path: string, fields: string[]): Promise<Record<string, string>> {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(8192), 0, 8192, 0);
    const text = buffer.toString('utf8', 0, bytesRead).replace(/\r/g, '\n');
    const out: Record<string, string> = {};
    for (const field of fields) {
      const m = text.match(new RegExp(`^(?:[ \\t]*<\\?php)?[ \\t/*#@]*${field}:(.*)$`, 'mi'));
      const value = m?.[1].replace(/\s*(?:\*\/|\?>).*/, '').trim();
      if (value) out[field] = value;
    }
    return out;
  } finally {
    await handle.close();
  }
}

const wp = (ecosystem: Ecosystem, name: string, version: string): Component => ({
  ecosystem,
  name,
  version,
  isDev: false,
  source: 'file',
});

/** Plugins : un dossier avec un fichier PHP portant `Plugin Name:`, ou un fichier PHP isolé. */
async function plugins(contentDir: string): Promise<Component[]> {
  const root = join(contentDir, 'plugins');
  if (!existsSync(root)) return [];
  const out: Component[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidates = entry.isDirectory()
      ? readdirSync(join(root, entry.name))
          .filter((f) => f.endsWith('.php'))
          .map((f) => join(root, entry.name, f))
      : entry.name.endsWith('.php')
        ? [join(root, entry.name)]
        : [];
    for (const file of candidates) {
      const headers = await readHeaders(file, ['Plugin Name', 'Version']);
      if (!headers['Plugin Name']) continue;
      if (headers.Version) out.push(wp('wp-plugin', entry.name.replace(/\.php$/, ''), headers.Version));
      break;
    }
  }
  return out;
}

async function themes(contentDir: string): Promise<Component[]> {
  const root = join(contentDir, 'themes');
  if (!existsSync(root)) return [];
  const out: Component[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const style = join(root, entry.name, 'style.css');
    if (!entry.isDirectory() || !existsSync(style)) continue;
    const headers = await readHeaders(style, ['Version']);
    if (headers.Version) out.push(wp('wp-theme', entry.name, headers.Version));
  }
  return out;
}

export const wordpress: StackAdapter = {
  id: 'wordpress',

  async detect(dir) {
    return Boolean(findLayout(dir));
  },

  async inventory(dir) {
    const layout = findLayout(dir);
    if (!layout) throw new Error(`WordPress introuvable dans ${dir}`);
    const versionFile = await readFile(join(dir, layout.core, 'wp-includes/version.php'), 'utf8');
    const version = versionFile.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (!version) throw new Error(`Version de WordPress illisible dans ${dir}`);

    const contentDir = join(dir, layout.content);
    const out = [wp('wp-core', 'wordpress', version), ...(await plugins(contentDir)), ...(await themes(contentDir))];

    // Bedrock : les autres dépendances Composer (hors WordPress et ses extensions, déjà lus sur disque).
    const lockPath = join(dir, 'composer.lock');
    if (existsSync(lockPath)) {
      const skip = /^(wpackagist-(plugin|theme)\/|roots\/wordpress)/;
      out.push(...parseComposerLock(await readFile(lockPath, 'utf8')).filter((c) => !skip.test(c.name)));
    }
    return out;
  },
};
