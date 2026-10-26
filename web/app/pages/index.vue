<script setup lang="ts">
import { Loader2, Plus } from 'lucide-vue-next';

const { data, status, error, refresh } = await useFetch('/api/overview');

// Analyses PageSpeed en arrière-plan : la liste se rafraîchit jusqu'à ce qu'elles soient toutes terminées.
const perfRunning = computed(() => data.value?.clients.some((c) => c.sites.some((s) => s.perfRunning)) ?? false);
let perfPoll: ReturnType<typeof setInterval> | undefined;
watch(
  perfRunning,
  (isRunning) => {
    clearInterval(perfPoll);
    if (isRunning && import.meta.client) perfPoll = setInterval(refresh, 5000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(perfPoll));

useHead({ title: 'Sites · Argos' });

const adding = ref(false);

const urgentCount = (c: { critical: number; high: number }) => c.critical + c.high;

// Les chiffres du résumé filtrent la liste des sites, comme dans Plausible.
type Filter = 'all' | 'critical' | 'warning' | 'lifecycle' | 'unknown';
const filter = ref<Filter>('all');
const toggle = (f: Filter) => (filter.value = filter.value === f ? 'all' : f);

type SiteRow = NonNullable<typeof data.value>['clients'][number]['sites'][number];
const matches = (s: SiteRow) =>
  filter.value === 'all' ||
  (filter.value === 'lifecycle' ? s.counts.lifecycle > 0 : s.status === filter.value);

const clients = computed(() =>
  (data.value?.clients ?? [])
    .map((c) => ({ ...c, sites: c.sites.filter(matches) }))
    .filter((c) => c.sites.length),
);

const stats = computed(() => {
  const t = data.value?.totals;
  if (!t) return [];
  return [
    { key: 'all' as const, label: 'Tous les sites', value: t.sites, dot: null },
    { key: 'critical' as const, label: 'Action urgente', value: t.critical, dot: 'critical' as const },
    { key: 'warning' as const, label: 'À surveiller', value: t.warning, dot: 'warning' as const },
    { key: 'lifecycle' as const, label: 'En fin de support', value: t.lifecycle, dot: null },
    { key: 'unknown' as const, label: 'Non scannés', value: t.unknown, dot: 'unknown' as const },
  ];
});
</script>

<template>
  <div v-if="error" class="panel empty">
    <h2>Impossible de lire la base Argos</h2>
    <p class="muted">{{ error.statusMessage || error.message }}</p>
  </div>

  <template v-else-if="status === 'pending' && !data">
    <div class="skeleton" style="height: 28px; width: 160px" />
    <div class="skeleton" style="height: 88px; margin-top: 24px" />
    <div class="skeleton" style="height: 240px; margin-top: 32px" />
  </template>

  <template v-else-if="data">
    <div class="head">
      <h1>Sites</h1>
      <p class="muted">
        {{ plural(data.totals.sites, 'site', 'sites') }} chez {{ plural(data.totals.clients, 'client', 'clients') }}
        <template v-if="data.totals.lastScanAt"> · dernier scan {{ fromNow(data.totals.lastScanAt) }}</template>
      </p>
      <button v-if="data.totals.sites && !adding" class="btn add" @click="adding = true">
        <Plus :size="14" aria-hidden="true" />
        Ajouter un site
      </button>
    </div>

    <AddSiteForm v-if="adding" @close="adding = false" />

    <div v-if="!data.totals.sites && !adding" class="panel empty">
      <h2>Aucun site pour l'instant</h2>
      <p class="muted">
        Indiquez le dossier local d'un projet Nuxt, Kirby ou WordPress : Argos inventorie ses composants et surveille
        leurs failles.
      </p>
      <div>
        <button class="btn btn-primary" @click="adding = true">
          <Plus :size="14" aria-hidden="true" />
          Ajouter un premier site
        </button>
      </div>
      <p class="subtle small">
        Plusieurs projets dans un même dossier ? Depuis le terminal :
        <code>argos site discover ~/chemin --client "Mon client"</code>
      </p>
    </div>

    <template v-else-if="data.totals.sites">
      <section class="panel stats" aria-label="Filtrer les sites">
        <button
          v-for="s in stats"
          :key="s.key"
          class="stat"
          :aria-pressed="filter === s.key || (s.key === 'all' && filter === 'all')"
          :disabled="s.key !== 'all' && !s.value"
          @click="toggle(s.key)"
        >
          <span class="stat-label"><StatusDot v-if="s.dot" :status="s.dot" /> {{ s.label }}</span>
          <span class="stat-value" :class="{ critical: s.key === 'critical' && s.value }">{{ s.value }}</span>
        </button>
      </section>

      <section v-for="client in clients" :key="client.id" class="client">
        <div class="client-head">
          <h2>{{ client.name }}</h2>
          <span class="subtle small">{{ plural(client.sites.length, 'site', 'sites') }}</span>
        </div>
        <div class="panel table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="col-state"><span class="sr-only">État</span></th>
                <th class="col-site">Site</th>
                <th class="col-stack hide-sm">Stack</th>
                <th class="col-components hide-sm num">Composants</th>
                <th class="col-http hide-sm" title="Note des en-têtes de sécurité du site en ligne">HTTP</th>
                <th class="col-perf hide-sm" title="Performance mobile (PageSpeed Insights)">Perf</th>
                <th>À traiter</th>
                <th class="col-scan num hide-sm">Dernier scan</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="site in client.sites"
                :key="site.id"
                class="clickable"
                @click="navigateTo(`/sites/${site.id}`)"
              >
                <td><StatusDot :status="site.status" /></td>
                <td>
                  <NuxtLink :to="`/sites/${site.id}`" class="site-name" @click.stop>{{ site.name }}</NuxtLink>
                  <div v-if="site.url" class="subtle small host">{{ displayUrl(site.url) }}</div>
                  <div class="subtle small show-sm">
                    {{ site.lastScan ? `scanné ${fromNow(site.lastScan.at)}` : 'jamais scanné' }}
                  </div>
                </td>
                <td class="hide-sm">
                  <span class="stack">
                    <span v-for="s in site.stack" :key="s" class="tag">{{ STACK_LABELS[s] ?? s }}</span>
                  </span>
                </td>
                <td class="hide-sm num">
                  {{ site.components.total }}
                  <div v-if="site.components.updates" class="small nowrap" :class="site.components.majorUpdates ? 'warning-text' : 'subtle'">
                    {{ site.components.updates }} à mettre à jour
                  </div>
                  <div v-if="site.components.untracked" class="subtle small">
                    {{ site.components.untracked }} non suivi{{ site.components.untracked > 1 ? 's' : '' }}
                  </div>
                </td>
                <td class="hide-sm"><GradeTag :grade="site.httpGrade" /></td>
                <td class="hide-sm">
                  <Loader2 v-if="site.perfRunning" :size="14" class="spin subtle" aria-label="Analyse PageSpeed en cours" />
                  <ScoreTag v-else :score="site.perfScore" />
                </td>
                <td>
                  <span v-if="site.status === 'unknown'" class="subtle small">
                    {{ site.lastScan?.status === 'error' ? 'Scan en erreur' : 'Pas encore scanné' }}
                  </span>
                  <span v-else-if="site.counts.total === site.counts.dev" class="ok-text small">Rien à signaler</span>
                  <span v-else class="todo">
                    <span v-if="site.counts.kev" class="tag tag-kev">Exploitée</span>
                    <span v-if="urgentCount(site.counts)" class="tag tag-critical">
                      {{ plural(urgentCount(site.counts), 'urgente', 'urgentes') }}
                    </span>
                    <span v-if="site.counts.lifecycle" class="tag tag-warning">Fin de support</span>
                    <span v-if="site.counts.medium" class="tag tag-warning">{{ plural(site.counts.medium, 'moyenne', 'moyennes') }}</span>
                    <span v-if="site.counts.low" class="tag">{{ plural(site.counts.low, 'faible', 'faibles') }}</span>
                    <span v-if="site.counts.unknown" class="tag tag-unknown">
                      {{ plural(site.counts.unknown, 'non évaluée', 'non évaluées') }}
                    </span>
                  </span>
                </td>
                <td class="num subtle small hide-sm">{{ fromNow(site.lastScan?.at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p v-if="!clients.length" class="muted filtered-empty">Aucun site dans cette catégorie.</p>
    </template>
  </template>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.head .add {
  align-self: center;
  margin-left: auto;
}
.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  margin-top: 24px;
  overflow: hidden;
}
.stat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px 20px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.stat + .stat {
  border-left: 1px solid var(--border);
}
.stat:hover:not(:disabled) {
  background: var(--surface-2);
}
.stat:disabled {
  cursor: default;
}
.stat:disabled .stat-value {
  color: var(--text-3);
}
.stat[aria-pressed='true']::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: var(--accent);
}
.stat:focus-visible {
  outline-offset: -2px;
}
.host {
  max-width: 260px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.filtered-empty {
  margin-top: 32px;
}
.stat-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 500;
}
.stat-value {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.stat-value.critical {
  color: var(--critical);
}
.client {
  margin-top: 40px;
}
.client-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
/* Largeurs fixes : les colonnes restent alignées d'un client à l'autre, quel que soit le contenu. */
.table-wrap .table {
  table-layout: fixed;
  min-width: 860px;
}
.col-state {
  width: 44px;
}
.col-site {
  width: 22%;
}
.col-stack {
  width: 120px;
}
.col-components {
  width: 140px;
}
.col-http {
  width: 76px;
}
.col-perf {
  width: 76px;
}
.col-scan {
  width: 120px;
}
.site-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}
.site-name:hover {
  color: var(--accent);
}
.stack,
.todo {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
  padding: 32px;
}
@media (max-width: 720px) {
  .table-wrap .table {
    min-width: 0;
  }
  .col-site {
    width: 50%;
  }
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .stat:first-child {
    grid-column: 1 / -1;
  }
  .stat:nth-child(2),
  .stat:nth-child(4) {
    border-left: 0;
  }
  .stat:nth-child(n + 2) {
    border-top: 1px solid var(--border);
  }
  .host {
    max-width: 150px;
  }
}
</style>
