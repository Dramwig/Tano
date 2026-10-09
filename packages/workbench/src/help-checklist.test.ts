// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { referenceUrl } from '@tano/protocol';
import { DemoAdapter } from './adapter';
import { BrowserPersonalPlans } from './personal-plans';
import { configureWorkbench } from './runtime';
import { useWorkspaceStore } from './stores/workspace';
import { usePlanStore } from './stores/plans';
import { helpChecklistKey, readHelpCompleted, recordHelpCompleted } from './help-checklist';

let pinia: ReturnType<typeof createPinia>;
let adapter: DemoAdapter;
let personal: BrowserPersonalPlans;
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, run: () => unknown) => run() } });
  adapter = new DemoAdapter(); personal = new BrowserPersonalPlans();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter, personalPlans: personal, native: false, mobile: false });
  setActivePinia(pinia);
  await adapter.open();
  await adapter.create('source.md', 'Existing content\n\n[[target]]\n');
  await adapter.create('target.md', '# Target\n');
  await adapter.create('another.md', '# Another\n');
});
afterEach(() => { disposePinia(pinia); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function workspace() {
  const store = useWorkspaceStore(); await store.openWorkspace();
  const file = (path: string) => store.workspace!.files.find(item => item.path === path)!;
  return { store, file };
}

it('does not count startup, restored content, external edits, or failed opening as completed actions', async () => {
  const { store, file } = await workspace();
  expect(readHelpCompleted()).toEqual([]);
  await store.refresh();
  store.receiveDocument(store.activeId, '# External edit\n\n[[another]]');
  expect(readHelpCompleted()).toEqual([]);
  const read = vi.spyOn(adapter, 'read').mockRejectedValue(new Error('unavailable'));
  await store.openFile(file('another.md'));
  expect(readHelpCompleted()).toEqual([]);
  read.mockRestore();
  await store.openFile(file('source.md'));
  expect(readHelpCompleted()).toEqual(['welcome']);
  store.receiveDocument(store.activeId, 'Remote text\n\n[[target]]');
  expect(readHelpCompleted()).toEqual(['welcome']);
  store.editDocument(store.activeId, 'Native remote change\n\n[[another]]', { origin: 'remote' });
  expect(readHelpCompleted()).toEqual(['welcome']);
});

it('counts a local collaboration transaction while ignoring room hydration and other participants', async () => {
  const { store, file } = await workspace();
  await store.openFile(file('source.md'));
  store.receiveDocument(store.activeId, '# From a collaborator\n\n[[target]]');
  expect(readHelpCompleted()).toEqual(['welcome']);
  store.receiveDocument(store.activeId, '# My addition\n\n[[another]]', { origin: 'local' });
  expect(readHelpCompleted()).toEqual(['welcome', 'empty-document', 'document']);
});

it('records accepted writing and only newly inserted links to another existing document', async () => {
  const { store, file } = await workspace();
  await store.openFile(file('source.md'));
  store.editDocument(store.activeId, store.active!.content);
  expect(readHelpCompleted()).toEqual(['welcome']);
  store.editDocument(store.activeId, 'My text\n\n[[target]]\n');
  expect(readHelpCompleted()).toEqual(['welcome', 'empty-document']);
  store.editDocument(store.activeId, 'My text\n\n[[target]]\n[[missing]]\n[[source]]\n');
  expect(readHelpCompleted()).not.toContain('document');
  store.editDocument(store.activeId, store.active!.content + '\n```md\n[[another]]\n```\n');
  expect(readHelpCompleted()).not.toContain('document');
  store.editDocument(store.activeId, store.active!.content + '\n[[another]]\n');
  expect(readHelpCompleted()).toEqual(['welcome', 'empty-document', 'code-block', 'document']);
  store.editDocument(store.activeId, '');
  expect(readHelpCompleted()).toContain('document');
});

it.each(['wiki', 'markdown', 'identity'])('recognizes a valid %s document reference', async kind => {
  const { store, file } = await workspace();
  await store.create('blank.md');
  const target = file('target.md');
  const link = kind === 'wiki' ? '[[target]]' : kind === 'markdown' ? '[Target](target.md)' :
    `[Target](${referenceUrl({ type: 'document', id: target.id })})`;
  store.editDocument(store.activeId, link);
  expect(readHelpCompleted()).toEqual(['welcome', 'empty-document', 'create-document', 'document']);
});

it('ignores rejected read-only edits and whitespace-only writing', async () => {
  const { store, file } = await workspace();
  await store.create('blank.md');
  store.editDocument(store.activeId, '\n \n');
  expect(readHelpCompleted()).toEqual(['welcome', 'create-document']);
  store.workspace!.readOnly = true;
  store.editDocument(store.activeId, 'Cannot write\n\n[[target]]');
  expect(readHelpCompleted()).toEqual(['welcome', 'create-document']);
  store.workspace!.readOnly = false;
  file('blank.md').readOnly = true;
  store.editDocument(store.activeId, 'Cannot write here either');
  expect(readHelpCompleted()).toEqual(['welcome', 'create-document']);
});

it('tracks creation, rename and moving only after successful operations', async () => {
  const { store, file } = await workspace();
  const create = vi.spyOn(adapter, 'create').mockRejectedValueOnce(new Error('cannot create'));
  await expect(store.create('new.md')).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('create-document');
  create.mockRestore();
  await store.createUntitledDocument();
  expect(readHelpCompleted()).toContain('create-document');
  const createFolder = vi.spyOn(adapter, 'createFolder').mockRejectedValueOnce(new Error('cannot create folder'));
  await expect(store.create('notes', true)).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('create-folder');
  createFolder.mockRestore();
  await store.create('notes', true);
  expect(readHelpCompleted()).toContain('create-folder');
  await expect(store.renameEntry(file('source.md'), 'target.md')).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('rename-document');
  await store.renameEntry(file('source.md'), 'renamed.md');
  expect(readHelpCompleted()).toContain('rename-document');
  const move = vi.spyOn(adapter, 'move').mockRejectedValueOnce(new Error('cannot move'));
  await expect(store.moveEntry(file('renamed.md'), 'notes')).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('move-document');
  move.mockRestore();
  await store.moveEntry(file('renamed.md'), 'notes');
  expect(readHelpCompleted()).toContain('move-document');
});

it('marks browsing the graph only after the graph actually opens', async () => {
  const { store, file } = await workspace();
  await store.openFile(file('source.md'));
  store.active!.missing = true;
  await store.openGraphTab();
  expect(readHelpCompleted()).not.toContain('graph');
  store.active!.missing = false;
  await store.openGraphTab();
  expect(readHelpCompleted()).toContain('graph');
});

const eventDraft = { type: 'event', name: 'My next step', description: '', archived: false,
  properties: { checkable: true, completed: false } };
it('marks a plan only after successful workspace creation', async () => {
  const { store } = await workspace();
  const create = vi.spyOn(adapter, 'create').mockRejectedValue(new Error('cannot save'));
  await expect(store.createObject(eventDraft)).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('plan');
  create.mockRestore();
  await store.createObject(eventDraft);
  expect(readHelpCompleted()).toContain('plan');
});

it('also records a personal plan, but not a failed save or loading existing plans', async () => {
  await workspace();
  const plans = usePlanStore(); await plans.refreshPersonal();
  expect(readHelpCompleted()).not.toContain('plan');
  const create = vi.spyOn(personal, 'create').mockRejectedValue(new Error('cannot save'));
  await expect(plans.createPersonal(eventDraft)).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('plan');
  create.mockRestore();
  await plans.createPersonal(eventDraft);
  expect(readHelpCompleted()).toContain('plan');
});

it('marks plan refinements only when a local edit is successfully saved', async () => {
  const { store } = await workspace();
  const record = await store.createObject(eventDraft);
  const draft = { ...record.object, description: '具体步骤',
    properties: { ...record.object.properties, date: '2026-10-09', completed: true } };
  store.workspace!.readOnly = true;
  await expect(store.updateObject(record, draft, store.workspace!.id)).rejects.toThrow();
  expect(readHelpCompleted()).toEqual(['plan']);
  store.workspace!.readOnly = false;
  await store.updateObject(record, draft, store.workspace!.id);
  expect(readHelpCompleted()).toEqual(['plan', 'plan-date', 'plan-description', 'plan-complete']);
});

it('also tracks saved refinements of personal plans', async () => {
  await workspace();
  const plans = usePlanStore(); await plans.refreshPersonal();
  const record = await plans.createPersonal(eventDraft);
  await plans.update(record, { ...record.object, description: '个人安排',
    properties: { ...record.object.properties, date: '2026-10-09', completed: true } });
  expect(readHelpCompleted()).toEqual(['plan', 'plan-date', 'plan-description', 'plan-complete']);
});

it('does not treat opening remote formatted content as performing Markdown operations', async () => {
  const { store, file } = await workspace();
  await store.openFile(file('source.md'));
  const remote = '# 标题\n\n**重点**\n\n- 列表\n\n普通正文';
  store.receiveDocument(store.activeId, remote);
  store.editDocument(store.activeId, remote.replace('普通正文', '我的正文'));
  expect(readHelpCompleted()).toEqual(['welcome', 'empty-document']);
  store.editDocument(store.activeId, store.active!.content + '\n\n## 新标题\n\n**新重点**');
  expect(readHelpCompleted()).toEqual(['welcome', 'empty-document', 'heading', 'bold']);
});

it('records saving a template only after the storage operation succeeds', async () => {
  const { store } = await workspace();
  const id = store.workspace!.id;
  store.workspace!.readOnly = true;
  await expect(store.writeTemplate('# 我的模板\n\n{{title}}', id)).rejects.toThrow();
  expect(readHelpCompleted()).not.toContain('save-template');
  store.workspace!.readOnly = false;
  await store.writeTemplate('# 我的模板\n\n{{title}}', id);
  expect(readHelpCompleted()).toContain('save-template');
});

it('keeps independent completion markers and avoids writing them again', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem');
  recordHelpCompleted('welcome');
  recordHelpCompleted('plan');
  recordHelpCompleted('welcome');
  expect(set.mock.calls.map(([key]) => key)).toEqual([helpChecklistKey + '.welcome', helpChecklistKey + '.plan']);
  expect(readHelpCompleted()).toEqual(['welcome', 'plan']);
});
