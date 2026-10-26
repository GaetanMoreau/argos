<script setup lang="ts">
import { AlertTriangle, Check, ExternalLink, X } from 'lucide-vue-next';
import type { HttpReport } from '../../../src/core/web/check.ts';

const props = defineProps<{
  siteId: number;
  url: string | null;
  report: HttpReport | null;
  /** Versions de la copie locale par techno (wordpress, nuxt, kirby). */
  localVersions: Record<string, string>;
}>();
const emit = defineEmits<{ changed: [] }>();

const { running, run } = useScan();

// Site sans URL : saisie en place, puis vérification immédiate.
const urlInput = ref('');
const saving = ref(false);
const failure = ref<string | null>(null);
async function saveUrl() {
  saving.value = true;
  failure.value = null;
  try {
    await $fetch(`/api/sites/${props.siteId}`, { method: 'PATCH', body: { url: urlInput.value } });
    await run(props.siteId);
    emit('changed');
  } catch (err: any) {
    failure.value = err?.data?.statusMessage ?? 'Impossible d’enregistrer l’URL';
  } finally {
    saving.value = false;
  }
}

const daysLeft = computed(() => daysUntil(props.report?.cert?.validTo));
const certTone = computed(() => {
  const c = props.report?.cert;
  if (!c) return '';
  if (!c.trusted || (daysLeft.value ?? 0) <= 7) return 'critical';
  return (daysLeft.value ?? 0) <= 30 ? 'warning' : 'ok';
});
const tech = computed(() => props.report?.tech ?? null);
const pathOf = (url: string) => new URL(url).pathname;
const exposed = computed(() => props.report?.exposures?.filter((e) => e.status === 'exposed') ?? []);
const domainDays = computed(() => daysUntil(props.report?.domain?.expiresAt));
const domainTone = computed(() =>
  domainDays.value == null ? '' : domainDays.value <= 7 ? 'critical-text' : domainDays.value <= 30 ? 'warning-text' : 'ok-text',
);
const localVersion = computed(() => (tech.value ? (props.localVersions[tech.value.name.toLowerCase()] ?? null) : null));
const versionMismatch = computed(
  () => tech.value?.version && localVersion.value && tech.value.version !== localVersion.value,
);
const securityHeadersUrl = computed(() =>
  props.url ? `https://securityheaders.com/?q=${encodeURIComponent(props.url)}&followRedirects=on` : null,
);
</script>

<template>
  <div v-if="!url" class="panel notice">
    <h2>Pas d’URL pour ce site</h2>
    <p class="muted">Indiquez l’adresse du site en production : Argos vérifiera HTTPS, le certificat et les en-têtes de sécurité à chaque scan.</p>
    <form class="url-form" @submit.prevent="saveUrl">
      <input v-model="urlInput" class="input" placeholder="mon-site.fr" inputmode="url" aria-label="URL du site" required />
      <button class="btn btn-primary" type="submit" :disabled="saving || running || !urlInput.trim()">
        {{ saving || running ? 'Vérification…' : 'Enregistrer et vérifier' }}
      </button>
    </form>
    <p v-if="failure" class="critical-text small" role="alert">{{ failure }}</p>
  </div>

  <div v-else-if="!report" class="panel notice">
    <h2>Pas encore vérifié</h2>
    <p class="muted">Le prochain scan de ce site vérifiera {{ displayUrl(url) }}.</p>
  </div>

  <template v-else>
    <div v-if="report.error" class="panel notice">
      <h2>{{ report.cert ? 'Certificat refusé' : 'Site injoignable lors du dernier scan' }}</h2>
      <p class="muted">{{ report.error }}</p>
    </div>

    <dl v-if="report.finalUrl" class="panel facts">
      <div>
        <dt>Note des en-têtes</dt>
        <dd><GradeTag :grade="report.grade" large /></dd>
      </div>
      <div>
        <dt>HTTPS</dt>
        <dd>
          <span v-if="!report.https" class="critical-text">Non servi en HTTPS</span>
          <span v-else-if="report.httpsRedirect === false" class="warning-text">http:// ne redirige pas</span>
          <span v-else-if="report.httpsRedirect == null" class="muted">Actif (redirection non vérifiée)</span>
          <span v-else class="ok-text">Actif, http:// redirigé</span>
        </dd>
      </div>
      <div>
        <dt>Certificat</dt>
        <dd v-if="report.cert" :class="`${certTone}-text`">
          <template v-if="(daysLeft ?? 0) < 0">Expiré</template>
          <template v-else-if="!report.cert.trusted">Refusé par les navigateurs</template>
          <template v-else>Expire dans {{ plural(daysLeft ?? 0, 'jour', 'jours') }}</template>
          <div class="subtle small">
            {{ formatDay(report.cert.validTo) }}
            <template v-if="report.cert.issuer"> · {{ report.cert.issuer }}</template>
          </div>
        </dd>
        <dd v-else class="subtle">—</dd>
      </div>
      <div>
        <dt>En production</dt>
        <dd v-if="tech" :title="`Détecté via : ${tech.evidence}`">
          {{ tech.name }} <span v-if="tech.version" class="mono">{{ tech.version }}</span>
          <div v-if="versionMismatch" class="warning-text small">copie locale : <span class="mono">{{ localVersion }}</span></div>
          <div v-else-if="tech.version && localVersion" class="subtle small">identique à la copie locale</div>
          <div v-else-if="!tech.version" class="subtle small">
            version non exposée<template v-if="localVersion">
              · <span class="nowrap">copie locale : <span class="mono">{{ localVersion }}</span></span></template>
          </div>
        </dd>
        <dd v-else class="subtle">Techno non détectée</dd>
      </div>
    </dl>

    <section v-if="report.exposures" class="block">
      <h3>Fichiers sensibles</h3>
      <p v-if="!exposed.length" class="small muted">
        <Check :size="13" class="ok-text inline-icon" aria-hidden="true" />
        {{ plural(report.exposures.length, 'vérification', 'vérifications') }} : aucun fichier sensible accessible.
        <template v-if="report.exposures.some((e) => e.status === 'unknown')"> Certaines adresses n’ont pas répondu.</template>
      </p>
      <div v-else class="panel">
        <article v-for="e in exposed" :key="e.id" class="exposure">
          <SeverityTag :severity="e.severity" />
          <div>
            <p>{{ e.title }}</p>
            <a :href="e.url" target="_blank" rel="noopener" class="link mono small">{{ e.url }}</a>
          </div>
        </article>
      </div>
      <details class="checked small">
        <summary>Ce qui est vérifié</summary>
        <ul>
          <li v-for="e in report.exposures" :key="e.id">
            <X v-if="e.status === 'exposed'" :size="13" class="critical-text" aria-label="Exposé" />
            <Check v-else-if="e.status === 'ok'" :size="13" class="ok-text" aria-label="Protégé" />
            <span v-else class="subtle" aria-label="Non vérifié">?</span>
            <span class="mono">{{ pathOf(e.url) }}</span>
            <span class="muted">{{ e.title }}</span>
          </li>
        </ul>
      </details>
    </section>

    <section v-if="report.domain" class="block">
      <h3>Nom de domaine et e-mail</h3>
      <dl class="panel facts">
        <div>
          <dt>{{ report.domain.domain }}</dt>
          <dd v-if="report.domain.expiresAt" :class="domainTone">
            {{ domainDays! < 0 ? 'Expiré' : `Expire dans ${plural(domainDays!, 'jour', 'jours')}` }}
            <div class="subtle small">
              {{ formatDay(report.domain.expiresAt) }}
              <template v-if="report.domain.registrar"> · {{ report.domain.registrar }}</template>
            </div>
          </dd>
          <dd v-else class="subtle small">{{ report.domain.error ?? 'Date non publiée par le registre' }}</dd>
        </div>
        <template v-if="report.email && !report.email.error">
          <div>
            <dt>SPF</dt>
            <dd :title="report.email.spf ?? undefined">
              <span v-if="!report.email.spf" :class="report.email.mx ? 'warning-text' : 'muted'">Absent</span>
              <span v-else-if="/\+all\b/.test(report.email.spf)" class="critical-text">Tout le monde autorisé (+all)</span>
              <span v-else class="ok-text">Présent</span>
              <div class="subtle small">{{ report.email.mx ? 'Le domaine reçoit des e-mails' : 'Le domaine ne reçoit pas d’e-mails' }}</div>
            </dd>
          </div>
          <div>
            <dt>DMARC</dt>
            <dd :title="report.email.dmarc?.record">
              <span v-if="!report.email.dmarc" :class="report.email.mx ? 'warning-text' : 'muted'">Absent</span>
              <span v-else :class="report.email.dmarc.policy === 'none' ? 'warning-text' : 'ok-text'">
                p={{ report.email.dmarc.policy ?? '?' }}
              </span>
              <div class="subtle small">
                {{ { reject: 'e-mails usurpés rejetés', quarantine: 'e-mails usurpés en spam', none: 'surveillance seule' }[report.email.dmarc?.policy ?? ''] ?? 'aucune politique' }}
              </div>
            </dd>
          </div>
          <div>
            <dt>DKIM</dt>
            <dd>
              <span v-if="report.email.dkim.length" class="ok-text">Trouvé ({{ report.email.dkim.join(', ') }})</span>
              <span v-else class="muted">Non trouvé</span>
              <div class="subtle small">parmi les sélecteurs courants</div>
            </dd>
          </div>
        </template>
        <div v-else-if="report.email?.error">
          <dt>E-mail</dt>
          <dd class="subtle small">{{ report.email.error }}</dd>
        </div>
      </dl>
    </section>

    <h3 v-if="report.headers" class="block-title">En-têtes de sécurité</h3>
    <div v-if="report.headers" class="panel table-wrap headers">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 36px"><span class="sr-only">État</span></th>
            <th>En-tête</th>
            <th class="hide-sm">Rôle ou problème</th>
            <th class="hide-sm">Valeur</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in report.headers" :key="h.id">
            <td>
              <Check v-if="h.status === 'ok'" :size="15" class="ok-text" aria-label="Présent" />
              <AlertTriangle v-else-if="h.status === 'warn'" :size="15" class="warning-text" aria-label="À améliorer" />
              <X v-else :size="15" class="critical-text" aria-label="Absent" />
            </td>
            <td>
              <span class="mono nowrap">{{ h.name }}</span>
              <p class="show-sm small" :class="h.status === 'ok' ? 'muted' : ''">{{ h.note }}</p>
            </td>
            <td class="hide-sm" :class="h.status === 'ok' ? 'muted' : ''">{{ h.note }}</td>
            <td class="hide-sm mono value" :title="h.value ?? undefined">
              <span v-if="h.value">{{ h.value }}</span>
              <span v-else class="subtle">absent</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="report.leaks?.length" class="panel leaks">
      <h3>Versions exposées</h3>
      <p class="muted small">Ces en-têtes indiquent publiquement la version du serveur ou du langage : mieux vaut les masquer.</p>
      <ul>
        <li v-for="l in report.leaks" :key="l.header" class="mono">{{ l.header }}: {{ l.value }}</li>
      </ul>
    </div>

    <p class="foot small subtle">
      Vérifié {{ fromNow(report.checkedAt) }}<template v-if="report.finalUrl"> sur {{ report.finalUrl }}</template>
      · Les en-têtes manquants n’alertent pas ; HTTPS, certificat, fichiers exposés, domaine et e-mail, si.
      <a v-if="securityHeadersUrl" :href="securityHeadersUrl" target="_blank" rel="noopener" class="link">
        Comparer sur securityheaders.com <ExternalLink :size="11" aria-hidden="true" />
      </a>
    </p>
  </template>
</template>

<style scoped>
.notice + .facts {
  margin-top: 16px;
}
.url-form {
  display: flex;
  gap: 8px;
  max-width: 520px;
  margin-top: 8px;
}
.url-form .input {
  flex: 1 1 auto;
  min-width: 0;
}
.headers,
.leaks {
  margin-top: 16px;
}
.block h3,
.block-title {
  margin-bottom: 10px;
}
.block-title {
  margin-top: 24px;
}
.inline-icon {
  vertical-align: -2px;
}
.exposure {
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: 12px;
  align-items: start;
  padding: 12px 20px;
}
.exposure + .exposure {
  border-top: 1px solid var(--border);
}
.exposure a {
  overflow-wrap: anywhere;
}
.checked {
  margin-top: 10px;
}
.checked summary {
  width: fit-content;
  color: var(--text-2);
  cursor: pointer;
}
.checked ul {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.checked li {
  display: grid;
  grid-template-columns: 16px minmax(0, 220px) 1fr;
  gap: 8px;
  align-items: baseline;
}
.value {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
}
.leaks {
  padding: 16px 20px;
}
.leaks ul {
  margin: 8px 0 0;
  padding-left: 18px;
}
.foot {
  margin-top: 12px;
}
.foot a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 4px;
}
@media (max-width: 720px) {
  .url-form {
    flex-direction: column;
  }
}
.facts {
  margin: 0;
}
.show-sm {
  margin-top: 2px;
}
</style>
