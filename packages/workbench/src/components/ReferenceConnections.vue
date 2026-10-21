<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t } from '../i18n';
import { onBeforeUnmount, ref, watch } from 'vue';
import { FileText, ListTodo } from 'lucide-vue-next';
import { referenceKey, referenceTypeLabel } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import { contentReferences, referenceContext } from '../content-references';
import type { ReferenceContext } from '../content-references';

const props = withDefaults(defineProps<{ identity: ReferenceIdentity; draft?: string; localTargets?: ReferenceTarget[]; active?: boolean }>(), { active: true });
const emit = defineEmits<{ open: [identity: ReferenceIdentity] }>();
const store = useWorkspaceStore();
const context = ref<ReferenceContext>({ outgoing: [], incoming: [], errors: [] });
const loading = ref(true);
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let owner = '';
watch([() => referenceKey(props.identity), () => props.draft, () => props.localTargets ? JSON.stringify(props.localTargets) : undefined, () => props.active,
  () => store.referenceRevision, () => store.workspace?.id, () => store.workspace?.path], () => {
  const version = ++revision;
  const key = JSON.stringify([props.localTargets ? 'personal' : 'workspace', props.localTargets?.[0]?.workspace ?? store.workspace?.id, store.workspace?.path, props.identity.type, props.identity.id]);
  if (key !== owner) { context.value = { outgoing: [], incoming: [], errors: [] }; owner = key; }
  if (!props.localTargets && store.workspace) {
    const available = new Set(store.referenceTargets.map(referenceKey));
    context.value = { ...context.value,
      incoming: context.value.incoming.filter(edge => available.has(referenceKey(edge.source))),
      outgoing: context.value.outgoing.filter(edge => available.has(referenceKey(edge.source))),
    };
  }
  loading.value = true;
  clearTimeout(timer);
  if (props.active === false) return;
  timer = setTimeout(async () => {
    try {
      let result: ReferenceContext;
      if (props.localTargets) {
        const contents = new Map(props.localTargets.map(target => [referenceKey(target), target.description ?? '']));
        if (props.draft !== undefined) contents.set(referenceKey(props.identity), props.draft);
        result = referenceContext(contentReferences(props.localTargets, contents), props.identity);
      } else result = await store.getReferenceContext(props.identity, props.draft);
      if (revision === version) context.value = result;
    } catch (error) {
      if (revision === version) context.value = { outgoing: [], incoming: [], errors: [String(error)] };
    } finally { if (revision === version) loading.value = false; }
  }, 100);
}, { immediate: true });
onBeforeUnmount(() => { revision++; clearTimeout(timer); });
</script>

<template>
  <section class="reference-connections" :aria-label="t('双向引用')" :aria-busy="loading">
    <div v-for="direction in (['outgoing', 'incoming'] as const)" :key="direction" class="reference-direction">
      <h3>{{ direction === 'outgoing' ? t('引用了什么') : t('被谁引用') }} <small>{{ context[direction].length }}</small></h3>
      <LoadingSkeleton v-if="loading && !context[direction].length" :rows="2" /><p v-else-if="!context[direction].length">{{ t('暂无引用') }}</p>
      <button v-for="edge in context[direction]" :key="referenceKey(direction === 'outgoing' ? edge.target : edge.source)" type="button" :disabled="direction === 'outgoing' && edge.missing" @click="emit('open', direction === 'outgoing' ? edge.target : edge.source)">
        <component :is="(direction === 'outgoing' ? edge.target : edge.source).type === 'document' ? FileText : ListTodo" :size="16" />
        <span><strong>{{ direction === 'outgoing' ? edge.name : edge.source.name }}</strong><small>{{ referenceTypeLabel((direction === 'outgoing' ? edge.target : edge.source).type) }}{{ direction === 'outgoing' && edge.missing ? t(' · 已失效') : (direction === 'outgoing' ? edge.archived : edge.source.archived) ? t(' · 已归档') : '' }}</small><small class="reference-excerpt">{{ edge.excerpt }}</small></span>
      </button>
    </div>
    <p v-for="error in context.errors" :key="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.reference-connections { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 16px; min-width: 0; }
.document-references { max-width: 780px; margin: 32px auto 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 24px; }
.document-references .reference-direction + .reference-direction { margin-top: 0; }
.document-references [role=alert] { grid-column: 1 / -1; }
.reference-direction + .reference-direction { margin-top: 14px; }
h3 { font-size: 13px; font-weight: 600; margin: 0 0 6px; }
h3 small { font-weight: 400; opacity: .65; margin-left: 6px; }
p { font-size: 12px; opacity: .65; margin: 6px 0; overflow-wrap: anywhere; }
button { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; padding: 7px 4px; }
button svg { flex-shrink: 0; margin-top: 2px; }
button span { min-width: 0; overflow-wrap: anywhere; }
strong { font-size: 13px; font-weight: 500; }
button small { display: block; font-size: 11px; opacity: .65; }
.reference-excerpt { max-height: 34px; overflow: hidden; }
@media (max-width: 600px) { .document-references { grid-template-columns: minmax(0, 1fr); gap: 14px; } }
</style>
