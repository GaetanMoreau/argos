<script setup lang="ts">
const props = defineProps<{ score: number | null | undefined; large?: boolean }>();

// Seuils de PageSpeed Insights : 90 et plus bon, 50 à 89 à améliorer, moins de 50 mauvais.
const tone = computed(() =>
  props.score == null ? '' : props.score >= 90 ? 'tag-ok' : props.score >= 50 ? 'tag-warning' : 'tag-critical',
);
</script>

<template>
  <span v-if="score != null" class="tag score" :class="[tone, { large }]">{{ score }}</span>
  <span v-else class="subtle">—</span>
</template>

<style scoped>
.score {
  justify-content: center;
  min-width: 30px;
  font-weight: 650;
}
.large {
  height: 28px;
  min-width: 44px;
  font-size: 16px;
}
</style>
