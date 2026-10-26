<script setup lang="ts">
useHead({ title: 'Failles · Argos' });

const route = useRoute();
const status = ref((route.query.status as string) || 'open');
const severity = ref((route.query.severity as string) || '');
const site = ref((route.query.site as string) || '');
const hideDev = ref(route.query.dev !== '1');

const query = computed(() => ({
  status: status.value,
  severity: severity.value || undefined,
  site: site.value || undefined,
  prod: hideDev.value ? '1' : undefined,
}));

// Les filtres restent dans l'URL : une vue filtrée peut être rouverte telle quelle.
watch(query, (q) =>
  navigateTo(
    {
      query: {
        status: q.status === 'open' ? undefined : q.status,
        severity: q.severity,
        site: q.site,
        dev: hideDev.value ? undefined : '1',
      },
    },
    { replace: true },
  ),
);

const { data: findings, status: loading, refresh } = await useFetch('/api/findings', { query });
const { data: overview } = await useFetch('/api/overview');

const sites = computed(() =>
  (overview.value?.clients ?? []).flatMap((c) => c.sites.map((s) => ({ id: s.id, label: `${c.name} · ${s.name}` }))),
);

const STATUSES = [
  { value: 'open', label: 'Ouvertes' },
  { value: 'ignored', label: 'Ignorées' },
  { value: 'fixed', label: 'Corrigées' },
];

const EMPTY = {
  open: 'Aucune faille ouverte avec ces filtres.',
  ignored: 'Aucune faille ignorée.',
  fixed: 'Aucune faille corrigée pour l’instant.',
} as Record<string, string>;
</script>

<template>
  <div class="head">
    <h1>Failles</h1>
    <p class="muted">
      <template v-if="findings">{{ plural(findings.length, 'résultat', 'résultats') }}</template>
    </p>
  </div>

  <div class="filters">
    <div class="segmented" role="radiogroup" aria-label="Statut">
      <button
        v-for="s in STATUSES"
        :key="s.value"
        role="radio"
        :aria-checked="status === s.value"
        @click="status = s.value"
      >
        {{ s.label }}
      </button>
    </div>
    <select v-model="severity" class="select" aria-label="Sévérité">
      <option value="">Toutes sévérités</option>
      <option v-for="(label, key) in SEVERITY_LABELS" :key="key" :value="key">{{ label }}</option>
    </select>
    <select v-model="site" class="select" aria-label="Site">
      <option value="">Tous les sites</option>
      <option v-for="s in sites" :key="s.id" :value="String(s.id)">{{ s.label }}</option>
    </select>
    <label class="check small muted">
      <input v-model="hideDev" type="checkbox" />
      Masquer les dépendances de dev
    </label>
  </div>

  <div v-if="loading === 'pending' && !findings" class="panel" style="padding: 20px">
    <div v-for="i in 5" :key="i" class="skeleton" style="height: 44px; margin: 8px 0" />
  </div>
  <div v-else-if="findings?.length" class="panel" :class="{ refreshing: loading === 'pending' }">
    <FindingList :findings="findings" @changed="refresh" />
  </div>
  <div v-else class="panel notice">
    <h2>Rien ici</h2>
    <p class="muted">{{ EMPTY[status] }}</p>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 24px 0 16px;
}
.select {
  width: 200px;
}
.filters {
  position: sticky;
  top: 57px;
  z-index: 5;
  margin-left: -24px;
  margin-right: -24px;
  padding: 10px 24px;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
}
@media (max-width: 720px) {
  .select {
    width: auto;
    flex: 1;
  }
  .filters {
    position: static;
    margin-left: 0;
    margin-right: 0;
    padding: 0;
  }
}
.refreshing {
  opacity: 0.6;
  transition: opacity 150ms ease;
}
</style>
