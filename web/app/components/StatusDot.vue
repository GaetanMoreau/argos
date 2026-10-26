<script setup lang="ts">
defineProps<{ status: 'critical' | 'warning' | 'ok' | 'unknown' }>();

const LABELS = {
  critical: 'Action urgente',
  warning: 'À surveiller',
  ok: 'À jour',
  unknown: 'Non scanné',
};
</script>

<template>
  <span class="dot" :class="status" :title="LABELS[status]" role="img" :aria-label="LABELS[status]" />
</template>

<style scoped>
.dot {
  display: inline-block;
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.critical {
  background: var(--critical);
  box-shadow: 0 0 0 3px var(--critical-soft);
}
.warning {
  background: var(--warning-dot);
  box-shadow: 0 0 0 3px var(--warning-soft);
}
.ok {
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft);
}
.unknown {
  background: transparent;
  border: 1.5px solid var(--unknown);
}
</style>
