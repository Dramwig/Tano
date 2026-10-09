<script setup lang="ts">
import type { PluginViewNode } from '@tano/protocol';
defineProps<{ node: PluginViewNode; values: Record<string, string>; disabled: boolean }>();
const emit = defineEmits<{ action: [id: string]; input: [key: string, value: string] }>();
</script>

<template>
  <div v-if="node.type === 'stack'" class="plugin-view-stack">
    <PluginViewNode v-for="(child, index) in node.children" :key="index" :node="child" :values="values" :disabled="disabled"
      @action="emit('action', $event)" @input="(key, value) => emit('input', key, value)" />
  </div>
  <h3 v-else-if="node.type === 'heading'">{{ node.text }}</h3>
  <p v-else-if="node.type === 'text'" class="plugin-view-text">{{ node.text }}</p>
  <pre v-else-if="node.type === 'code'">{{ node.text }}</pre>
  <button v-else-if="node.type === 'button'" :disabled="disabled" @click="emit('action', node.action)">{{ node.label }}</button>
  <label v-else-if="node.type === 'input'">{{ node.label }}<input :value="values[node.key] ?? node.value" :disabled="disabled" maxlength="4000" @input="emit('input', node.key, ($event.target as HTMLInputElement).value)" /></label>
  <div v-else-if="node.type === 'table'" class="plugin-view-table"><table><thead><tr><th v-for="(column, index) in node.columns" :key="index">{{ column }}</th></tr></thead>
    <tbody><tr v-for="(row, index) in node.rows" :key="index"><td v-for="(cell, col) in row" :key="col">{{ cell }}</td></tr></tbody></table></div>
</template>

<style scoped>
.plugin-view-stack { display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.plugin-view-text, pre { white-space: pre-wrap; overflow-wrap: anywhere; }
button { text-align: left; padding: 9px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font: inherit; }
label { display: grid; gap: 6px; }
input { padding: 8px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--paper); font: inherit; }
.plugin-view-table { overflow: auto; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 8px; border: 1px solid var(--line); text-align: left; }
</style>
