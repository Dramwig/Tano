<script setup lang="ts">
import { computed } from 'vue';
import { resolvePluginSettingsWithDefaults, type PluginSettingField } from '@tano/protocol';
import { t } from '../../i18n/i18n';

const props = defineProps<{
  schema: readonly PluginSettingField[];
  modelValue: string;
  disabled?: boolean;
  developerMode?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const parsed = computed<Record<string, unknown>>(() => {
  try {
    const raw = JSON.parse(props.modelValue || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      return resolvePluginSettingsWithDefaults(raw as Record<string, unknown>, props.schema);
  } catch {
    /* Invalid manual JSON stays editable in the advanced textarea. */
  }
  return resolvePluginSettingsWithDefaults({}, props.schema);
});

function updateField(key: string, value: unknown) {
  let base: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(props.modelValue || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) base = { ...(raw as Record<string, unknown>) };
  } catch {
    base = {};
  }
  base[key] = value;
  emit('update:modelValue', JSON.stringify(base, null, 2));
}

function updateNumber(field: PluginSettingField, raw: string) {
  if (!raw.trim()) {
    updateField(field.key, field.default ?? undefined);
    return;
  }
  const num = Number(raw);
  if (Number.isFinite(num)) updateField(field.key, num);
}
</script>
<template>
  <div class="plugin-settings-form">
    <div v-for="field in schema" :key="field.key" class="setting-row">
      <label v-if="field.type === 'boolean'" class="setting-checkbox">
        <input
          type="checkbox"
          :checked="Boolean(parsed[field.key])"
          :disabled="disabled"
          @change="updateField(field.key, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ field.label }}</span>
      </label>
      <label v-else>
        <span>{{ field.label }}<em v-if="field.required"> *</em></span>
        <select
          v-if="field.type === 'select'"
          :value="String(parsed[field.key] ?? field.default ?? '')"
          :disabled="disabled"
          @change="updateField(field.key, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <input
          v-else-if="field.type === 'number'"
          type="number"
          :value="parsed[field.key] ?? ''"
          :min="field.min"
          :max="field.max"
          :required="field.required"
          :disabled="disabled"
          @input="updateNumber(field, ($event.target as HTMLInputElement).value)"
        />
        <input
          v-else
          type="text"
          :value="String(parsed[field.key] ?? '')"
          :required="field.required"
          :disabled="disabled"
          @input="updateField(field.key, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <p v-if="field.description" class="setting-description">{{ field.description }}</p>
    </div>
    <details v-if="developerMode" class="setting-raw">
      <summary>{{ t('高级 JSON 视图') }}</summary>
      <textarea
        :value="modelValue"
        :aria-label="t('插件设置 JSON')"
        :disabled="disabled"
        rows="4"
        spellcheck="false"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
    </details>
  </div>
</template>
<style scoped>
.plugin-settings-form { display: flex; flex-direction: column; gap: 10px; margin: 10px 0; }
.setting-row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text); }
.setting-row .setting-checkbox { flex-direction: row; align-items: center; gap: 8px; }
.setting-row input[type="text"], .setting-row input[type="number"], .setting-row select {
  padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font: inherit;
}
.setting-description { margin: 3px 0 0; font-size: 11px; color: var(--muted); }
.setting-raw summary { cursor: pointer; font-size: 12px; color: var(--muted); margin: 4px 0; }
.setting-raw textarea { width: 100%; box-sizing: border-box; font-family: var(--font-mono, monospace); font-size: 12px; }
</style>
