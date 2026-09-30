export const CHAT_TAB_ID = 'view:chat';

export interface ChatContact {
  id: string;
  name: string;
  account: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  createdAt: number;
}

export interface ChatConversation {
  id: string;
  kind: 'direct' | 'group' | 'bot';
  name: string;
  members: string[];
  messages: ChatMessage[];
  updatedAt: number;
}

export const chatBots = [
  {
    id: 'notifications',
    name: '同页通知',
    description: '将工作区动态、计划提醒带入会话。',
    capability: '通知服务尚未接入。这里不会推送真实的工作区动态。',
  },
  {
    id: 'qa',
    name: '问答机器人',
    description: '在私聊或群聊中提问，一起整理想法。',
    capability: '尚未连接模型服务。机器人暂时无法接收消息或生成回复。',
  },
] as const;
