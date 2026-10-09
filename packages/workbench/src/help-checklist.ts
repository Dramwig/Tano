import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ReferenceTarget, WorkspaceObject } from '@tano/protocol';
import { referenceKey } from '@tano/protocol';
import { contentReferences } from './content-references';
import { helpChecklist, selectHelpLesson, type HelpAvailability, type HelpChecklistId, type HelpContext, type HelpLessonCursor } from './help-content';
import { markdownMilestones, newMarkdownMilestones, planMilestones } from './help-milestones';

// Automatic milestones do not inherit the old manually checked v1 progress.
export const helpChecklistKey = 'tano.preference.helpChecklist.v2';
export const helpLessonKey = 'tano.preference.helpLesson.v1';
// Source/reading modes are part of the same document activity, not a new course.
const lessonScope = (context: HelpContext) => ['plan', 'plugins', 'graph'].includes(context) ? context : 'document';
const sessionLessons = new Map<string, HelpLessonCursor>();

export function resumeHelpLesson(completed: readonly HelpChecklistId[], context: HelpContext, availability: HelpAvailability = {}) {
  const key = `${helpLessonKey}.${lessonScope(context)}`;
  let current: HelpLessonCursor | undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) current = sessionLessons.get(key);
    const value: unknown = JSON.parse(raw ?? 'null');
    if (value && typeof value === 'object' && 'stage' in value && 'first' in value &&
        helpChecklist.some(step => step.stage === value.stage && step.id === value.first)) current = value as HelpLessonCursor;
  } catch { current = sessionLessons.get(key); }
  const lesson = selectHelpLesson(completed, context, availability, current);
  if (lesson) {
    try {
      const encoded = JSON.stringify(lesson.cursor);
      if (localStorage.getItem(key) !== encoded) localStorage.setItem(key, encoded);
      sessionLessons.delete(key);
    } catch { sessionLessons.set(key, lesson.cursor); }
  }
  return lesson;
}
const changedEvent = 'tano:help-checklist-completed';
const storageKey = (id: HelpChecklistId) => helpChecklistKey + '.' + id;
export function readHelpCompleted(): HelpChecklistId[] {
  try { return helpChecklist.filter(item => localStorage.getItem(storageKey(item.id)) === '1').map(item => item.id); }
  catch { return []; }
}

// One monotonic marker per step avoids losing another window's completion.
// Nothing about document contents or workspace paths is stored here.
export function recordHelpCompleted(...ids: HelpChecklistId[]) {
  if (typeof window === 'undefined') return;
  const saved = readHelpCompleted();
  const fresh = ids.filter(id => !saved.includes(id));
  if (!fresh.length) return;
  for (const id of fresh) {
    try { localStorage.setItem(storageKey(id), '1'); }
    catch { /* Mounted launchers still receive the completion for this session. */ }
  }
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: fresh }));
}

/** Called for an accepted local edit, never for loading or receiving document content. */
export function recordHelpDocumentEdit(id: string, before: string, after: string, targets: readonly ReferenceTarget[]) {
  if (typeof window === 'undefined' || before.trim() === after.trim() || !after.trim()) return;
  recordHelpCompleted('welcome', 'empty-document');
  const completed = readHelpCompleted();
  if (markdownMilestones.some(id => !completed.includes(id))) {
    try { recordHelpCompleted(...newMarkdownMilestones(before, after)); }
    catch { /* An unfinished syntax fragment must never interrupt the editor. */ }
  }
  if (completed.includes('document')) return;
  const source = targets.find(target => target.type === 'document' && target.id === id);
  if (!source) return;
  try {
    const links = (content: string) => contentReferences(targets, new Map([[referenceKey(source), content]]))
      .filter(edge => edge.target.type === 'document' && edge.target.id !== id && !edge.missing && !edge.archived)
      .map(edge => referenceKey(edge.target));
    const previous = new Set(links(before));
    if (links(after).some(key => !previous.has(key))) recordHelpCompleted('document');
  } catch { /* Guidance must never interrupt editing malformed or partial Markdown. */ }
}

export function recordHelpPlanEdit(before: WorkspaceObject | undefined, after: WorkspaceObject) {
  recordHelpCompleted(...planMilestones(before, after));
}

export function useHelpChecklist() {
  const completed = ref(readHelpCompleted());
  const merge = (ids: HelpChecklistId[]) => { completed.value = [...new Set([...completed.value, ...ids])]; };
  function storage(event: StorageEvent) {
    if (event.key === null) completed.value = readHelpCompleted();
    else if (event.key.startsWith(helpChecklistKey + '.')) merge(readHelpCompleted());
  }
  function localChange(event: Event) {
    const ids: unknown = (event as CustomEvent).detail;
    if (Array.isArray(ids)) merge(ids.filter((id): id is HelpChecklistId => helpChecklist.some(item => item.id === id)));
  }
  onMounted(() => {
    window.addEventListener('storage', storage);
    window.addEventListener(changedEvent, localChange);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(changedEvent, localChange);
  });
  return { completed };
}
