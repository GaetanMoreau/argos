<script setup lang="ts">
const props = defineProps<{ severity: string; kev?: boolean }>();

const tone = computed(() =>
  props.severity === 'critical' || props.severity === 'high'
    ? 'tag-critical'
    : props.severity === 'medium'
      ? 'tag-warning'
      : props.severity === 'low'
        ? ''
        : 'tag-unknown', // inconnue ≠ faible : jamais présentée comme rassurante
);
</script>

<template>
  <span class="wrap">
    <span v-if="kev" class="tag tag-kev" title="Activement exploitée (catalogue CISA KEV)">Exploitée</span>
    <span class="tag" :class="tone">{{ SEVERITY_LABELS[severity] ?? severity }}</span>
  </span>
</template>

<style scoped>
.wrap {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
