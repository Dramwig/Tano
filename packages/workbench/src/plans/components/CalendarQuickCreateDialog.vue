<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { CalendarDays, Check, FolderOpen, ListTodo, X } from 'lucide-vue-next';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { resizeHeight, settleHeight } from '@tano/editor/motion';
import { t } from '../../i18n/i18n';
import { useWindowContext } from '../../windows/context';
import type { PlanScope } from '../../stores/plans';
import type { PlanDateValue } from '../plan-date';
import PlanDateField from './PlanDateField.vue';

export interface QuickCreateDraft {
  name: string;
  checkable: boolean;
  planDate: PlanDateValue;
  scope: PlanScope;
}

const props = defineProps<{
  draft?: QuickCreateDraft;
  saving: boolean;
  error: string;
  defaultDate: string;
  canCreateWorkspace: boolean;
  canCreatePersonal: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const { document } = useWindowContext();
const nameInput = ref<HTMLInputElement>();
const dialog = ref<HTMLElement>();
const sizer = ref<HTMLElement>();
const content = ref<HTMLFormElement>();

// Smooth height changes (e.g. switching 时间安排 adds/removes date rows).
// The form keeps its natural height and is observed; the sizer around it
// animates from whatever height is on screen now, so rapid changes retarget
// mid-flight instead of jumping.
let observer: ResizeObserver | undefined;
let shownHeight = 0;
function observeContent(form: HTMLFormElement | undefined) {
  observer?.disconnect();
  observer = undefined;
  shownHeight = 0;
  const box = sizer.value;
  if (!form || !box || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(() => {
    const next = form.getBoundingClientRect().height;
    if (!shownHeight || Math.abs(next - shownHeight) < 0.5) { shownHeight = next; return; }
    // Layout already has the new height here (before paint). Start from the
    // last shown height, or the in-flight animated height when retargeting.
    const from = box.getAnimations?.().length ? box.getBoundingClientRect().height : shownHeight;
    settleHeight(box);
    shownHeight = next;
    resizeHeight(box, from, next, { kind: 'smooth' });
  });
  observer.observe(form);
}
watch(content, observeContent, { flush: 'post' });
onBeforeUnmount(() => observer?.disconnect());

// aria-modal: keep Tab / Shift+Tab cycling inside the dialog.
function trapTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return;
  const controls = [...dialog.value.querySelectorAll<HTMLElement>(':is(button, input, select):not(:disabled)')];
  const active = document.activeElement;
  if (!controls.length) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && (active === controls[0] || active === dialog.value)) {
    event.preventDefault();
    controls.at(-1)?.focus();
  } else if (!event.shiftKey && active === controls.at(-1)) {
    event.preventDefault();
    controls[0]?.focus();
  }
}
const scopeId = useId();

watch(
  () => props.draft,
  (draft) => {
    if (draft) nameInput.value?.focus();
  },
  { flush: 'post' },
);

// Inputs are disabled while saving; park focus on the dialog so Esc/Tab
// still land inside it, then hand it back to the title (e.g. after an error).
watch(
  () => props.saving,
  async (busy) => {
    await nextTick();
    if (!props.draft) return;
    if (busy) dialog.value?.focus({ preventScroll: true });
    else nameInput.value?.focus({ preventScroll: true });
  },
);

// A plain event needs a date; turning "需要完成" off on an unscheduled task
// falls back to the default day instead of leaving an invalid empty draft.
watch(
  () => props.draft?.checkable,
  (checkable, previous) => {
    const draft = props.draft;
    if (draft && previous === true && checkable === false && !draft.planDate.date)
      draft.planDate.date = props.defaultDate;
  },
);
</script>

<template>
  <Teleport :to="document.body">
    <div
      v-if="draft"
      v-surface-motion="'CalendarView:create'"
      class="calendar-create-backdrop"
      @mousedown.self="emit('close')"
    >
      <section
        ref="dialog"
        class="calendar-create-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('新建事件')"
        :aria-busy="saving"
        tabindex="-1"
        @keydown.esc.stop.prevent="emit('close')"
        @keydown="trapTab"
      >
        <header>
          <h2>{{ t('新建事件') }}</h2>
          <button type="button" class="calendar-create-close" :aria-label="t('关闭')" :disabled="saving" @click="emit('close')">
            <X :size="16" />
          </button>
        </header>
        <div ref="sizer" class="calendar-create-sizer">
        <form ref="content" @submit.prevent="emit('submit')">
          <input
            ref="nameInput"
            v-model="draft.name"
            class="calendar-create-title"
            :aria-label="t('事件名称')"
            :placeholder="t('记下一件事…')"
            autocomplete="off"
            required
            maxlength="200"
            :disabled="saving"
          />
          <div class="calendar-create-properties">
            <div class="calendar-create-row calendar-create-time">
              <span class="calendar-create-label"><CalendarDays :size="15" aria-hidden="true" />{{ t('时间安排') }}</span>
              <PlanDateField
                v-model="draft.planDate"
                :default-date="defaultDate"
                :required="!draft.checkable"
                :disabled="saving"
                compact
              />
            </div>
            <div class="calendar-create-row">
              <span class="calendar-create-label"><ListTodo :size="15" aria-hidden="true" />{{ t('类型') }}</span>
              <label class="calendar-create-checkable">
                <input v-model="draft.checkable" type="checkbox" :disabled="saving" />
                <span class="calendar-create-check" aria-hidden="true"><Check :size="11" :stroke-width="3" /></span>
                <span>{{ t('需要完成') }}</span>
              </label>
            </div>
            <div class="calendar-create-row">
              <label class="calendar-create-label" :for="scopeId"><FolderOpen :size="15" aria-hidden="true" />{{ t('保存到') }}</label>
              <select :id="scopeId" v-model="draft.scope" class="calendar-create-scope" :disabled="saving">
                <option value="workspace" :disabled="!canCreateWorkspace">{{ t('工作区') }}</option>
                <option value="personal" :disabled="!canCreatePersonal">{{ t('个人') }}</option>
              </select>
            </div>
          </div>
          <p v-if="error" class="calendar-create-error" role="alert">{{ error }}</p>
          <footer>
            <button type="button" :disabled="saving" @click="emit('close')">{{ t('取消') }}</button>
            <button type="submit" class="calendar-create-submit" :disabled="saving || !draft.name.trim()">
              {{ saving ? t('保存中…') : t('创建') }}
            </button>
          </footer>
        </form>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* ---- Quick create dialog (teleported: keep its own tokens) ------------------ */
.calendar-create-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: #161a2233;
  backdrop-filter: blur(3px);
}
.calendar-create-dialog {
  --create-label: 92px;
  width: min(520px, 100%);
  padding: 16px 20px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-dialog, 14px);
  background: var(--paper);
  color: var(--text);
  box-shadow: var(--dialog-shadow, 0 16px 48px #0003);
}
.calendar-create-dialog:focus { outline: none; }
.calendar-create-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.calendar-create-dialog h2 { margin: 0; color: var(--text-secondary); font-size: 12px; font-weight: 500; }
.calendar-create-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: -6px;
  border-radius: 7px;
  color: var(--muted);
}
.calendar-create-close:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.calendar-create-title {
  box-sizing: border-box;
  width: calc(100% + 16px);
  margin: 0 -8px 10px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}
.calendar-create-title::placeholder { color: var(--muted); opacity: 0.7; font-weight: 500; }
.calendar-create-title:hover:not(:disabled, :focus) { background: var(--hover); }
.calendar-create-title:focus,
.calendar-create-title:focus-visible { outline: none; background: transparent; }
.calendar-create-properties { display: grid; gap: 4px; padding: 12px 0 4px; border-top: 1px solid var(--line); }
.calendar-create-row { display: grid; grid-template-columns: var(--create-label) minmax(0, 1fr); column-gap: 12px; align-items: start; min-width: 0; }
.calendar-create-label { display: flex; align-items: center; gap: 8px; min-height: 32px; color: var(--muted); font-size: 13px; }
.calendar-create-label svg { flex: none; }
.calendar-create-dialog .calendar-create-scope,
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input) {
  box-sizing: border-box;
  height: 32px;
  min-width: 140px;
  max-width: 100%;
  justify-self: start;
  margin: 0;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background-color: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  transition: background-color var(--motion-quick) var(--ease-standard), border-color var(--motion-base) var(--ease-standard), box-shadow var(--motion-base) var(--ease-standard);
}
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input) { width: auto; }
.calendar-create-dialog .calendar-create-scope {
  appearance: none;
  padding-right: 26px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8985' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
}
.calendar-create-dialog .calendar-create-scope:hover:not(:disabled, :focus),
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input:hover:not(:disabled, :focus)) { border-color: transparent; background-color: var(--hover); }
.calendar-create-dialog .calendar-create-scope:focus-visible,
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input:focus-visible) {
  outline: none;
  border-color: color-mix(in srgb, var(--text) 35%, var(--line));
  background-color: var(--paper);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 7%, transparent);
}
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-heading) { justify-content: flex-start; gap: 2px; min-height: 32px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-schedule-trigger) { gap: 4px; min-height: 32px; padding: 0 6px 0 8px; border-radius: 6px; color: var(--text); font-size: 13px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-schedule-trigger > svg:first-child) { display: none; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-schedule-trigger > svg:last-child) { color: var(--muted); }
.calendar-create-time :deep(.plan-date-field.is-compact .compact-precision) { color: var(--muted); border-radius: 6px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-inputs) { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0 0 4px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-input) { display: grid; gap: 0; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-label) { min-height: 0; padding: 2px 9px 0; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-label label) { font-size: 11px; color: var(--muted); }
.calendar-create-checkable {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 7px;
  min-height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
  transition: background-color var(--motion-quick) var(--ease-standard);
}
.calendar-create-checkable:hover { background: var(--hover); }
/* Monochrome checkbox: native blue tick clashes with the ink palette. */
.calendar-create-checkable { position: relative; }
.calendar-create-checkable input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.calendar-create-check {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 15px;
  height: 15px;
  border: 1.5px solid color-mix(in srgb, var(--text) 32%, transparent);
  border-radius: 4px;
  color: transparent;
  transition: background-color var(--motion-quick) var(--ease-standard), border-color var(--motion-quick) var(--ease-standard), color var(--motion-quick) var(--ease-standard);
}
.calendar-create-checkable:hover .calendar-create-check { border-color: color-mix(in srgb, var(--text) 50%, transparent); }
.calendar-create-checkable input:checked + .calendar-create-check {
  border-color: var(--green-fill);
  background: var(--green-fill);
  color: var(--on-accent, #fff);
}
.calendar-create-checkable input:focus-visible + .calendar-create-check { box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 12%, transparent); }
.calendar-create-checkable input:disabled + .calendar-create-check { opacity: 0.5; }
@media (prefers-reduced-motion: no-preference) {
  .calendar-create-checkable input:checked + .calendar-create-check > svg {
    animation: tano-check-pop var(--motion-bouncy) var(--ease-spring-bouncy);
  }
}
/* The sizer clips only while animating; the extra inline room keeps the
   title's hover bleed and focus rings visible during that time. */
.calendar-create-sizer { margin: 0 -10px; padding: 0 10px; }
.calendar-create-sizer > form { display: flow-root; }
.calendar-create-error { margin: 10px 0 0; color: var(--danger, #c24141); font-size: 12px; }
.calendar-create-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.calendar-create-dialog footer button {
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 13px;
}
.calendar-create-dialog footer button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.calendar-create-dialog footer .calendar-create-submit {
  min-width: 72px;
  border-color: transparent;
  background: var(--green-fill);
  color: var(--on-accent, #fff);
  font-weight: 500;
}
.calendar-create-dialog footer .calendar-create-submit:hover:not(:disabled) { background: var(--green-fill-hover); color: var(--on-accent, #fff); }
.calendar-create-dialog footer .calendar-create-submit:disabled { opacity: 1; background: var(--hover); color: var(--muted); }
@media (max-width: 700px) {
  .calendar-create-row { grid-template-columns: minmax(0, 1fr); }
}
</style>
