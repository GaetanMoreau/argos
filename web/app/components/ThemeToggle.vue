<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next';

const { theme, toggle } = useTheme();
const label = computed(() => (theme.value === 'dark' ? 'Thème sombre (passer en clair)' : 'Thème clair (passer en sombre)'));
</script>

<template>
  <button class="btn btn-ghost theme" :title="label" :aria-label="label" @click="toggle">
    <Moon v-if="theme === 'dark'" :size="16" aria-hidden="true" />
    <Sun v-else :size="16" aria-hidden="true" />
  </button>
</template>

<style scoped>
.theme {
  width: 32px;
  padding: 0;
  justify-content: center;
}
</style>
