<script setup lang="ts">
import { t, uiLocale } from '../i18n';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  Archive,
  Check,
  Clock3,
  FileText,
  History,
  RefreshCw,
  X,
} from 'lucide-vue-next';
import type { Activity } from '../stores/workspace';
import type { Component } from 'vue';

type Page = 'versions' | 'updates';

const props = withDefaults(
  defineProps<{
    localId: string;
    path: string;
    workspaceId: string;
    activities: Activity[];
    historyEnabled?: boolean;
    historyView?: Component;
    initialPage?: Page;
  }>(),
  { historyEnabled: true },
);
const emit = defineEmits<{
  close: [];
  diff: [value: { title: string; before: string; after: string }];
}>();
const page = ref<Page>(props.initialPage ?? 'versions');
const firstNav = ref<HTMLButtonElement>();
const originalFocus = document.activeElement as HTMLElement | null;

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
    ),
  ];
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

onMounted(() => void nextTick(() => firstNav.value?.focus()));
onBeforeUnmount(() => originalFocus?.focus());
</script>

<template>
  <div class="modal-backdrop document-history-backdrop" @mousedown.self="emit('close')">
    <section
      class="document-history-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-history-title"
      @keydown="keydown"
    >
      <aside class="document-history-nav" :aria-label="t('历史记录分类')">
        <div class="document-history-brand">
          <History :size="18" />
          <span id="document-history-title">{{ t('历史记录') }}</span>
        </div>
        <nav>
          <button
            ref="firstNav"
            :class="{ active: page === 'versions' }"
            :aria-current="page === 'versions' ? 'page' : undefined"
            @click="page = 'versions'"
          >
            <Archive :size="17" />
            <span>{{ t('版本历史') }}</span>
            <small>Beta</small>
          </button>
          <button
            :class="{ active: page === 'updates' }"
            :aria-current="page === 'updates' ? 'page' : undefined"
            @click="page = 'updates'"
          >
            <Clock3 :size="17" />
            <span>{{ t('更新历史') }}</span>
          </button>
        </nav>
        <p class="document-history-path" :title="path">{{ path }}</p>
      </aside>

      <main class="document-history-main">
        <button
          class="icon-button document-history-close"
          :aria-label="t('关闭历史记录')"
          @click="emit('close')"
        >
          <X :size="19" />
        </button>

        <template v-if="page === 'versions'">
          <header class="document-history-heading">
            <p>{{ t('文档历史') }}</p>
            <h2>{{ t('版本历史') }} <span>Beta</span></h2>
          </header>
          <div class="document-history-content">
            <component
              :is="historyView"
              v-if="historyView"
              embedded
              :local-id="localId"
              :path="path"
              :workspace-id="workspaceId"
              @close="emit('close')"
            />
            <div v-else class="version-history-unavailable">
              <Archive :size="30" />
              <strong>{{ t('版本历史尚不可用') }}</strong>
              <p>{{ t('当前产品未配置文档版本服务；本地工作区可使用备份与恢复。') }}</p>
            </div>
          </div>
        </template>

        <template v-else>
          <header class="document-history-heading">
            <p>{{ t('当前工作区') }}</p>
            <h2>{{ t('更新历史') }}</h2>
          </header>
          <div class="update-history-content">
            <p class="update-history-note">{{ t('本次打开工作区后的文件更新。') }}</p>
            <div v-if="activities.length" class="update-history-list">
              <article v-for="item in activities" :key="item.id" class="update-history-item">
                <span class="update-history-icon" :class="item.kind">
                  <component
                    :is="
                      item.kind === 'conflict'
                        ? AlertTriangle
                        : item.kind === 'external'
                          ? RefreshCw
                          : item.kind === 'save'
                            ? Check
                            : FileText
                    "
                    :size="15"
                  />
                </span>
                <div>
                  <strong>{{ item.label }}</strong>
                  <p>{{ item.detail }}</p>
                  <button
                    v-if="item.change"
                    class="update-history-diff"
                    @click="emit('diff', { title: item.detail, ...item.change })"
                  >
                    {{ t('查看差异') }}
                  </button>
                  <time :datetime="new Date(item.time).toISOString()">
                    {{ new Date(item.time).toLocaleString(uiLocale) }}
                  </time>
                </div>
              </article>
            </div>
            <div v-else class="update-history-empty">
              <Clock3 :size="28" />
              <strong>{{ t('暂无更新记录') }}</strong>
              <p>{{ t('保存、外部修改和冲突记录会显示在这里。') }}</p>
            </div>
          </div>
        </template>
      </main>
    </section>
  </div>
</template>

<style scoped>
.document-history-backdrop {
  z-index: 80;
  align-items: center;
  padding: 28px;
  overflow: hidden;
  background: #20252b40;
  backdrop-filter: blur(4px);
}
.document-history-dialog {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  width: min(1060px, 100%);
  height: min(760px, calc(100dvh - 56px));
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
  box-shadow:
    0 24px 80px #18212b29,
    0 4px 16px #18212b0d;
}
.document-history-nav {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 30px 14px 18px;
  border-right: 1px solid var(--line);
  background: var(--surface);
}
.document-history-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 10px 24px;
  color: var(--text);
  font-size: 17px;
  font-weight: 650;
}
.document-history-nav nav {
  display: grid;
  gap: 4px;
}
.document-history-nav nav button {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: left;
}
.document-history-nav nav button:hover,
.document-history-nav nav button.active {
  background: var(--hover);
  color: var(--text);
}
.document-history-nav nav button.active {
  box-shadow: inset 2px 0 0 var(--green);
}
.document-history-nav nav small,
.document-history-heading h2 span {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
}
.document-history-path {
  margin: auto 10px 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.document-history-main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 34px 38px 30px;
}
.document-history-close {
  position: absolute;
  top: 22px;
  right: 24px;
}
.document-history-heading {
  flex-shrink: 0;
  padding-right: 40px;
}
.document-history-heading p {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 12px;
}
.document-history-heading h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}
.document-history-content,
.update-history-content {
  flex: 1;
  min-height: 0;
  margin-top: 18px;
}
.update-history-content {
  overflow-y: auto;
  padding-right: 8px;
}
.update-history-note {
  margin: 0 0 22px;
  color: var(--text-secondary);
  font-size: 12px;
}
.update-history-list {
  position: relative;
  display: grid;
  gap: 0;
  max-width: 720px;
}
.update-history-list::before {
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 15px;
  width: 1px;
  background: var(--line);
  content: '';
}
.update-history-item {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 31px minmax(0, 1fr);
  gap: 13px;
  padding: 0 0 24px;
}
.update-history-icon {
  display: grid;
  width: 31px;
  height: 31px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--text-secondary);
}
.update-history-icon.conflict {
  border-color: var(--warning-border);
  background: var(--warning-bg);
  color: var(--warning);
}
.update-history-item strong {
  display: block;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.update-history-item p {
  margin: 5px 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.update-history-item time {
  display: block;
  color: var(--muted);
  font-size: 11px;
}
.update-history-diff {
  margin: 2px 0 7px;
  color: var(--green);
  font-size: 12px;
}
.update-history-diff:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.update-history-empty {
  display: grid;
  min-height: 320px;
  place-items: center;
  align-content: center;
  gap: 9px;
  color: var(--muted);
  text-align: center;
}
.version-history-unavailable {
  display: grid;
  height: 100%;
  min-height: 320px;
  place-items: center;
  align-content: center;
  gap: 9px;
  color: var(--muted);
  text-align: center;
}
.version-history-unavailable strong {
  color: var(--text-secondary);
  font-size: 13px;
}
.version-history-unavailable p {
  max-width: 360px;
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}
.update-history-empty strong {
  color: var(--text-secondary);
  font-size: 13px;
}
.update-history-empty p {
  margin: 0;
  font-size: 12px;
}
@media (max-width: 700px) {
  .document-history-backdrop {
    align-items: stretch;
    padding: 0;
  }
  .document-history-dialog {
    grid-template-columns: 1fr;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .document-history-nav {
    display: block;
    padding: 12px 50px 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .document-history-brand,
  .document-history-path {
    display: none;
  }
  .document-history-nav nav {
    grid-template-columns: 1fr 1fr;
  }
  .document-history-main {
    padding: 24px 16px 18px;
  }
  .document-history-close {
    top: 13px;
    right: 12px;
  }
}
</style>
