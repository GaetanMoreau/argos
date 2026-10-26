import { resolve } from 'node:path';

// Le code serveur réutilise src/core, qui a besoin de connaître la racine du projet (migrations, base).
process.env.ARGOS_ROOT ??= resolve(import.meta.dirname, '..');

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: true,
  devtools: { enabled: false },
  telemetry: false,
  css: ['~/assets/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Argos',
      meta: [{ name: 'color-scheme', content: 'light dark' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg?v=2' }],
      // Thème choisi appliqué avant le premier rendu (pas de flash) ; voir useTheme().
      script: [
        {
          innerHTML:
            "try{var t=localStorage.getItem('argos-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
          tagPosition: 'head',
        },
      ],
    },
  },
  routeRules: {
    '/**': {
      headers: {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        // Les liens vers les fiches CVE ne révèlent pas les adresses locales (noms de sites, identifiants).
        'Referrer-Policy': 'no-referrer',
      },
    },
  },
  nitro: {
    externals: { external: ['better-sqlite3'] },
  },
  typescript: {
    tsConfig: { compilerOptions: { allowImportingTsExtensions: true } },
  },
});
