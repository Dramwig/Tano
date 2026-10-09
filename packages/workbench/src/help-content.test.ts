import { expect, it } from 'vitest';
import { defaultDocumentationBaseUrl, helpChecklist, helpDocumentationUrl, helpTopics, selectHelpLesson, type HelpChecklistId } from './help-content';

it('routes contextual hints to documentation pages without storing a second guide body', () => {
  for (const topic of Object.values(helpTopics)) {
    expect(topic).not.toHaveProperty('steps');
    expect(helpDocumentationUrl('https://tano.page/en-us/docs/', topic.id))
      .toBe(`https://tano.page/en-us/docs/${topic.docsPage}`);
  }
  expect(helpDocumentationUrl(undefined, 'welcome')).toBe(`${defaultDocumentationBaseUrl}/quickstart`);
  expect(helpDocumentationUrl('http://127.0.0.1:43941/zh-cn/docs/?q=old#section', 'source'))
    .toBe('http://127.0.0.1:43941/zh-cn/docs/editor');
});

it('falls back to the public documentation for invalid or executable base URLs', () => {
  for (const base of ['invalid', 'javascript:alert(1)', 'file:///tmp/docs'])
    expect(helpDocumentationUrl(base)).toBe(defaultDocumentationBaseUrl);
});

it('uses prior experience to choose an initial lesson before a lesson has been shown', () => {
  expect(selectHelpLesson([], 'document')?.id).toBe('start');
  const writing: HelpChecklistId[] = ['welcome', 'empty-document'];
  expect(selectHelpLesson(writing, 'document')?.id).toBe('writing');
  writing.push('heading', 'bold', 'bullet-list');
  expect(selectHelpLesson(writing, 'document')?.id).toBe('organize');
  expect(writing).not.toContain('rename-document');
});

it('prioritizes the current activity even before general onboarding is complete', () => {
  expect(selectHelpLesson([], 'plan')?.id).toBe('planning');
  expect(selectHelpLesson([], 'plugins')?.id).toBe('extensions');
  expect(selectHelpLesson([], 'graph')?.id).toBe('organize');
  expect(selectHelpLesson([], 'source')?.id).toBe('reading');
  expect(selectHelpLesson([], 'reading')?.id).toBe('reading');
});

it('recognizes experienced users without marking unperformed basics complete', () => {
  const completed: HelpChecklistId[] = ['welcome', 'empty-document', 'document', 'graph', 'source', 'find', 'plan', 'create-folder'];
  const lesson = selectHelpLesson(completed, 'document');
  expect(lesson?.id).toBe('structure');
  expect(lesson?.done).toBe(0);
  expect(completed).not.toContain('heading');
});

it('omits unavailable operations and keeps each lesson to at most four steps', () => {
  const lesson = selectHelpLesson([], 'reading', { 'document-write': false });
  expect(lesson?.steps.map(step => step.id)).not.toContain('page-replace');
  expect(selectHelpLesson([], 'plan', { plans: false })?.id).not.toBe('planning');
  expect(selectHelpLesson([], 'graph', { duplicate: false })?.steps.map(step => step.id)).not.toContain('duplicate-document');
  const completed: HelpChecklistId[] = ['welcome', 'empty-document', 'heading', 'bold'];
  const writing = selectHelpLesson(completed, 'document')!;
  expect(writing.visible.map(step => step.id)).toEqual(['bold', 'bullet-list', 'ordered-list', 'todo-list']);
  expect(new Set(helpChecklist.map(step => step.id)).size).toBe(helpChecklist.length);
  for (const context of ['document', 'reading', 'source', 'graph', 'plan', 'plugins'] as const) {
    expect(selectHelpLesson([], context)!.visible.length).toBeLessThanOrEqual(4);
    expect(selectHelpLesson(helpChecklist.map(step => step.id), context)!.visible.length).toBeLessThanOrEqual(4);
  }
});

it('rolls upcoming steps into view while retaining the original next step and one completed predecessor', () => {
  const completed: HelpChecklistId[] = ['welcome', 'empty-document'];
  let lesson = selectHelpLesson(completed, 'document')!;
  expect(lesson.visible.map(step => step.id)).toEqual(['heading', 'bold', 'bullet-list', 'ordered-list']);
  const windows = [
    ['heading', ['heading', 'bold', 'bullet-list', 'ordered-list']],
    ['bold', ['bold', 'bullet-list', 'ordered-list', 'todo-list']],
    ['bullet-list', ['bullet-list', 'ordered-list', 'todo-list', 'italic']],
    ['ordered-list', ['ordered-list', 'todo-list', 'italic']],
    ['todo-list', ['todo-list', 'italic']],
  ] as const;
  for (const [id, visible] of windows) {
    completed.push(id);
    lesson = selectHelpLesson(completed, 'document', {}, lesson.cursor)!;
    expect(lesson.id).toBe('writing');
    expect(lesson.visible.map(step => step.id)).toEqual(visible);
  }
  completed.push('italic');
  expect(selectHelpLesson(completed, 'document', {}, lesson.cursor)?.id).toBe('organize');
});

it('does not replace an active lesson when a new milestone changes the inferred experience or document mode', () => {
  const completed: HelpChecklistId[] = ['welcome', 'empty-document', 'find', 'source'];
  const initial = selectHelpLesson(completed, 'document')!;
  completed.push('document');
  const resumed = selectHelpLesson(completed, 'source', {}, initial.cursor)!;
  expect(resumed.cursor).toEqual(initial.cursor);
  expect(resumed.visible).toEqual(initial.visible);
});

it('fills the rolling window with available steps', () => {
  const initial = selectHelpLesson([], 'graph')!;
  const resumed = selectHelpLesson(['create-folder'], 'graph', { duplicate: false }, initial.cursor)!;
  expect(resumed.visible.map(step => step.id)).toEqual(['create-folder', 'move-document', 'document', 'graph']);
});
