<script setup lang="ts">
import { ChevronRight, FileText, Loader2, RefreshCw, Trash2 } from 'lucide-vue-next';
import { updateLag } from '../../../../../src/core/version.ts';

const route = useRoute();
const id = computed(() => Number(route.params.id));
const { data, error, refresh } = await useFetch(() => `/api/sites/${id.value}`);
const { running, run } = useScan();

// PageSpeed tourne en arrière-plan côté serveur : tant qu'il est en cours, on interroge son état toutes les 3 s.
const perfRunning = computed(() => data.value?.pagespeed?.status === 'running');
let perfPoll: ReturnType<typeof setInterval> | undefined;
watch(
  perfRunning,
  (isRunning) => {
    clearInterval(perfPoll);
    if (!isRunning || !import.meta.client) return;
    perfPoll = setInterval(async () => {
      const view = await $fetch(`/api/sites/${id.value}/pagespeed`).catch(() => null);
      if (view?.status !== 'running') await refresh();
    }, 3000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(perfPoll));

useHead({ title: () => `${data.value?.site.name ?? 'Site'} · Argos` });

type Tab = 'todo' | 'components' | 'http' | 'perf' | 'history';
const tab = computed<Tab>(() =>
  ['components', 'http', 'perf', 'history'].includes(route.query.tab as string) ? (route.query.tab as Tab) : 'todo',
);
const setTab = (t: Tab) => navigateTo({ query: t === 'todo' ? {} : { tab: t } }, { replace: true });

const showDev = ref(false);
const open = computed(() => data.value?.findings.filter((f) => f.status === 'open' && (showDev.value || !f.isDev)) ?? []);
const devCount = computed(() => data.value?.findings.filter((f) => f.status === 'open' && f.isDev).length ?? 0);
const ignored = computed(() => data.value?.findings.filter((f) => f.status === 'ignored') ?? []);
const fixed = computed(() => data.value?.findings.filter((f) => f.status === 'fixed') ?? []);

const STATUS_SENTENCES = {
  critical: 'Action urgente : au moins une faille élevée, critique ou exploitée.',
  warning: 'À surveiller : des failles mineures ou des fins de support.',
  ok: 'À jour : aucune faille connue sur les composants suivis.',
  unknown: 'Pas encore scanné avec succès.',
};

const search = ref('');
const ecosystem = ref('');
const compShowDev = ref(true);
const compScope = ref<'direct' | 'all'>('direct');
const onlyUpdates = ref(false);
const LAG_LABELS = { major: 'Majeure', minor: 'Mineure', patch: 'Correctif' } as const;
const directComponents = computed(() => (data.value?.components ?? []).filter((c) => c.direct));
const updates = computed(() => directComponents.value.filter((c) => updateLag(c.version, c.latest)));
const majorUpdates = computed(() => updates.value.filter((c) => updateLag(c.version, c.latest) === 'major').length);
const openByComponent = computed(() => {
  const counts = new Map<string, number>();
  for (const f of data.value?.findings ?? []) {
    if (f.status !== 'open') continue;
    const key = `${f.ecosystem}|${f.component}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
});
const ecosystems = computed(() => [...new Set(data.value?.components.map((c) => c.ecosystem))]);
const components = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (data.value?.components ?? []).filter(
    (c) =>
      (compScope.value === 'all' || c.direct) &&
      (!onlyUpdates.value || updateLag(c.version, c.latest)) &&
      (compShowDev.value || !c.isDev) &&
      (!ecosystem.value || c.ecosystem === ecosystem.value) &&
      (!q || c.name.toLowerCase().includes(q)),
  );
});

function duration(start: string, end: string | null) {
  if (!end) return '—';
  const s = (Date.parse(end) - Date.parse(start)) / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`;
}

async function scanThis() {
  await run(id.value);
  await refresh();
}

// Version de PHP : saisie > annoncée par la production > estimée d'après composer.json.
const showPhp = computed(() => Boolean(data.value?.php) || data.value?.site.stack.some((s) => s === 'kirby' || s === 'wordpress'));
const phpOrigin = computed(() => {
  const php = data.value?.php;
  if (!php) return { tone: 'subtle', text: 'Non annoncée par le serveur' };
  if (php.manual) {
    return php.source === 'manual' && php.version === php.manual
      ? { tone: 'subtle', text: 'Saisie à la main' }
      : { tone: 'subtle', text: 'Saisie, prise en compte au prochain scan' };
  }
  if (php.source === 'production') return { tone: 'subtle', text: 'Annoncée par le serveur' };
  return { tone: 'warning-text', text: 'Estimée d’après composer.json' };
});
const editingPhp = ref(false);
const phpInput = ref('');
const savingPhp = ref(false);
const phpError = ref<string | null>(null);
function startPhpEdit() {
  phpInput.value = data.value?.php?.manual ?? '';
  phpError.value = null;
  editingPhp.value = true;
  nextTick(() => document.getElementById('php-version')?.focus());
}
async function savePhp() {
  savingPhp.value = true;
  phpError.value = null;
  try {
    await $fetch(`/api/sites/${id.value}`, { method: 'PATCH', body: { phpVersion: phpInput.value } });
    editingPhp.value = false;
    await run(id.value); // les fins de support PHP sont recalculées avec la bonne version
    await refresh();
  } catch (err: any) {
    phpError.value = err?.data?.statusMessage ?? 'Impossible d’enregistrer';
  } finally {
    savingPhp.value = false;
  }
}

// Suppression : confirmation en place, le focus va sur « Annuler » pour éviter une validation par réflexe.
const confirmingDelete = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);
const cancelDeleteButton = ref<HTMLButtonElement | null>(null);
function askDelete() {
  confirmingDelete.value = true;
  deleteError.value = null;
  nextTick(() => cancelDeleteButton.value?.focus());
}
async function removeSite() {
  deleting.value = true;
  deleteError.value = null;
  try {
    await $fetch(`/api/sites/${id.value}`, { method: 'DELETE' });
    await navigateTo('/');
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage ?? 'La suppression a échoué';
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div v-if="error" class="panel notice">
    <h2>{{ error.statusCode === 404 ? 'Ce site n’existe pas' : 'Erreur de chargement' }}</h2>
    <NuxtLink to="/" class="link">Retour aux sites</NuxtLink>
  </div>

  <template v-else-if="data">
    <nav class="crumbs small muted" aria-label="Fil d’Ariane">
      <NuxtLink to="/">Sites</NuxtLink>
      <ChevronRight :size="13" aria-hidden="true" />
      <span>{{ data.client.name }}</span>
    </nav>

    <header class="site-head">
      <div class="title">
        <h1>{{ data.site.name }}</h1>
        <span class="stack">
          <span v-for="s in data.site.stack" :key="s" class="tag">{{ STACK_LABELS[s] ?? s }}</span>
        </span>
      </div>
      <div class="head-actions">
        <NuxtLink :to="`/sites/${data.site.id}/rapport`" class="btn">
          <FileText :size="14" aria-hidden="true" />
          Rapport
        </NuxtLink>
        <button class="btn btn-ghost" :disabled="confirmingDelete" @click="askDelete">
          <Trash2 :size="14" aria-hidden="true" />
          Supprimer
        </button>
        <button class="btn" :disabled="running" @click="scanThis">
          <RefreshCw :size="14" :class="{ spin: running }" aria-hidden="true" />
          Scanner ce site
        </button>
      </div>
    </header>

    <div v-if="confirmingDelete" class="panel confirm" role="alertdialog" aria-labelledby="confirm-title">
      <div>
        <p id="confirm-title" class="confirm-title">Supprimer « {{ data.site.name }} » d’Argos ?</p>
        <p class="muted small">
          Son historique de scans, ses failles et son inventaire seront effacés. Les fichiers du projet ne sont pas
          touchés : le site pourra être ajouté à nouveau.
        </p>
        <p v-if="deleteError" class="critical-text small" role="alert">{{ deleteError }}</p>
      </div>
      <div class="confirm-actions">
        <button ref="cancelDeleteButton" class="btn btn-ghost" @click="confirmingDelete = false">Annuler</button>
        <button class="btn btn-danger" :disabled="deleting" @click="removeSite">
          {{ deleting ? 'Suppression…' : 'Supprimer définitivement' }}
        </button>
      </div>
    </div>
    <p class="status-line">
      <StatusDot :status="data.site.status" />
      <span>{{ STATUS_SENTENCES[data.site.status] }}</span>
      <NuxtLink v-if="perfRunning" :to="{ query: { tab: 'perf' } }" class="perf-running small">
        <Loader2 :size="13" class="spin" aria-hidden="true" />
        Analyse PageSpeed en cours…
      </NuxtLink>
    </p>

    <dl class="panel facts">
      <div>
        <dt>URL</dt>
        <dd>
          <a v-if="data.site.url" :href="data.site.url" target="_blank" rel="noopener" class="link">
            {{ displayUrl(data.site.url) }}
          </a>
          <span v-else class="subtle">Non renseignée</span>
        </dd>
      </div>
      <div>
        <dt>Dossier local</dt>
        <dd class="mono path" :title="data.site.path">{{ shortPath(data.site.path) }}</dd>
      </div>
      <div>
        <dt>Hébergement</dt>
        <dd>
          <span v-if="data.site.hosting">{{ data.site.hosting }}</span>
          <span v-else class="subtle">Non renseigné</span>
        </dd>
      </div>
      <div>
        <dt>Copie locale</dt>
        <dd>
          <span v-if="data.site.copyModifiedAt" :title="formatDate(data.site.copyModifiedAt)">
            modifiée {{ fromNow(data.site.copyModifiedAt) }}
          </span>
          <span v-else class="subtle">Dossier introuvable</span>
        </dd>
      </div>
      <div v-if="showPhp">
        <dt>PHP en production</dt>
        <dd v-if="!editingPhp">
          <span v-if="data.php?.version" class="mono">{{ data.php.manual ?? data.php.version }}</span>
          <span v-else class="subtle">Inconnu</span>
          <button class="inline-edit link small" @click="startPhpEdit">{{ data.php?.manual ? 'Modifier' : 'Corriger' }}</button>
          <div class="small" :class="phpOrigin.tone">{{ phpOrigin.text }}</div>
        </dd>
        <dd v-else>
          <form class="php-form" @submit.prevent="savePhp">
            <input
              id="php-version"
              v-model="phpInput"
              class="input mono"
              placeholder="8.5"
              inputmode="decimal"
              aria-label="Version de PHP du serveur"
              @keydown.esc="editingPhp = false"
            />
            <button class="btn btn-primary btn-sm" type="submit" :disabled="savingPhp">OK</button>
          </form>
          <p class="small subtle">Vide = revenir à l’estimation.</p>
          <p v-if="phpError" class="critical-text small" role="alert">{{ phpError }}</p>
        </dd>
      </div>
    </dl>

    <div class="tabs" role="tablist">
      <button role="tab" :aria-selected="tab === 'todo'" class="tab" @click="setTab('todo')">
        À traiter <span class="count">{{ data.counts.total - data.counts.dev }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'components'" class="tab" @click="setTab('components')">
        Composants <span class="count">{{ directComponents.length }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'http'" class="tab" @click="setTab('http')">
        Sécurité en ligne <GradeTag v-if="data.http?.grade" :grade="data.http.grade" />
      </button>
      <button role="tab" :aria-selected="tab === 'perf'" class="tab" @click="setTab('perf')">
        Performance
        <Loader2 v-if="perfRunning" :size="13" class="spin subtle" aria-label="Analyse en cours" />
        <ScoreTag v-else-if="data.pagespeed?.result" :score="data.pagespeed.result.scores.performance" />
      </button>
      <button role="tab" :aria-selected="tab === 'history'" class="tab" @click="setTab('history')">
        Historique
      </button>
    </div>

    <section v-if="tab === 'todo'" role="tabpanel">
      <div v-if="devCount" class="toolbar">
        <label class="check small muted">
          <input v-model="showDev" type="checkbox" />
          Inclure les dépendances de dev ({{ devCount }})
        </label>
      </div>
      <div v-if="open.length" class="panel">
        <FindingList :findings="open" grouped @changed="refresh" />
      </div>
      <div v-else class="panel notice">
        <h2>Rien à traiter</h2>
        <p class="muted">
          {{
            data.site.status === 'unknown'
              ? 'Lancez un scan pour inventorier ce site.'
              : 'Aucune faille ouverte sur les composants suivis. Le scan quotidien vous préviendra si cela change.'
          }}
        </p>
      </div>

      <details v-if="ignored.length" class="more-block">
        <summary>Ignorées ({{ ignored.length }})</summary>
        <div class="panel"><FindingList :findings="ignored" grouped @changed="refresh" /></div>
      </details>
      <details v-if="fixed.length" class="more-block">
        <summary>Corrigées ces 90 derniers jours ({{ fixed.length }})</summary>
        <div class="panel"><FindingList :findings="fixed" grouped /></div>
      </details>
    </section>

    <section v-else-if="tab === 'components'" role="tabpanel">
      <p v-if="directComponents.length" class="small muted comp-summary">
        {{ plural(directComponents.length, 'composant direct', 'composants directs') }} ·
        <template v-if="updates.length">
          {{ plural(updates.length, 'mise à jour disponible', 'mises à jour disponibles')
          }}<template v-if="majorUpdates">, dont {{ plural(majorUpdates, 'majeure', 'majeures') }}</template>
        </template>
        <span v-else class="ok-text">tout est à jour</span>
      </p>
      <div class="toolbar">
        <div class="segmented" role="radiogroup" aria-label="Portée">
          <button role="radio" :aria-checked="compScope === 'direct'" @click="compScope = 'direct'">Directes</button>
          <button role="radio" :aria-checked="compScope === 'all'" @click="compScope = 'all'">Toutes</button>
        </div>
        <input v-model="search" class="input search" type="search" placeholder="Rechercher un composant" />
        <select v-model="ecosystem" class="select" aria-label="Type de composant">
          <option value="">Tous les types</option>
          <option v-for="e in ecosystems" :key="e" :value="e">{{ ECOSYSTEM_LABELS[e] ?? e }}</option>
        </select>
        <label class="check small muted">
          <input v-model="compShowDev" type="checkbox" />
          Dépendances de dev
        </label>
        <label class="check small muted">
          <input v-model="onlyUpdates" type="checkbox" />
          À mettre à jour
        </label>
      </div>
      <div class="panel table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Composant</th>
              <th>Type</th>
              <th>Version</th>
              <th>Dernière version</th>
              <th class="num">Failles ouvertes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in components" :key="`${c.ecosystem}|${c.name}|${c.version}`">
              <td>
                <span class="comp-name">{{ c.name }}</span>
                <span v-if="c.isDev" class="tag">dev</span>
                <span
                  v-if="c.untracked"
                  class="tag tag-warning"
                  title="Inconnu des bases de failles : ni sain ni vulnérable, à vérifier à la main"
                >
                  Non suivi
                </span>
              </td>
              <td class="muted">{{ ECOSYSTEM_LABELS[c.ecosystem] ?? c.ecosystem }}</td>
              <td class="mono">{{ c.version }}</td>
              <td>
                <span v-if="updateLag(c.version, c.latest)" class="latest">
                  <span class="mono">{{ c.latest }}</span>
                  <span class="tag" :class="{ 'tag-warning': updateLag(c.version, c.latest) === 'major' }">
                    {{ LAG_LABELS[updateLag(c.version, c.latest)!] }}
                  </span>
                </span>
                <span v-else-if="c.latest" class="ok-text small">à jour</span>
                <span v-else-if="c.direct" class="subtle small" title="Version introuvable sur npm, Packagist ou wordpress.org">inconnue</span>
              </td>
              <td class="num">
                <span v-if="openByComponent.get(`${c.ecosystem}|${c.name}`)" class="critical-text">
                  {{ openByComponent.get(`${c.ecosystem}|${c.name}`) }}
                </span>
                <span v-else class="subtle">—</span>
              </td>
            </tr>
            <tr v-if="!components.length">
              <td colspan="5" class="muted empty-row">Aucun composant ne correspond.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="tab === 'perf'" role="tabpanel">
      <PageSpeedPanel :site-id="data.site.id" :url="data.site.url" :view="data.pagespeed" @changed="refresh" />
    </section>
    <section v-else-if="tab === 'http'" role="tabpanel">
      <HttpSecurity
        :site-id="data.site.id"
        :url="data.site.url"
        :report="data.http"
        :local-versions="data.localVersions"
        @changed="refresh"
      />
    </section>

    <section v-else role="tabpanel">
      <div class="panel table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Durée</th>
              <th>Résultat</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in data.scans" :key="s.id">
              <td>{{ formatDate(s.at) }}</td>
              <td class="muted">{{ duration(s.at, s.finishedAt) }}</td>
              <td>
                <span v-if="s.status === 'ok'" class="tag tag-ok">Réussi</span>
                <span v-else-if="s.status === 'running'" class="tag">En cours</span>
                <template v-else>
                  <span class="tag tag-critical">Erreur</span>
                  <span class="small critical-text scan-error">{{ s.error }}</span>
                </template>
              </td>
            </tr>
            <tr v-if="!data.scans.length">
              <td colspan="3" class="muted empty-row">Ce site n’a jamais été scanné.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
}
.crumbs a:hover {
  color: var(--text);
}
.site-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 10px;
}
.title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
.stack {
  display: inline-flex;
  gap: 4px;
}
.inline-edit {
  margin-left: 8px;
}
.php-form {
  display: flex;
  gap: 6px;
}
.php-form .input {
  width: 90px;
  height: 26px;
}
.head-actions {
  display: flex;
  gap: 8px;
  flex: none;
}
.confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 16px;
  padding: 16px 20px;
  border-color: var(--critical);
}
.confirm-title {
  font-weight: 600;
}
.confirm-actions {
  display: flex;
  gap: 8px;
  flex: none;
}
.perf-running {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  color: var(--accent);
}
.status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  color: var(--text-2);
}
.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs {
  display: flex;
  gap: 20px;
  margin-top: 32px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  flex: none;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -1px;
  padding: 10px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-2);
  font: 500 14px/1 var(--font);
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;
}
.tab:hover {
  color: var(--text);
}
.tab[aria-selected='true'] {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.count {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
}
section {
  margin-top: 20px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.search {
  width: 260px;
}
.more-block {
  margin-top: 20px;
}
.more-block summary {
  margin-bottom: 10px;
  color: var(--text-2);
  font-weight: 500;
  cursor: pointer;
}
.more-block summary:hover {
  color: var(--text);
}
.comp-name {
  margin-right: 6px;
  font-weight: 500;
}
.empty-row {
  padding: 24px 16px;
  text-align: center;
}
@media (max-width: 720px) {
  .site-head {
    flex-wrap: wrap;
  }
  .confirm {
    flex-direction: column;
    align-items: stretch;
  }
  .confirm-actions {
    justify-content: flex-end;
  }
  .search {
    width: 100%;
  }
}
.facts {
  margin-top: 24px;
}
.comp-summary {
  margin-bottom: 12px;
}
.latest {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.scan-error {
  margin-left: 8px;
}
</style>
