<script setup lang="ts">
import { AlertCircle, Check, FolderOpen, FolderSearch } from 'lucide-vue-next';

const emit = defineEmits<{ close: [] }>();

const { data: clients } = await useFetch('/api/clients', { key: 'clients' });
const NEW = '__new';

const path = ref('');
const clientChoice = ref<string>('');
const newClient = ref('');
const name = ref('');
const url = ref('');
const hosting = ref('');
const scanAfter = ref(true);

// Aucun client présélectionné ; sans client existant, on part directement sur la création.
if (!clients.value?.length) clientChoice.value = NEW;

interface Inspection {
  path: string;
  exists: boolean;
  stack: string[];
  registered: boolean;
  suggestions: string[];
}
const inspection = ref<Inspection | null>(null);
const checking = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(path, (value) => {
  clearTimeout(timer);
  if (!value.trim()) return (inspection.value = null);
  checking.value = true;
  timer = setTimeout(async () => {
    try {
      inspection.value = await $fetch('/api/inspect', { query: { path: value } });
    } finally {
      checking.value = false;
    }
  }, 250);
});

// Sélecteur natif macOS ouvert par le serveur local.
const picking = ref(false);
async function pickFolder() {
  picking.value = true;
  failure.value = null;
  try {
    const { path: chosen } = await $fetch('/api/pick-folder', { method: 'POST', body: { from: path.value } });
    if (chosen) path.value = chosen;
  } catch (err: any) {
    failure.value = err?.data?.statusMessage ?? 'Impossible d’ouvrir le sélecteur de dossier';
  } finally {
    picking.value = false;
  }
}

const folderName = computed(() => inspection.value?.path.split('/').filter(Boolean).at(-1) ?? '');
const pathState = computed(() => {
  const i = inspection.value;
  if (!i || checking.value) return null;
  // Chemin en cours de saisie : on oriente au lieu d'alarmer.
  if (!i.exists && i.suggestions.length) {
    return { tone: 'neutral', text: plural(i.suggestions.length, 'dossier correspond', 'dossiers correspondent') };
  }
  if (!i.exists) return { tone: 'critical', text: 'Dossier introuvable' };
  if (i.registered) return { tone: 'critical', text: 'Ce dossier est déjà suivi' };
  if (!i.stack.length) {
    return { tone: 'warning', text: 'Aucune stack reconnue : Argos lit les projets Nuxt, Kirby et WordPress' };
  }
  return { tone: 'ok', text: `${i.stack.map((s) => STACK_LABELS[s] ?? s).join(' + ')} détecté` };
});

const canSubmit = computed(
  () =>
    inspection.value?.exists &&
    !inspection.value.registered &&
    !checking.value &&
    clientChoice.value &&
    (clientChoice.value !== NEW || newClient.value.trim()),
);

const saving = ref(false);
const failure = ref<string | null>(null);
const { run } = useScan();

async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  failure.value = null;
  try {
    const site = await $fetch('/api/sites', {
      method: 'POST',
      body: {
        path: path.value,
        clientId: clientChoice.value === NEW ? undefined : Number(clientChoice.value),
        newClient: clientChoice.value === NEW ? newClient.value : undefined,
        name: name.value,
        url: url.value,
        hosting: hosting.value,
      },
    });
    await refreshNuxtData(['clients']);
    emit('close');
    await navigateTo(`/sites/${site.id}`);
    if (scanAfter.value) await run(site.id);
  } catch (err: any) {
    failure.value = err?.data?.statusMessage ?? 'Impossible d’ajouter ce site';
  } finally {
    saving.value = false;
  }
}

onMounted(() => document.getElementById('site-path')?.focus());
</script>

<template>
  <form class="panel form" @submit.prevent="submit" @keydown.esc="emit('close')">
    <h2>Ajouter un site</h2>

    <div class="field full">
      <label for="site-path">Dossier du projet</label>
      <div class="path-row">
        <input
          id="site-path"
          v-model="path"
          class="input mono"
          list="path-suggestions"
          placeholder="~/Documents/Clients/mon-site"
          autocomplete="off"
          spellcheck="false"
          required
        />
        <button type="button" class="btn" :disabled="picking" @click="pickFolder">
          <FolderOpen :size="14" aria-hidden="true" />
          {{ picking ? 'Fenêtre ouverte…' : 'Parcourir…' }}
        </button>
      </div>
      <datalist id="path-suggestions">
        <option v-for="s in inspection?.suggestions ?? []" :key="s" :value="s" />
      </datalist>
      <p v-if="checking" class="hint subtle"><FolderSearch :size="13" aria-hidden="true" /> Vérification…</p>
      <p v-else-if="pathState" class="hint" :class="pathState.tone" role="status">
        <Check v-if="pathState.tone === 'ok'" :size="13" aria-hidden="true" />
        <FolderSearch v-else-if="pathState.tone === 'neutral'" :size="13" aria-hidden="true" />
        <AlertCircle v-else :size="13" aria-hidden="true" />
        {{ pathState.text }}
      </p>
      <p v-else class="hint subtle">La copie locale du site : Argos y lit les versions installées.</p>
    </div>

    <div class="field">
      <label for="site-client">Client</label>
      <select id="site-client" v-model="clientChoice" class="select" :class="{ placeholder: !clientChoice }" required>
        <option value="" disabled>Choisir un client…</option>
        <option v-for="c in clients ?? []" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
        <option :value="NEW">Nouveau client…</option>
      </select>
    </div>
    <div v-if="clientChoice === NEW" class="field">
      <label for="site-new-client">Nom du nouveau client</label>
      <input id="site-new-client" v-model="newClient" class="input" placeholder="ex. Atelier Dumas" required />
    </div>

    <div class="field">
      <label for="site-name">Nom du site <span class="subtle">(facultatif)</span></label>
      <input id="site-name" v-model="name" class="input" :placeholder="folderName || 'nom du dossier'" />
    </div>
    <div class="field">
      <label for="site-url">URL en production <span class="subtle">(facultatif)</span></label>
      <input id="site-url" v-model="url" class="input" type="text" inputmode="url" placeholder="mon-site.fr" />
    </div>
    <div class="field">
      <label for="site-hosting">Hébergement <span class="subtle">(facultatif)</span></label>
      <input id="site-hosting" v-model="hosting" class="input" placeholder="ex. o2switch, Vercel" />
    </div>

    <div class="footer full">
      <label class="check small muted">
        <input v-model="scanAfter" type="checkbox" />
        Scanner le site juste après l’ajout
      </label>
      <p v-if="failure" class="critical-text small" role="alert">{{ failure }}</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost" @click="emit('close')">Annuler</button>
        <button type="submit" class="btn btn-primary" :disabled="!canSubmit || saving">
          {{ saving ? 'Ajout…' : 'Ajouter le site' }}
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  margin-top: 20px;
  padding: 20px;
}
.form h2,
.full {
  grid-column: 1 / -1;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.field label {
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 500;
}
.field .input,
.field .select {
  width: 100%;
}
.path-row {
  display: flex;
  gap: 8px;
}
.path-row .input {
  flex: 1;
  min-width: 0;
}
.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.hint.ok {
  color: var(--ok);
}
.select.placeholder {
  color: var(--text-3);
}
.select option {
  color: var(--text);
}
.hint.neutral {
  color: var(--text-3);
}
/* Flèche native de la datalist : les suggestions apparaissent à la saisie. */
#site-path::-webkit-calendar-picker-indicator {
  display: none !important;
}
.hint.warning {
  color: var(--warning);
}
.hint.critical {
  color: var(--critical);
}
.footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
@media (max-width: 720px) {
  .form {
    grid-template-columns: 1fr;
  }
  .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
