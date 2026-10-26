<script setup lang="ts">
import { ExternalLink, Loader2, RefreshCw } from 'lucide-vue-next';
import type { pageSpeedView } from '../../../src/core/queries.ts';

const props = defineProps<{ siteId: number; url: string | null; view: ReturnType<typeof pageSpeedView> }>();
const emit = defineEmits<{ changed: [] }>();

const { data: key, refresh: refreshKey } = await useFetch('/api/pagespeed/key', { key: 'pagespeed-key' });

const starting = ref(false);
const failure = ref<string | null>(null);
async function analyze() {
  starting.value = true;
  failure.value = null;
  try {
    await $fetch(`/api/sites/${props.siteId}/pagespeed`, { method: 'POST', body: {} });
    emit('changed');
  } catch (err: any) {
    failure.value = err?.data?.statusMessage ?? 'Impossible de lancer l’analyse';
  } finally {
    starting.value = false;
  }
}

const keyInput = ref('');
const savingKey = ref(false);
async function saveKey() {
  savingKey.value = true;
  failure.value = null;
  try {
    await $fetch('/api/pagespeed/key', { method: 'POST', body: { key: keyInput.value } });
    keyInput.value = '';
    await refreshKey();
    if (props.url) await analyze();
  } catch (err: any) {
    failure.value = err?.data?.statusMessage ?? 'Impossible d’enregistrer la clé';
  } finally {
    savingKey.value = false;
  }
}

const result = computed(() => props.view?.result ?? null);
const running = computed(() => props.view?.status === 'running');
const reportUrl = computed(() =>
  props.url ? `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(props.url)}&form_factor=mobile` : null,
);

const SCORES = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibilité'],
  ['bestPractices', 'Bonnes pratiques'],
  ['seo', 'SEO'],
] as const;
const LAB = [
  ['lcp', 'Largest Contentful Paint', 'Temps d’affichage du plus gros élément visible'],
  ['cls', 'Cumulative Layout Shift', 'Décalages de mise en page pendant le chargement'],
  ['tbt', 'Total Blocking Time', 'Temps pendant lequel la page ne répond pas'],
  ['fcp', 'First Contentful Paint', 'Premier contenu affiché'],
  ['speedIndex', 'Speed Index', 'Vitesse de remplissage visuel de la page'],
] as const;
const FIELD = [
  ['lcp', 'Largest Contentful Paint'],
  ['inp', 'Interaction to Next Paint'],
  ['cls', 'Cumulative Layout Shift'],
] as const;
/** Problèmes groupés par catégorie, dans l'ordre des notes. */
const issueGroups = computed(() =>
  SCORES.map(([id, label]) => ({ id, label, issues: (result.value?.issues ?? []).filter((i) => i.category === id) })).filter(
    (g) => g.issues.length,
  ),
);
const formatSavings = (ms: number | null, bytes: number | null) =>
  [ms && `≈ ${ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : `${ms} ms`}`, bytes && `${Math.round(bytes / 1024)} Kio`]
    .filter(Boolean)
    .join(' · ');
const ratingClass = (r: string) => (r === 'good' ? 'ok-text' : r === 'average' ? 'warning-text' : 'critical-text');
</script>

<template>
  <div v-if="!url" class="panel notice">
    <h2>Pas d’URL pour ce site</h2>
    <p class="muted">PageSpeed analyse le site en ligne : renseignez son adresse dans l’onglet Sécurité en ligne.</p>
  </div>

  <template v-else>
    <div v-if="!key?.configured" class="panel notice key-notice">
      <h2>Clé API Google nécessaire</h2>
      <p class="muted">
        Sans clé, Google refuse les analyses. La clé est gratuite et stockée dans le trousseau macOS, jamais dans un fichier.
        <a href="https://developers.google.com/speed/docs/insights/v5/get-started" target="_blank" rel="noopener" class="link">
          Obtenir une clé <ExternalLink :size="11" aria-hidden="true" />
        </a>
      </p>
      <form class="key-form" @submit.prevent="saveKey">
        <input v-model="keyInput" class="input mono" placeholder="AIza…" aria-label="Clé API PageSpeed" autocomplete="off" required />
        <button class="btn btn-primary" type="submit" :disabled="savingKey || !keyInput.trim()">
          {{ savingKey ? 'Enregistrement…' : 'Enregistrer et analyser' }}
        </button>
      </form>
    </div>

    <div v-if="running" class="panel running" role="status">
      <Loader2 :size="16" class="spin" aria-hidden="true" />
      <div>
        <p class="running-title">Analyse PageSpeed en cours</p>
        <p class="muted small">
          Google charge le site comme un mobile : 15 à 40 secondes. Les résultats s’afficheront ici d’eux-mêmes.
        </p>
      </div>
    </div>

    <div v-else-if="!result && key?.configured" class="panel notice">
      <h2>{{ view?.status === 'error' ? 'L’analyse a échoué' : 'Pas encore analysé' }}</h2>
      <p class="muted">
        {{
          view?.status === 'error'
            ? view.error
            : 'PageSpeed mesure la vitesse du site sur mobile et note son accessibilité, ses bonnes pratiques et son SEO.'
        }}
      </p>
      <div>
        <button class="btn btn-primary" :disabled="starting" @click="analyze">
          {{ starting ? 'Lancement…' : 'Analyser maintenant' }}
        </button>
      </div>
    </div>

    <template v-if="result">
      <p v-if="view?.status === 'error'" class="panel inline-error critical-text small" role="alert">
        Dernière analyse en échec : {{ view.error }}. Résultats précédents ci-dessous.
      </p>

      <div class="perf-head">
        <p class="small muted">
          Mobile · analysé {{ fromNow(view?.finishedAt ?? view?.startedAt) }}
          <template v-if="result.finalUrl"> sur {{ displayUrl(result.finalUrl) }}</template>
        </p>
        <button class="btn" :disabled="running || starting || !key?.configured" @click="analyze">
          <RefreshCw :size="14" :class="{ spin: running || starting }" aria-hidden="true" />
          {{ running || starting ? 'Analyse en cours…' : 'Relancer l’analyse' }}
        </button>
      </div>

      <dl class="panel facts" :class="{ stale: running }">
        <div v-for="[id, label] in SCORES" :key="id">
          <dt>{{ label }}</dt>
          <dd><ScoreTag :score="result.scores[id]" large /></dd>
        </div>
      </dl>

      <section class="block" :class="{ stale: running }">
        <h3>À corriger</h3>
        <p v-if="!issueGroups.length" class="muted small">Aucun contrôle Lighthouse en échec.</p>
        <p v-else-if="result.scores.performance < 90 && !issueGroups.some((g) => g.id === 'performance')" class="muted small">
          Aucune recommandation de performance en échec : la note vient des mesures ci-dessous, simulées sur un mobile lent.
        </p>
        <div v-for="group in issueGroups" :key="group.id" class="issue-group">
          <h4 class="small">{{ group.label }} · {{ plural(group.issues.length, 'point', 'points') }}</h4>
          <div class="panel">
            <article v-for="issue in group.issues" :key="issue.id" class="issue">
              <div class="issue-head">
                <p class="issue-title">{{ issue.title }}</p>
                <span class="small subtle issue-meta">
                  <template v-if="issue.displayValue">{{ issue.displayValue }}</template>
                  <template v-if="formatSavings(issue.savingsMs, issue.savingsBytes)"> · gain estimé {{ formatSavings(issue.savingsMs, issue.savingsBytes) }}</template>
                  <template v-if="!issue.weight && issue.category !== 'performance'"> · sans effet sur la note</template>
                </span>
              </div>
              <p v-if="issue.description" class="muted small">
                {{ issue.description }}
                <a v-if="issue.learnMore" :href="issue.learnMore" target="_blank" rel="noopener" class="link">
                  En savoir plus <ExternalLink :size="11" aria-hidden="true" />
                </a>
              </p>
              <details v-if="issue.items.length" class="elements">
                <summary class="small">{{ plural(issue.itemCount, 'élément concerné', 'éléments concernés') }}</summary>
                <ul>
                  <li v-for="(item, i) in issue.items" :key="i">
                    <span v-if="item.label" class="el-label">{{ item.label }}</span>
                    <code v-if="item.selector" class="el-code">{{ item.selector }}</code>
                    <code v-if="item.snippet" class="el-code subtle">{{ item.snippet }}</code>
                    <code v-if="item.url" class="el-code">{{ item.url }}</code>
                  </li>
                </ul>
                <p v-if="issue.itemCount > issue.items.length" class="small subtle">
                  … et {{ issue.itemCount - issue.items.length }} autres dans le rapport complet.
                </p>
              </details>
            </article>
          </div>
        </div>
      </section>

      <section class="block" :class="{ stale: running }">
        <h3>Mesures de laboratoire</h3>
        <p class="muted small">Simulation Lighthouse sur un mobile de milieu de gamme, en 4G lente.</p>
        <div class="panel table-wrap">
          <table class="table">
            <tbody>
              <tr v-for="[id, label, hint] in LAB" :key="id">
                <td>
                  <span class="metric">{{ label }}</span>
                  <div class="subtle small hint">{{ hint }}</div>
                </td>
                <td class="num mono">{{ result.lab[id].display }}</td>
                <td class="num small" :class="ratingClass(result.lab[id].rating)">{{ RATING_LABELS[result.lab[id].rating] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl v-if="result.lcpElement || result.totalWeight" class="lab-notes small">
          <div v-if="result.lcpElement">
            <dt>Élément LCP</dt>
            <dd>
              <span v-if="result.lcpElement.label">{{ result.lcpElement.label }}</span>
              <code v-if="result.lcpElement.selector" class="el-code">{{ result.lcpElement.selector }}</code>
            </dd>
          </div>
          <div v-if="result.totalWeight">
            <dt>Poids de la page</dt>
            <dd>{{ result.totalWeight.replace(/^La taille totale était de /, '') }}</dd>
          </div>
        </dl>
      </section>

      <section class="block" :class="{ stale: running }">
        <h3>Utilisateurs réels</h3>
        <template v-if="result.field">
          <p class="muted small">
            Visiteurs sous Chrome sur 28 jours (75ᵉ centile) :
            <span :class="ratingClass(result.field.overall)">{{ RATING_LABELS[result.field.overall] }}</span>
            dans l’ensemble.
          </p>
          <div class="panel table-wrap">
            <table class="table">
              <tbody>
                <template v-for="[id, label] in FIELD" :key="id">
                  <tr v-if="result.field[id]">
                    <td><span class="metric">{{ label }}</span></td>
                    <td class="num mono">{{ result.field[id]!.display }}</td>
                    <td class="num small" :class="ratingClass(result.field[id]!.rating)">
                      {{ RATING_LABELS[result.field[id]!.rating] }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
        <p v-else class="muted small">
          Pas assez de visites pour que Google publie des mesures réelles : seules les mesures de laboratoire sont disponibles.
        </p>
      </section>

      <p v-if="reportUrl" class="foot small">
        <a :href="reportUrl" target="_blank" rel="noopener" class="link">
          Rapport complet sur PageSpeed Insights <ExternalLink :size="11" aria-hidden="true" />
        </a>
      </p>
    </template>

    <p v-if="failure" class="critical-text small failure" role="alert">{{ failure }}</p>
  </template>
</template>

<style scoped>
.key-notice {
  margin-bottom: 16px;
}
.failure {
  margin-top: 12px;
}
.key-form {
  display: flex;
  gap: 8px;
  max-width: 560px;
  margin-top: 8px;
}
.key-form .input {
  flex: 1 1 auto;
  min-width: 0;
}
.running {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
  padding: 16px 20px;
  color: var(--accent);
}
.running-title {
  color: var(--text);
  font-weight: 600;
}
.inline-error {
  margin-bottom: 16px;
  padding: 12px 20px;
}
.stale {
  opacity: 0.55;
  transition: opacity 150ms ease;
}
.block h3 {
  margin-bottom: 2px;
}
.block .panel {
  margin-top: 10px;
}
.metric {
  font-weight: 500;
}
.issue-group + .issue-group {
  margin-top: 16px;
}
.issue-group h4 {
  margin: 12px 0 8px;
  color: var(--text-2);
  font-weight: 600;
}
.issue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 20px;
}
.issue + .issue {
  border-top: 1px solid var(--border);
}
.issue-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.issue-title {
  font-weight: 600;
}
.issue a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.elements summary {
  width: fit-content;
  color: var(--text-2);
  font-weight: 500;
  cursor: pointer;
}
.elements summary:hover {
  color: var(--text);
}
.elements ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.elements li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 12px;
  border-left: 1px solid var(--border);
}
.el-label {
  font-weight: 500;
}
.el-code {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.lab-notes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 32px;
  margin: 10px 0 0;
}
.lab-notes dt {
  color: var(--text-3);
}
.lab-notes dd {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 2px 0 0;
}
/* Mêmes largeurs pour les deux tableaux : valeurs et appréciations alignées de l'un à l'autre. */
.block .table {
  table-layout: fixed;
}
.block .table td:nth-child(2) {
  width: 120px;
}
.block .table td:nth-child(3) {
  width: 130px;
}
.perf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.foot {
  margin-top: 16px;
}
.foot a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
@media (max-width: 720px) {
  .key-form {
    flex-direction: column;
  }
  .block .table td:nth-child(2) {
    width: 72px;
  }
  .block .table td:nth-child(3) {
    width: 92px;
  }
  .hint {
    display: none;
  }
}
</style>
