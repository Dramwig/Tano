<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2, Globe, Plug, ShieldAlert } from 'lucide-vue-next';
import type { AssistantProposal } from '@tano/protocol';
import { t } from '../../i18n/i18n';

const props = defineProps<{ proposal: AssistantProposal; busy?: boolean }>();

interface StructuredEntry {
  key: string;
  value: string;
  complex: boolean;
}

function parseEntries(raw: string): { entries: StructuredEntry[]; rawFallback?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { entries: [] };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
        if (value === null) return { key, value: 'null', complex: false };
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return { key, value: String(value), complex: false };
        }
        return { key, value: JSON.stringify(value, null, 2), complex: true };
      });
      return { entries };
    }
    return { entries: [], rawFallback: JSON.stringify(parsed, null, 2) };
  } catch {
    return { entries: [], rawFallback: raw };
  }
}

const action = computed(() => props.proposal.pluginAction);
const isExternal = computed(() => action.value?.effect === 'external');
const parsedParams = computed(() => parseEntries(props.proposal.content));
const parsedReceipt = computed(() =>
  props.proposal.status === 'applied' && props.proposal.applied?.after !== undefined
    ? parseEntries(props.proposal.applied.after)
    : null,
);
</script>

<template>
  <div class="plugin-tool-card" :class="{ 'plugin-tool-external': isExternal }">
    <div class="plugin-tool-header">
      <span class="plugin-tool-identity">
        <Plug :size="13" />
        <strong>{{ action?.pluginName ?? proposal.path }}</strong>
        <span v-if="action" class="plugin-tool-name">{{ action.label ?? action.toolName }}</span>
      </span>
      <span class="plugin-effect-badge" :class="isExternal ? 'effect-external' : 'effect-write'">
        <Globe v-if="isExternal" :size="11" />
        <ShieldAlert v-else :size="11" />
        {{ isExternal ? t('外部调用 · 需确认') : t('写入操作 · 需确认') }}
      </span>
    </div>

    <p class="plugin-tool-hint">
      {{
        isExternal
          ? t('此操作将由插件发起外部调用，请确认参数后执行。')
          : t('此操作将由插件执行写入，请确认参数后执行。')
      }}
    </p>

    <div class="plugin-tool-section">
      <div class="plugin-tool-section-label">{{ t('调用参数') }}</div>
      <dl v-if="parsedParams.entries.length" class="plugin-tool-kv">
        <template v-for="entry in parsedParams.entries" :key="entry.key">
          <dt>{{ entry.key }}</dt>
          <dd>
            <pre v-if="entry.complex" class="plugin-tool-code"><code>{{ entry.value }}</code></pre>
            <span v-else>{{ entry.value }}</span>
          </dd>
        </template>
      </dl>
      <pre v-else-if="parsedParams.rawFallback" class="plugin-tool-code"><code>{{ parsedParams.rawFallback }}</code></pre>
      <p v-else class="plugin-tool-empty">{{ t('无额外参数') }}</p>
    </div>

    <div v-if="parsedReceipt" class="plugin-tool-receipt" role="status">
      <div class="plugin-tool-receipt-heading">
        <CheckCircle2 :size="13" />
        <span>{{ t('真实执行回执') }}</span>
      </div>
      <dl v-if="parsedReceipt.entries.length" class="plugin-tool-kv">
        <template v-for="entry in parsedReceipt.entries" :key="`receipt-${entry.key}`">
          <dt>{{ entry.key }}</dt>
          <dd>
            <pre v-if="entry.complex" class="plugin-tool-code"><code>{{ entry.value }}</code></pre>
            <span v-else>{{ entry.value }}</span>
          </dd>
        </template>
      </dl>
      <pre v-else-if="parsedReceipt.rawFallback" class="plugin-tool-code"><code>{{ parsedReceipt.rawFallback }}</code></pre>
      <p v-else class="plugin-tool-empty">{{ t('已执行，无返回数据') }}</p>
      <details v-if="proposal.applied?.after" class="plugin-tool-raw">
        <summary>{{ t('查看完整 JSON 回执') }}</summary>
        <pre class="plugin-tool-code"><code>{{ proposal.applied.after }}</code></pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.plugin-tool-card {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  font-size: 12px;
  display: grid;
  gap: 8px;
}
.plugin-tool-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.plugin-tool-identity {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--text);
}
.plugin-tool-identity svg {
  flex-shrink: 0;
  color: var(--muted);
}
.plugin-tool-name {
  color: var(--text-secondary);
}
.plugin-effect-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.effect-write {
  background: var(--accent);
  color: var(--text-secondary);
}
.effect-external {
  background: color-mix(in srgb, var(--warning, #b97a16) 16%, var(--paper));
  color: var(--warning, #9a620b);
}
.plugin-tool-hint {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}
.plugin-tool-section {
  display: grid;
  gap: 6px;
}
.plugin-tool-section-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}
.plugin-tool-kv {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 5px 10px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface);
}
.plugin-tool-kv dt {
  color: var(--muted);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  word-break: break-word;
}
.plugin-tool-kv dd {
  margin: 0;
  min-width: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}
.plugin-tool-code {
  margin: 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--surface);
  font-size: 11px;
  line-height: 1.45;
  overflow: auto;
  max-height: 180px;
}
.plugin-tool-kv .plugin-tool-code {
  background: var(--paper);
}
.plugin-tool-empty {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}
.plugin-tool-receipt {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.plugin-tool-receipt-heading {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--green);
  font-size: 11px;
  font-weight: 500;
}
.plugin-tool-raw summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 11px;
  user-select: none;
}
.plugin-tool-raw .plugin-tool-code {
  margin-top: 6px;
}
</style>
