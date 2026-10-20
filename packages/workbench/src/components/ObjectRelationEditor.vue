<script setup lang="ts">
import { computed, ref } from 'vue';
import { acceptsRelationType, referenceKey } from '@tano/protocol';
import type { ReferenceIdentity, WorkspaceRelation } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import { t } from '../i18n';
const props = defineProps<{ identity: ReferenceIdentity; workspaceId: string; disabled?: boolean }>();
const emit = defineEmits<{ open: [identity: ReferenceIdentity] }>();
const store = useWorkspaceStore(); const type = ref('related'); const targetKey = ref(''); const busy = ref(false); const error = ref('');
const definitions = computed(() => store.relationDefinitions.filter(definition => acceptsRelationType(definition.sourceTypes, props.identity.type)));
const definition = computed(() => definitions.value.find(definition => definition.type === type.value));
const targets = computed(() => store.referenceTargets.filter(target => !target.archived && referenceKey(target) !== referenceKey(props.identity) && definition.value && acceptsRelationType(definition.value.targetTypes, target.type)));
const rows = computed(() => store.relations.filter(row => [row.source, row.target].some(endpoint => referenceKey(endpoint) === referenceKey(props.identity))));
const unavailable = computed(() => props.disabled || busy.value || store.workspace?.id !== props.workspaceId);
function other(row: WorkspaceRelation) { return referenceKey(row.source) === referenceKey(props.identity) ? row.target : row.source; }
function name(identity: ReferenceIdentity) { return store.referenceTargets.find(target => referenceKey(target) === referenceKey(identity))?.name ?? `${referenceKey(identity)} (${t('不可用')})`; }
async function change(row?: WorkspaceRelation) {
  if (unavailable.value) return;
  const target = targets.value.find(target => referenceKey(target) === targetKey.value);
  if (!row && !target) return;
  busy.value = true; error.value = '';
  try { if (row) await store.removeRelation(row); else await store.createRelation(type.value, props.identity, target!); targetKey.value = ''; }
  catch (reason) { error.value = String(reason); } finally { busy.value = false; }
}
</script>
<template>
  <section class="object-relations" :aria-label="t('对象关系')">
    <h3>{{ t('对象关系') }}</h3>
    <ul><li v-for="row in rows" :key="row.id"><span>{{ store.relationDefinitions.find(definition => definition.type === row.type)?.label ?? row.type }} {{ referenceKey(row.source) === referenceKey(identity) ? '→' : '←' }}</span><button type="button" @click="emit('open', other(row))">{{ name(other(row)) }}</button><button type="button" :disabled="unavailable" @click="change(row)">{{ t('移除关联') }}</button></li></ul>
    <div><select v-model="type" :disabled="unavailable" :aria-label="t('关系类型')"><option v-for="definition in definitions" :key="definition.type" :value="definition.type">{{ t(definition.label) }}</option></select><select v-model="targetKey" :disabled="unavailable" :aria-label="t('关系目标')"><option value="">{{ t('选择对象') }}</option><option v-for="target in targets" :key="referenceKey(target)" :value="referenceKey(target)">{{ target.name }} · {{ target.type }}</option></select><button type="button" :disabled="unavailable || !targets.some(target => referenceKey(target) === targetKey)" @click="change()">{{ t('添加关联') }}</button></div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.object-relations { border-top: 1px solid var(--line); padding-top: 12px; margin: 16px 0; } h3 { font-size: 14px; } div, li { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } ul { padding: 0; list-style: none; } li { margin-bottom: 8px; } select { max-width: 100%; color: var(--text); background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 6px; } [role=alert] { color: var(--danger, #b33); }
</style>
