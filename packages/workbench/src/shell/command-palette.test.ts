import { describe, expect, it, vi } from 'vitest';
import { defaultSelectionContext } from '@tano/editor/document-model';
import { defaultCapabilities } from '@tano/editor/runtime';
import { editorPaletteCommands, matchesCommand } from './command-palette';

const options = () => ({
  editable: true,
  source: false,
  context: { ...defaultSelectionContext, canStyleText: true },
  features: { ...defaultCapabilities.features },
  run: vi.fn(),
});

describe('command palette catalog', () => {
  it('does not expose rich text mutations in read-only or source mode', () => {
    expect(editorPaletteCommands({ ...options(), editable: false })).toEqual([]);
    expect(editorPaletteCommands({ ...options(), source: true })).toEqual([]);
  });

  it('respects disabled document capabilities', () => {
    const state = options();
    state.features.math = false;
    state.features.mermaid = false;
    state.features.objectReferences = false;
    state.features.enhanced = false;
    const ids = editorPaletteCommands(state).map(command => command.id);
    for (const id of ['math', 'math-block', 'mermaid', 'reference', 'object-reference', 'toggle', 'tabs', 'columns'])
      expect(ids).not.toContain(`editor.${id}`);
    expect(ids).toContain('editor.table');
  });

  it('keeps safe insertions and wrappers for a block that cannot be converted', () => {
    const state = options();
    state.context.canTransform = false;
    state.context.canStyleText = false;
    const ids = editorPaletteCommands(state).map(command => command.id);
    expect(ids).toContain('editor.table');
    expect(ids).toContain('editor.quote');
    for (const id of ['paragraph', 'heading.2', 'code-block', 'bold', 'underline'])
      expect(ids).not.toContain(`editor.${id}`);
  });

  it('keeps inline source formatting within the editor supported commands', () => {
    const state = options();
    const ids = editorPaletteCommands({ ...state, context: { ...state.context, inlineSource: true } })
      .map(command => command.id);
    expect(ids).toContain('editor.bold');
    expect(ids).not.toContain('editor.highlight');
    expect(ids).not.toContain('editor.math');
  });

  it('routes headings and insertions through the editor command API without inventing form values', () => {
    const state = options();
    const commands = editorPaletteCommands(state);
    commands.find(command => command.id === 'editor.heading.3')!.run();
    expect(state.run).toHaveBeenLastCalledWith('heading', '3');
    commands.find(command => command.id === 'editor.table')!.run();
    expect(state.run).toHaveBeenLastCalledWith('table');
    for (const id of ['image', 'link', 'file', 'embed', 'mention', 'footnote'])
      expect(commands.some(command => command.id === `editor.${id}`)).toBe(false);
    expect(new Set(commands.map(command => command.id)).size).toBe(commands.length);
  });

  it('searches multiple terms, categories, aliases and the optional command prefix', () => {
    const command = { id: 'editor.heading.3', label: '转换为 3 级标题', source: '格式', keywords: 'heading h3 标题3' };
    expect(matchesCommand(command, '> 格式 标题3')).toBe(true);
    expect(matchesCommand(command, ' HEADING 3 ')).toBe(true);
    expect(matchesCommand(command, '格式 表格')).toBe(false);
    expect(matchesCommand({ ...command, available: false }, '')).toBe(false);
  });
});
