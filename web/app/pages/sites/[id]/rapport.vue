<script setup lang="ts">
import { ChevronLeft, Printer } from 'lucide-vue-next';

const route = useRoute();
const days = ref(Number(route.query.days) || 30);
const { data, error } = await useFetch(() => `/api/sites/${route.params.id}/report`, { query: { days } });
watch(days, (d) => navigateTo({ query: { days: d === 30 ? undefined : d } }, { replace: true }));

useHead({ title: () => `Rapport ${data.value?.site.name ?? ''} · Argos` });

const PERIODS = [
  [30, '30 jours'],
  [90, '3 mois'],
  [365, '12 mois'],
] as const;
const STATUS = {
  action: ['Action nécessaire', 'critical'],
  watch: ['À surveiller', 'warning'],
  healthy: ['En bonne santé', 'ok'],
  unknown: ['Non vérifié', 'unknown'],
} as const;
const PLAIN_SEVERITY: Record<string, [string, string]> = {
  critical: ['critique', 'critiques'],
  high: ['important', 'importants'],
  medium: ['moyen', 'moyens'],
  low: ['mineur', 'mineurs'],
  unknown: ['non évalué', 'non évalués'],
};

const periodStart = computed(() =>
  data.value ? new Date(Date.parse(data.value.generatedAt) - data.value.days * 86_400_000).toISOString() : null,
);
const site = computed(() => data.value?.site);
const print = () => window.print();
</script>

<template>
  <div v-if="error" class="panel notice">
    <h2>{{ error.statusCode === 404 ? 'Ce site n’existe pas' : 'Erreur de chargement' }}</h2>
    <NuxtLink to="/" class="link">Retour aux sites</NuxtLink>
  </div>

  <template v-else-if="data && site">
    <div class="toolbar no-print">
      <NuxtLink :to="`/sites/${site.id}`" class="back small muted">
        <ChevronLeft :size="14" aria-hidden="true" /> {{ site.name }}
      </NuxtLink>
      <div class="segmented" role="radiogroup" aria-label="Période">
        <button v-for="[value, label] in PERIODS" :key="value" role="radio" :aria-checked="days === value" @click="days = value">
          {{ label }}
        </button>
      </div>
      <button class="btn btn-primary" @click="print">
        <Printer :size="14" aria-hidden="true" />
        Imprimer ou enregistrer en PDF
      </button>
    </div>

    <article class="sheet panel">
      <header class="sheet-head">
        <img src="/favicon.svg?v=2" alt="" width="28" height="28" />
        <div class="sheet-title">
          <h1>Rapport de maintenance · {{ site.name }}</h1>
          <p class="muted">
            {{ data.client.name }}<template v-if="site.url"> · {{ displayUrl(site.url) }}</template> · du
            {{ formatDay(periodStart, 'long') }} au {{ formatDay(data.generatedAt, 'long') }}
          </p>
        </div>
        <span class="status" :class="`status-${STATUS[site.status][1]}`">
          <StatusDot :status="STATUS[site.status][1]" />
          {{ STATUS[site.status][0] }}
        </span>
      </header>

      <dl class="facts site-facts">
        <div>
          <dt>Technologie</dt>
          <dd>
            {{ site.technologies.join(', ') || '—' }}
            <div v-if="site.php" class="small muted">PHP {{ site.php }}</div>
          </dd>
        </div>
        <div>
          <dt>Certificat de sécurité</dt>
          <dd v-if="site.online.certExpiresAt">
            <span :class="(daysUntil(site.online.certExpiresAt) ?? 99) <= 30 ? 'warning-text' : ''">
              valable jusqu’au {{ formatDay(site.online.certExpiresAt) }}
            </span>
          </dd>
          <dd v-else class="muted">{{ site.online.https === false ? 'Absent (pas de HTTPS)' : '—' }}</dd>
        </div>
        <div>
          <dt>Nom de domaine</dt>
          <dd v-if="site.online.domainExpiresAt">
            <span :class="(daysUntil(site.online.domainExpiresAt) ?? 99) <= 30 ? 'warning-text' : ''">
              renouvelé jusqu’au {{ formatDay(site.online.domainExpiresAt) }}
            </span>
          </dd>
          <dd v-else class="muted">—</dd>
        </div>
        <div>
          <dt>Vitesse sur mobile</dt>
          <dd>
            <ScoreTag :score="site.online.performance" />
            <span v-if="site.online.performance != null" class="small muted"> / 100</span>
          </dd>
        </div>
      </dl>

      <div class="columns">
        <section>
          <h2>Corrigé sur la période</h2>
          <p v-if="!site.fixed.total" class="small muted">Aucune correction enregistrée sur la période.</p>
          <template v-else>
            <p class="small">{{ plural(site.fixed.total, 'problème corrigé', 'problèmes corrigés') }}, dont :</p>
            <ul class="small">
              <li v-for="(item, i) in site.fixed.items" :key="i">
                <strong>{{ item.component }}</strong> · {{ item.summary }}
              </li>
            </ul>
          </template>
        </section>
        <section>
          <h2>Points ouverts</h2>
          <p v-if="!site.open.total" class="small ok-text">Aucun point ouvert.</p>
          <template v-else>
            <p class="small">
              {{ plural(site.open.total, 'point à traiter', 'points à traiter')
              }}<template v-if="site.open.urgent">, dont
                <strong class="critical-text">{{ plural(site.open.urgent, 'prioritaire', 'prioritaires') }}</strong></template>
            </p>
            <p class="small muted">
              {{
                Object.entries(site.open.bySeverity)
                  .map(([severity, count]) => plural(count, ...PLAIN_SEVERITY[severity]!))
                  .join(' · ')
              }}
            </p>
          </template>
          <p v-if="site.ignored" class="small muted">
            {{ plural(site.ignored, 'point écarté', 'points écartés') }} après analyse (sans risque pour ce site).
          </p>
          <p v-if="site.updates.total" class="small muted">
            {{ plural(site.updates.total, 'mise à jour disponible', 'mises à jour disponibles')
            }}<template v-if="site.updates.major">, dont {{ plural(site.updates.major, 'majeure', 'majeures') }}</template>.
          </p>
        </section>
      </div>

      <section class="recommendations">
        <h2>Recommandations</h2>
        <ol v-if="site.recommendations.length" class="small">
          <li v-for="(rec, i) in site.recommendations" :key="i">{{ rec }}</li>
        </ol>
        <p v-else class="small ok-text">Aucune action recommandée pour le moment.</p>
      </section>

      <footer class="sheet-foot small muted">
        <template v-if="site.lastScanAt">Dernière vérification le {{ formatDay(site.lastScanAt, 'long') }}. </template>
        Vérifications automatiques : composants et versions installés comparés aux bases publiques de failles (OSV, WPVulnerability,
        catalogue CISA des failles exploitées) et aux calendriers de fin de support ; site en ligne (HTTPS, certificat, en-têtes, fichiers
        sensibles), nom de domaine, e-mail et performance mobile (Google PageSpeed Insights).
      </footer>
    </article>
  </template>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.toolbar .btn {
  margin-left: auto;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.back:hover {
  color: var(--text);
}
.sheet {
  margin: 0 auto;
  padding: 40px 48px;
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.sheet-title {
  flex: 1;
  min-width: 0;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  font-weight: 600;
}
.status-critical {
  color: var(--critical);
}
.status-warning {
  color: var(--warning);
}
.status-ok {
  color: var(--ok);
}
.status-unknown {
  color: var(--text-3);
}
.site-facts {
  margin-top: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 28px;
}
h2 {
  margin-bottom: 6px;
}
ul,
ol {
  margin: 6px 0 0;
  padding-left: 18px;
}
li + li {
  margin-top: 4px;
}
.columns p + p {
  margin-top: 4px;
}
.recommendations {
  margin-top: 28px;
}
.sheet-foot {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
@media (max-width: 720px) {
  .sheet {
    padding: 24px 20px;
  }
  .sheet-head {
    flex-wrap: wrap;
  }
  .columns {
    grid-template-columns: 1fr;
  }
  .toolbar .btn {
    margin-left: 0;
  }
}
@media print {
  .sheet {
    max-width: none;
    padding: 0;
    border: 0;
    box-shadow: none;
  }
}
</style>
