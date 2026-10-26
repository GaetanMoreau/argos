<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next';

const { running, message, run } = useScan();
const route = useRoute();
// Les fiches site font partie de la liste des sites (le fil d'Ariane le dit aussi).
const inSites = computed(() => route.path === '/' || route.path.startsWith('/sites/'));
</script>

<template>
  <header class="topbar">
    <div class="container bar">
      <NuxtLink to="/" class="brand" aria-label="Argos, accueil">
        <img src="/favicon.svg?v=2" alt="" width="22" height="22" />
        <span>Argos</span>
      </NuxtLink>
      <nav class="nav">
        <NuxtLink to="/" class="nav-link" :class="{ active: inSites }" :aria-current="inSites ? 'page' : undefined">
          Sites
        </NuxtLink>
        <NuxtLink to="/failles" class="nav-link" active-class="active">Failles</NuxtLink>
      </nav>
      <div class="actions">
        <span class="small muted scan-message" aria-live="polite">{{ running ? 'Scan en cours…' : message }}</span>
        <ThemeToggle />
        <button class="btn" :disabled="running" aria-label="Tout scanner" @click="run()">
          <RefreshCw :size="14" :class="{ spin: running }" aria-hidden="true" />
          <span class="hide-sm">Tout scanner</span>
        </button>
      </div>
    </div>
  </header>
  <main class="container page">
    <NuxtPage />
  </main>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: saturate(1.4) blur(8px);
  border-bottom: 1px solid var(--border);
}
.bar {
  display: flex;
  align-items: center;
  gap: 28px;
  height: 56px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.nav {
  display: flex;
  gap: 4px;
}
.nav-link {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-weight: 500;
  transition: color 150ms ease, background-color 150ms ease;
}
.nav-link:hover {
  color: var(--text);
}
.nav-link.active {
  color: var(--text);
  background: var(--surface-2);
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.page {
  padding-top: 32px;
  padding-bottom: 64px;
}
@media (max-width: 720px) {
  .bar {
    gap: 12px;
  }
  .scan-message {
    display: none;
  }
}
</style>
