import { describe, expect, it } from 'vitest';
import type { ActivePluginContextProvider } from '../plugins/assistant-bridge';
import {
  applyMentionSelection,
  detectMentionTrigger,
  filterPluginContextProviders,
  formatPluginMentionToken,
} from './mention-autocomplete';

const providers: ActivePluginContextProvider[] = [
  {
    key: 'kanban:board',
    pluginId: 'kanban',
    pluginName: '项目看板',
    provider: { id: 'board', label: '进行中看板', description: '返回当前看板任务摘要' },
  },
  {
    key: 'zotero:papers',
    pluginId: 'zotero',
    pluginName: '文献助手',
    provider: { id: 'papers', label: '近期文献', description: '列出最近阅读的论文' },
  },
  {
    key: 'sprint:board',
    pluginId: 'sprint',
    pluginName: '迭代板',
    provider: { id: 'board', label: '迭代泳道', description: '当前迭代进度' },
  },
];

describe('plugin @mention autocomplete helpers', () => {
  it('detects @ triggers at valid boundaries and ignores email-like strings', () => {
    expect(detectMentionTrigger('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(detectMentionTrigger('结合 @boa 整理', 7)).toEqual({ start: 3, end: 7, query: 'boa' });
    expect(detectMentionTrigger('（@kanban:bo', 11)).toEqual({ start: 1, end: 11, query: 'kanban:bo' });
    expect(detectMentionTrigger('联系 alice@board.com', 14)).toBeNull();
    expect(detectMentionTrigger('没有提及', 4)).toBeNull();
  });

  it('filters providers by id, key, label, description, and plugin name', () => {
    expect(filterPluginContextProviders(providers, '')).toHaveLength(3);
    expect(filterPluginContextProviders(providers, 'paper').map(p => p.key)).toEqual(['zotero:papers']);
    expect(filterPluginContextProviders(providers, '迭代').map(p => p.key)).toEqual(['sprint:board']);
    expect(filterPluginContextProviders(providers, 'kanban:').map(p => p.key)).toEqual(['kanban:board']);
  });

  it('uses short @id when unique and disambiguates duplicate IDs with @pluginId:id', () => {
    expect(formatPluginMentionToken(providers[1]!, providers)).toBe('@papers');
    expect(formatPluginMentionToken(providers[0]!, providers)).toBe('@kanban:board');

    const trigger = detectMentionTrigger('请参考 @pa 总结', 7)!;
    const applied = applyMentionSelection('请参考 @pa 总结', trigger, providers[1]!, providers);
    expect(applied).toEqual({ text: '请参考 @papers 总结', caret: 11, token: '@papers' });

    const endTrigger = detectMentionTrigger('查看 @boa', 7)!;
    const appliedEnd = applyMentionSelection('查看 @boa', endTrigger, providers[0]!, providers);
    expect(appliedEnd).toEqual({
      text: '查看 @kanban:board ',
      caret: 17,
      token: '@kanban:board',
    });
  });
});
