import { expect, it } from 'vitest';
import { rebaseCommentMentions } from './comments';
import { emptyAgentInbox, parseAgentInbox } from './mentions';

it('distinguishes equal labels and preserves only the occurrence outside an edit', () => {
  const mentions = [{ personId: 'a00001', text: '@AI', id: 'mention-0001', from: 0 },
    { personId: 'a00002', text: '@AI', id: 'mention-0002', from: 8 }];
  expect(rebaseCommentMentions(mentions, '@AI one @AI two', 'one @AI two')).toEqual([{ ...mentions[1], from: 4 }]);
  expect(rebaseCommentMentions(mentions, '@AI one @AI two', 'prefix @AI one @AI two')).toEqual(mentions.map(item => ({ ...item, from: item.from + 7 })));
  expect(rebaseCommentMentions(mentions, '@AI one @AI two', '@AI one @AB two')).toEqual([mentions[0]]);
});

it('uses the actual input range when identical labels make a text diff ambiguous', () => {
  const mentions = [{ personId: 'a00001', text: '@AI', id: 'mention-0001', from: 0 },
    { personId: 'a00002', text: '@AI', id: 'mention-0002', from: 4 }];
  expect(rebaseCommentMentions(mentions, '@AI @AI', '@AI', { from: 0, to: 4 })).toEqual([{ ...mentions[1], from: 0 }]);
  expect(rebaseCommentMentions(mentions, '@AI @AI', '@AI', { from: 3, to: 7 })).toEqual([mentions[0]]);
});

it('rejects inbox identity mismatches and duplicate bindings before execution', () => {
  const inbox = emptyAgentInbox('workspace');
  expect(parseAgentInbox(inbox, 'workspace')).toEqual(inbox);
  expect(() => parseAgentInbox(inbox, 'other')).toThrow();
  inbox.bindings = Array(2).fill({ personId: 'a00001', connectionId: 'connection', model: 'model', enabled: true });
  expect(() => parseAgentInbox(inbox, 'workspace')).toThrow();
});
