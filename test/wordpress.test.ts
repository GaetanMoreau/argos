import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wordpress } from '../src/core/adapters/wordpress.ts';
import { openDb } from '../src/core/db/index.ts';
import type { Fetch } from '../src/core/http.ts';
import type { Component } from '../src/core/types.ts';
import { compareVersions } from '../src/core/version.ts';
import { isAffected, queryWpVulnerability, toVulnerability } from '../src/core/vulns/wpvulnerability.ts';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'argos-wp-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const summary = (cs: Component[]) => cs.map((c) => `${c.ecosystem}:${c.name}@${c.version}`).sort();

describe('compareVersions', () => {
  it('compare segment par segment', () => {
    expect(compareVersions('6.4.3', '6.4.10')).toBe(-1);
    expect(compareVersions('5.3', '5.3.0')).toBe(0);
    expect(compareVersions('6.4.3.1', '6.4.3')).toBe(1);
  });
});

describe('adaptateur wordpress', () => {
  it('installation classique : cœur, plugins (dossier et fichier isolé), thèmes', async () => {
    const dir = project({
      'wp-includes/version.php': "<?php\n$wp_version = '6.4.3';\n",
      'wp-content/plugins/contact-form-7/wp-contact-form-7.php':
        '<?php\n/*\nPlugin Name: Contact Form 7\nVersion: 5.3.1\n*/',
      'wp-content/plugins/contact-form-7/includes/helper.php': '<?php',
      'wp-content/plugins/hello.php': '<?php\n/**\n * Plugin Name: Hello Dolly\n * Version: 1.7.2\n */',
      'wp-content/plugins/sans-version/sans-version.php': '<?php\n/* Plugin Name: Sans version */',
      'wp-content/themes/astra/style.css': '/*\nTheme Name: Astra\nVersion: 4.6.8\n*/',
      'wp-content/mu-plugins/maison.php': '<?php',
    });
    expect(await wordpress.detect(dir)).toBe(true);
    expect(summary(await wordpress.inventory(dir))).toEqual([
      'wp-core:wordpress@6.4.3',
      'wp-plugin:contact-form-7@5.3.1',
      'wp-plugin:hello@1.7.2',
      'wp-theme:astra@4.6.8',
    ]);
  });

  it('Bedrock : web/wp et web/app, dépendances Composer hors WordPress', async () => {
    const dir = project({
      'web/wp/wp-includes/version.php': "<?php $wp_version = '6.6.1';",
      'web/app/plugins/akismet/akismet.php': '<?php /* Plugin Name: Akismet\nVersion: 5.3 */',
      'composer.lock': JSON.stringify({
        packages: [
          { name: 'roots/wordpress', version: '6.6.1' },
          { name: 'wpackagist-plugin/akismet', version: '5.3' },
          { name: 'vlucas/phpdotenv', version: 'v5.6.0' },
        ],
      }),
    });
    expect(summary(await wordpress.inventory(dir))).toEqual([
      'packagist:vlucas/phpdotenv@5.6.0',
      'wp-core:wordpress@6.6.1',
      'wp-plugin:akismet@5.3',
    ]);
  });
});

describe('isAffected', () => {
  it('gère les bornes et opérateurs', () => {
    expect(isAffected('5.3.1', { max_version: '5.3.2', max_operator: 'lt' })).toBe(true);
    expect(isAffected('5.3.2', { max_version: '5.3.2', max_operator: 'lt' })).toBe(false);
    expect(isAffected('5.3.2', { max_version: '5.3.2', max_operator: 'le' })).toBe(true);
    expect(isAffected('1.0', { min_version: '2.0', min_operator: 'ge', max_version: '2.5', max_operator: 'le' })).toBe(false);
    expect(isAffected('anything', null)).toBe(true);
  });
});

describe('toVulnerability', () => {
  it('prend le CVE comme identifiant et un titre lisible', () => {
    const v = toVulnerability({
      uuid: 'abc',
      source: [
        { id: 'CVE-2020-35489', name: 'CVE-2020-35489', link: 'https://www.cve.org/x' },
        { id: 'w1', name: 'Contact Form 7 &lt; 5.3.2 - Unrestricted File Upload', link: 'https://wpscan.com/v/w1' },
      ],
      impact: { cvss: { severity: 'c', vector: 'CVSS:3.1/AV:N' } },
    });
    expect(v).toMatchObject({
      id: 'CVE-2020-35489',
      aliases: ['w1'],
      summary: 'Contact Form 7 < 5.3.2 - Unrestricted File Upload',
      severity: 'critical',
      url: 'https://wpscan.com/v/w1',
    });
  });
});

describe('queryWpVulnerability', () => {
  const responses: Record<string, unknown> = {
    '/plugin/contact-form-7/': {
      data: {
        name: 'Contact Form 7',
        closed: 0,
        vulnerability: [
          { uuid: 'u1', operator: { max_version: '5.3.2', max_operator: 'lt' }, source: [{ id: 'CVE-1', name: 'CF7 RCE' }], impact: { cvss: { severity: 'c' } } },
          { uuid: 'u2', operator: { max_version: '5.0', max_operator: 'le' }, source: [{ id: 'CVE-2', name: 'Ancienne' }] },
        ],
      },
    },
    '/plugin/vieux-plugin/': { data: { name: 'Vieux', closed: 1, closed_reason: 'Security Issue', vulnerability: [] } },
    '/plugin/acf-pro/': { data: { name: null, vulnerability: [] } },
    '/core/6.4.3/': { data: { vulnerability: [{ uuid: 'u3', source: [{ id: 'p1', name: 'WP XSS', description: 'at least 6.4.4.' }] }] } },
  };
  const fetcher = (async (url: string) =>
    new Response(JSON.stringify(responses[new URL(url).pathname] ?? { data: null }))) as Fetch;
  const c = (ecosystem: Component['ecosystem'], name: string, version: string): Component => ({
    ecosystem,
    name,
    version,
    isDev: false,
    source: 'file',
  });

  it('filtre par version, signale les plugins fermés et les inconnus', async () => {
    const acf = c('wp-plugin', 'acf-pro', '6.0.0');
    const { matches, untracked } = await queryWpVulnerability(openDb(':memory:'), fetcher, [
      c('wp-core', 'wordpress', '6.4.3'),
      c('wp-plugin', 'contact-form-7', '5.3.1'),
      c('wp-plugin', 'vieux-plugin', '1.0'),
      acf,
      c('npm', 'lodash', '4.17.15'),
    ]);
    expect(matches.map((m) => [m.component.name, m.vulnerability.id, m.vulnerability.severity, m.fixedIn])).toEqual([
      ['wordpress', 'WPV-u3', 'unknown', '6.4.4'],
      ['contact-form-7', 'CVE-1', 'critical', '5.3.2'],
      ['vieux-plugin', 'WP-CLOSED-wp-plugin-vieux-plugin', 'medium', null],
    ]);
    expect(untracked).toEqual([acf]);
  });
});
