import { describe, expect, it } from 'vitest';
import { locateSuggestion, projectSuggestions, proposalSuggestions, suggestEdit } from './document-suggestions';
import { mergeSuggestions } from './workspace-suggestions';
import { parseSuggestionFile } from '@tano/protocol';
import type { CommentMessage, DocumentSuggestion, SuggestionFile } from '@tano/protocol';

const author = { id: 'human', name: '用户' };
const records = (base: string, next: string) => suggestEdit(base, [], next, author);
const file = (suggestions: DocumentSuggestion[]): SuggestionFile => ({ version: 1, workspaceId: 'workspace', fileId: 'a00001', suggestions });

describe('document suggestions', () => {
  it('merges independent review replies while retaining remote review decisions', () => {
    const item = records('Hello', 'Hi')[0]!;
    const reply = (id: string, body: string): CommentMessage => ({ id, body, authorId: 'human', authorName: '用户', createdAt: 1 });
    const local = { ...item, replies: [reply('reply-local', '本机回复')] };
    const remote = { ...item, status: 'rejected' as const, revision: item.revision + 1, replies: [reply('reply-remote', '外部回复')] };
    const merged = mergeSuggestions(file([item]), file([local]), file([remote]));
    expect(merged.suggestions[0]!.status).toBe('rejected');
    expect(merged.suggestions[0]!.replies?.map(message => message.body)).toEqual(['本机回复', '外部回复']);
    expect(parseSuggestionFile(JSON.stringify(merged), 'workspace', 'a00001')).toEqual(merged);
  });
  it('preserves both versions by rejecting competing edits of the same reply', () => {
    const message: CommentMessage = { id: 'reply-one', body: '原回复', authorId: 'human', authorName: '用户', createdAt: 1 };
    const item = { ...records('Hello', 'Hi')[0]!, replies: [message] };
    expect(() => mergeSuggestions(file([item]), file([{ ...item, replies: [{ ...message, body: '本机编辑' }] }]),
      file([{ ...item, replies: [{ ...message, body: '外部编辑' }] }]))).toThrow('回复已被其他编辑修改');
  });
  it('validates suggestion replies through the shared comment protocol', () => {
    const item = records('Hello', 'Hi')[0]!;
    expect(() => parseSuggestionFile(JSON.stringify(file([{ ...item, replies: [
      { id: 'reply-one', body: '', authorId: 'human', authorName: '用户', createdAt: 1 },
    ] }])), 'workspace', 'a00001')).toThrow('评论内容格式无效');
  });
  it('retains the review conversation when further typing updates a suggestion', () => {
    const item = { ...records('Hello', 'Hello world')[0]!, replies: [
      { id: 'reply-one', body: '请核对', authorId: 'human', authorName: '用户', createdAt: 1 },
    ] };
    const updated = suggestEdit('Hello', [item], 'Hello world!', author);
    expect(updated[0]!.id).toBe(item.id);
    expect(updated[0]!.replies).toEqual(item.replies);
  });
  it('keeps independent edits separate and merges continuous typing without changing the base', () => {
    const base = '第一段\n第二段\n第三段\n';
    let items = records(base, '第一段新增\n第二段\n第三段\n');
    const id = items[0]!.id;
    items = suggestEdit(base, items, '第一段新增内容\n第二段\n第三段\n', author);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(id);
    items = suggestEdit(base, items, '第一段新增内容\n第二段\n最后一段\n', author);
    expect(items.filter(item => item.status === 'pending')).toHaveLength(2);
    expect(projectSuggestions(base, items).content).toBe('第一段新增内容\n第二段\n最后一段\n');
    expect(items.every(item => item.base === base)).toBe(true);
  });
  it('represents a replacement as one atomic suggestion and undo withdraws it', () => {
    const base = '春天到了';
    const items = records(base, '夏天到了');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ from: 0, to: 1, text: '夏' });
    expect(suggestEdit(base, items, base, author)[0]!.status).toBe('rejected');
  });
  it('supports pure deletions and editing around the zero-width preview', () => {
    const base = 'hello world';
    const items = records(base, 'hello ');
    expect(projectSuggestions(base, items).ranges[0]).toMatchObject({ from: 6, to: 6, removed: 'world' });
    const next = suggestEdit(base, items, 'hello everyone', author);
    expect(next.filter(item => item.status === 'pending')).toHaveLength(1);
    expect(next[0]).toMatchObject({ from: 6, to: 11, text: 'everyone' });
  });
  it('does not split emoji surrogate pairs', () => {
    const item = records('a😀z', 'a😁z')[0]!;
    expect(item.base.slice(item.from, item.to)).toBe('😀');
    expect(item.text).toBe('😁');
  });
  it('does not let typing replace another author’s suggestion', () => {
    const base = 'hello';
    const items = records(base, 'hello world');
    expect(() => suggestEdit(base, items, 'hello there', { id: 'other', name: '别人' })).toThrow('他人');
  });
  it('maps independent external changes, but rejects changed or ambiguous targets', () => {
    const item = records('A\nB\nC\n', 'A\nB\nZ\n')[0]!;
    expect(locateSuggestion(item, 'Added\nA\nB\nC\n')).toEqual({ from: 10, to: 11 });
    expect(locateSuggestion(item, 'A\nB\nExternal\n')).toBeNull();
    const repeated = records('same\nsame\n', 'other\nsame\n')[0]!;
    expect(locateSuggestion(repeated, 'same\n')).toBeNull();
  });
  it('accepting one change leaves other changes pending and correctly located', () => {
    const base = 'One\nTwo\nThree\n';
    let items = records(base, 'First\nTwo\nThree\n');
    items = suggestEdit(base, items, 'First\nTwo\nLast\n', author);
    const first = items[0]!;
    const current = base.slice(0, first.from) + first.text + base.slice(first.to);
    const projected = projectSuggestions(current, items.slice(1));
    expect(projected.conflicts).toEqual([]);
    expect(projected.content).toBe('First\nTwo\nLast\n');
  });
  it('marks competing proposals as conflicts instead of hiding one behind another', () => {
    const base = 'hello world';
    const one = records(base, 'hello everyone')[0]!;
    const two = records(base, 'hello friend')[0]!;
    expect(projectSuggestions(base, [one, two])).toMatchObject({ content: base, conflicts: expect.arrayContaining([one.id, two.id]) });
  });
  it('agent proposal edits remain independently applicable', () => {
    const base = 'A\nB\nC\n';
    const items = proposalSuggestions(base, 'X\nB\nY\n', author, crypto.randomUUID(), '修改两段');
    expect(items).toHaveLength(2);
    expect(projectSuggestions(base, items).content).toBe('X\nB\nY\n');
    expect(projectSuggestions(base, items.slice(0, 1)).content).toBe('X\nB\nC\n');
  });
  it('keeps paired formatting and block moves atomic when publishing agent edits', () => {
    const id = crypto.randomUUID();
    expect(proposalSuggestions('hello', '**hello**', author, id, '')).toHaveLength(1);
    const moved = proposalSuggestions('First block\n\nSecond block\n', 'Second block\n\nFirst block\n', author, id, '移动块');
    expect(moved).toHaveLength(1);
    expect(projectSuggestions('First block\n\nSecond block\n', moved).content).toBe('Second block\n\nFirst block\n');
  });
  it('merges independent records but does not override a concurrent rejection', () => {
    const first = records('a', 'b')[0]!, second = records('c', 'd')[0]!;
    expect(mergeSuggestions(file([]), file([first]), file([second])).suggestions).toEqual([second, first]);
    expect(() => mergeSuggestions(file([first]), file([{ ...first, text: 'new', revision: 2 }]),
      file([{ ...first, status: 'rejected', revision: 2 }]))).toThrow('其他编辑');
  });
  it('validates identity, bounds, duplicate IDs and application evidence', () => {
    const item = records('a', 'b')[0]!;
    const parse = (value: unknown) => parseSuggestionFile(JSON.stringify(value), 'workspace', 'a00001');
    expect(parse(file([item]))).toEqual(file([item]));
    expect(() => parse({ ...file([item]), workspaceId: 'other' })).toThrow();
    expect(() => parse(file([{ ...item, to: 12 }]))).toThrow();
    expect(() => parse(file([item, item]))).toThrow();
    expect(() => parse(file([{ ...item, status: 'accepted' }]))).toThrow();
  });
});
