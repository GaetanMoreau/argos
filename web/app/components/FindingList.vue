<script setup lang="ts">
import { ArrowRight, ExternalLink } from 'lucide-vue-next';
import type { listFindings } from '../../../src/core/queries.ts';
import { compareVersions } from '../../../src/core/version.ts';

type FindingItem = ReturnType<typeof listFindings>[number];

const props = defineProps<{
  findings: FindingItem[];
  /** Regroupe par composant (fiche site) ; sinon liste à plat avec le nom du site. */
  grouped?: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();

const COLLAPSED = 4;
const expanded = ref(new Set<string>());

const groups = computed(() => {
  if (!props.grouped) return [{ key: 'all', items: props.findings, head: null }];
  const map = new Map<string, FindingItem[]>();
  for (const f of props.findings) {
    const key = `${f.ecosystem}|${f.component}`;
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    items,
    head: {
      component: items[0].component,
      version: items[0].version,
      ecosystem: items[0].ecosystem,
      isDev: items[0].isDev,
      target: highestVersion(items.map((i) => i.fixedIn)),
    },
  }));
});

function highestVersion(versions: (string | null)[]): string | null {
  return versions.filter((v): v is string => Boolean(v)).sort(compareVersions).at(-1) ?? null;
}

// Seuls les groupes d'un même composant se replient ; la liste globale reste complète.
const collapsible = (items: FindingItem[]) => props.grouped && items.length > COLLAPSED;
const visible = (key: string, items: FindingItem[]) =>
  collapsible(items) && !expanded.value.has(key) ? items.slice(0, COLLAPSED) : items;

function expand(key: string) {
  expanded.value = new Set([...expanded.value, key]);
}

// Certaines sources livrent une description complète en guise de titre : deux lignes, puis clic pour tout lire.
const fullText = ref(new Set<number>());
function showFull(id: number) {
  fullText.value = new Set([...fullText.value, id]);
}

const editing = ref<number | null>(null);
const note = ref('');
const saving = ref(false);
const failure = ref<string | null>(null);

function startIgnore(id: number) {
  editing.value = id;
  note.value = '';
  failure.value = null;
  nextTick(() => document.getElementById(`note-${id}`)?.focus());
}

async function update(id: number, status: 'open' | 'ignored') {
  saving.value = true;
  failure.value = null;
  try {
    await $fetch(`/api/findings/${id}`, { method: 'PATCH', body: { status, note: note.value } });
    editing.value = null;
    emit('changed');
  } catch (err: any) {
    failure.value = err?.data?.statusMessage ?? 'Impossible d’enregistrer';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="list">
    <div v-for="group in groups" :key="group.key" class="group">
      <div v-if="group.head" class="group-head">
        <div class="component">
          <span class="name">{{ group.head.component }}</span>
          <span class="mono subtle">{{ group.head.version }}</span>
          <span class="tag">{{ ECOSYSTEM_LABELS[group.head.ecosystem] ?? group.head.ecosystem }}</span>
          <span v-if="group.head.isDev" class="tag">dev</span>
        </div>
        <div v-if="group.head.target" class="target small">
          Mettre à jour <ArrowRight :size="13" aria-hidden="true" />
          <span class="mono">{{ group.head.target }}</span>
        </div>
      </div>

      <ul class="items">
        <li v-for="f in visible(group.key, group.items)" :key="f.id" class="item" :class="{ dim: f.status !== 'open' }">
          <div class="row">
            <SeverityTag :severity="f.severity" :kev="f.isKev" class="sev" />
            <div class="body">
              <div v-if="!grouped" class="where small">
                <NuxtLink :to="`/sites/${f.siteId}`" class="site">{{ f.siteName }}</NuxtLink>
                <span class="subtle">·</span>
                <span class="mono">{{ f.component }}@{{ f.version }}</span>
                <span v-if="f.isDev" class="tag">dev</span>
                <template v-if="f.fixedIn">
                  <ArrowRight :size="12" class="subtle" aria-hidden="true" />
                  <span class="mono">{{ f.fixedIn }}</span>
                </template>
              </div>
              <p
                class="summary"
                :class="{ clamped: !fullText.has(f.id) }"
                :title="fullText.has(f.id) ? undefined : 'Cliquer pour lire en entier'"
                @click="showFull(f.id)"
              >
                {{ f.summary ?? f.vulnId }}
              </p>
              <div class="meta small subtle">
                <a v-if="f.url" :href="f.url" target="_blank" rel="noopener" class="link mono">
                  {{ f.vulnId }} <ExternalLink :size="11" aria-hidden="true" />
                </a>
                <span v-else class="mono">{{ f.vulnId }}</span>
                <span v-if="grouped && f.fixedIn">corrigé en <span class="mono">{{ f.fixedIn }}</span></span>
                <span>vu {{ fromNow(f.firstSeenAt) }}</span>
                <span v-if="f.status === 'fixed'" class="ok-text">corrigé</span>
              </div>
              <p v-if="f.status === 'ignored' && f.note" class="note small">Ignorée : {{ f.note }}</p>

              <form v-if="editing === f.id" class="ignore-form" @submit.prevent="update(f.id, 'ignored')">
                <label :for="`note-${f.id}`" class="small muted">Pourquoi ignorer cette faille ?</label>
                <div class="ignore-row">
                  <input
                    :id="`note-${f.id}`"
                    v-model="note"
                    class="input"
                    placeholder="ex. fonctionnalité non utilisée sur ce site"
                    required
                  />
                  <button class="btn btn-primary btn-sm" type="submit" :disabled="saving || !note.trim()">Ignorer</button>
                  <button class="btn btn-ghost btn-sm" type="button" @click="editing = null">Annuler</button>
                </div>
                <p v-if="failure" class="critical-text small" role="alert">{{ failure }}</p>
              </form>
            </div>
            <div class="action">
              <button
                v-if="f.status === 'open' && editing !== f.id"
                class="btn btn-ghost btn-sm"
                @click="startIgnore(f.id)"
              >
                Ignorer
              </button>
              <button
                v-else-if="f.status === 'ignored'"
                class="btn btn-ghost btn-sm"
                :disabled="saving"
                @click="update(f.id, 'open')"
              >
                Réactiver
              </button>
            </div>
          </div>
        </li>
      </ul>

      <button
        v-if="collapsible(group.items) && !expanded.has(group.key)"
        class="more link small"
        @click="expand(group.key)"
      >
        Voir les {{ group.items.length - COLLAPSED }} autres
      </button>
    </div>
  </div>
</template>

<style scoped>
.group + .group {
  border-top: 1px solid var(--border);
}
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 20px 4px;
}
.component {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.component .name {
  font-weight: 600;
}
.target {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-weight: 550;
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  padding: 12px 20px;
}
.group-head + .items .item:first-child {
  padding-top: 8px;
}
.item + .item {
  border-top: 1px dashed var(--border);
}
.item.dim .summary,
.item.dim .sev {
  opacity: 0.6;
}
.row {
  display: grid;
  grid-template-columns: 104px 1fr auto;
  gap: 12px;
  align-items: start;
}
.body {
  min-width: 0;
}
.where {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.site {
  font-weight: 600;
}
.site:hover {
  color: var(--accent);
}
.summary {
  overflow-wrap: anywhere;
}
.summary.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  cursor: pointer;
}
.meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.meta a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.note {
  margin-top: 6px;
  color: var(--text-2);
  font-style: italic;
}
.ignore-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.ignore-row {
  display: flex;
  gap: 6px;
}
.ignore-row .input {
  flex: 1;
  min-width: 0;
}
.more {
  margin: 0 20px 14px calc(20px + 104px + 12px);
  font-weight: 500;
}
@media (max-width: 720px) {
  .row {
    grid-template-columns: 1fr auto;
  }
  .sev {
    grid-column: 1 / -1;
  }
  .summary.clamped {
    -webkit-line-clamp: 4;
  }
  .more {
    margin-left: 20px;
  }
}
</style>
