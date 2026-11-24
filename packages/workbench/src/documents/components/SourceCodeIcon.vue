<script setup lang="ts">
// Tabler Icons source-code (MIT); see ../assets/tabler/LICENSE.
withDefaults(defineProps<{ size?: number | string; off?: boolean }>(), { size: 24, off: false });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M14.5 4h2.5a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5" />
    <path v-if="off" d="m2 10 2.5-7L7 10M3 7h3M12 5v5M12 7.5a1.75 2.5 0 1 0-3.5 0 1.75 2.5 0 1 0 3.5 0" stroke-width="1.5" />
    <path v-else d="m6 5-2 2 2 2M10 9l2-2-2-2" />
  </svg>
</template>
