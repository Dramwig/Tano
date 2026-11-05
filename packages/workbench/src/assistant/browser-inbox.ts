import { emptyAgentInbox, parseAgentInbox } from '@tano/protocol';
import type { AgentInboxStorage } from '@tano/protocol';

/** Device runner state is account/host namespaced. Web Locks coordinate tabs before CAS. */
export function browserAgentInbox(namespace: string): AgentInboxStorage {
  const key = (workspaceId: string) => `${namespace}.inbox.${workspaceId}`;
  const load = (workspaceId: string) => parseAgentInbox(JSON.parse(localStorage.getItem(key(workspaceId)) ??
    JSON.stringify(emptyAgentInbox(workspaceId))), workspaceId);
  return {
    load: async workspaceId => load(workspaceId),
    compareExchange: async (inbox, expectedRevision) => {
      if (!navigator.locks) throw new Error('浏览器不支持安全保存机器人收件箱');
      return navigator.locks.request(key(inbox.workspaceId), () => {
        if (load(inbox.workspaceId).revision !== expectedRevision) return false;
        if (inbox.revision !== expectedRevision + 1) throw new Error('机器人收件箱版本无效');
        localStorage.setItem(key(inbox.workspaceId), JSON.stringify(parseAgentInbox(inbox, inbox.workspaceId)));
        return true;
      });
    },
  };
}
