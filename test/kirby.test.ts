import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kirby } from '../src/core/adapters/kirby.ts';
import { minPhpVersion, parseComposerLock } from '../src/core/lockfiles/composer.ts';

function project(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'argos-kirby-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const summary = (cs: { ecosystem: string; name: string; version: string; isDev: boolean }[]) =>
  cs.map((c) => `${c.ecosystem}:${c.name}@${c.version}${c.isDev ? ' (dev)' : ''}`).sort();

describe('parseComposerLock', () => {
  it('sépare prod et dev, nettoie les versions, ignore les branches', () => {
    const lock = {
      packages: [
        { name: 'getkirby/cms', version: '4.3.0' },
        { name: 'claviska/simpleimage', version: 'v4.2.0' },
        { name: 'acme/wip', version: 'dev-main' },
      ],
      'packages-dev': [{ name: 'phpunit/phpunit', version: '10.5.0' }],
    };
    expect(summary(parseComposerLock(JSON.stringify(lock)))).toEqual([
      'packagist:claviska/simpleimage@4.2.0',
      'packagist:getkirby/cms@4.3.0',
      'packagist:phpunit/phpunit@10.5.0 (dev)',
    ]);
  });
});

describe('minPhpVersion', () => {
  it('prend la plus basse version de la contrainte', () => {
    expect(minPhpVersion('~8.2.0 || ~8.1.0 || ~8.3.0')).toBe('8.1.0');
    expect(minPhpVersion('>=8.0.2')).toBe('8.0.2');
    expect(minPhpVersion(undefined)).toBeNull();
  });
});

describe('adaptateur kirby', () => {
  it('projet Composer : lockfile, plugin manuel, PHP et build front', async () => {
    const dir = project({
      'composer.json': { require: { php: '~8.1.0 || ~8.2.0', 'getkirby/cms': '^4.0' } },
      'composer.lock': {
        packages: [
          { name: 'getkirby/cms', version: '4.3.0' },
          { name: 'tobimori/kirby-seo', version: '1.0.0' },
        ],
      },
      'site/plugins/kirby-seo/composer.json': { name: 'tobimori/kirby-seo', version: '1.0.0' },
      'site/plugins/maison/index.php': '<?php',
      'site/plugins/galerie/package.json': { version: '2.1.0' },
      'package.json': { dependencies: { swiper: '^8' } },
      'package-lock.json': { lockfileVersion: 3, packages: { '': {}, 'node_modules/swiper': { version: '8.0.0' } } },
    });
    expect(await kirby.detect(dir)).toBe(true);
    expect(summary(await kirby.inventory(dir))).toEqual([
      'npm:swiper@8.0.0',
      'packagist:getkirby/cms@4.3.0',
      'packagist:site/plugins/galerie@2.1.0',
      'packagist:tobimori/kirby-seo@1.0.0',
      'runtime:php@8.1.0',
    ]);
  });

  it('Kirby copié à la main : version lue dans kirby/composer.json', async () => {
    const dir = project({
      'kirby/bootstrap.php': '<?php',
      'kirby/composer.json': { name: 'getkirby/cms', version: '3.9.8', require: { php: '>=8.0.0 <8.3.0' } },
    });
    expect(await kirby.detect(dir)).toBe(true);
    expect(summary(await kirby.inventory(dir))).toEqual(['packagist:getkirby/cms@3.9.8']);
  });

  it('ne détecte pas un projet sans Kirby', async () => {
    expect(await kirby.detect(project({ 'composer.json': { require: { 'laravel/framework': '^11' } } }))).toBe(false);
  });
});
