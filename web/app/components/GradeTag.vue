<script setup lang="ts">
const props = defineProps<{ grade: string | null | undefined; large?: boolean }>();

const tone = computed(() => {
  if (!props.grade) return '';
  if (props.grade.startsWith('A')) return 'tag-ok';
  if (props.grade === 'B' || props.grade === 'C') return 'tag-warning';
  return 'tag-critical';
});
</script>

<template>
  <span v-if="grade" class="tag grade" :class="[tone, { large }]" :title="`Note des en-têtes de sécurité : ${grade}`">
    {{ grade }}
  </span>
  <span v-else class="subtle">—</span>
</template>

<style scoped>
.grade {
  justify-content: center;
  min-width: 28px;
  font-weight: 650;
}
.large {
  height: 28px;
  min-width: 40px;
  font-size: 16px;
}
</style>
