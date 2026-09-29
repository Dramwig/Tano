export interface AgentChange {
  id: string;
  path: string;
  client: string;
  instanceId: string;
  operation: 'create' | 'write';
  createdAt: number;
  status: 'prepared' | 'applied' | 'failed';
  beforeHash: string | null;
  afterHash: string;
  error: string;
}
export interface AgentChangeDetail extends AgentChange {
  beforeContent: string | null;
  afterContent: string | null;
}
export interface AgentSetup {
  config: { mcpServers: Record<string, { command: string; args: string[] }> };
  bundled: boolean;
}
export function workspaceAgentGuide(name: string, purpose: string, language: 'zh' | 'en') {
  return `# ${name.replace(/[\r\n]/g, ' ').trim() || 'Tano workspace'}\n\n${purpose.trim() ? `${purpose.trim()}\n\n` : ''}## Shared workspace\n\nThis folder is shared by humans and agents using Tano / 同页. Markdown files are the content source of truth.\n\n- ${language === 'zh' ? '默认使用简体中文回复和撰写正文，保留已有文档的语言。' : 'Use English by default; preserve each existing document’s language.'}\n- Read the current file before editing. Keep unrelated text, YAML frontmatter, image references and formatting intact.\n- Other people or agents may be editing at the same time. If the file changes after you read it, reread and merge your intended changes. Never silently replace newer content.\n- With Tano MCP, use the sha256 returned by tano_read_document as expectedHash for tano_write_document. A mismatch requires rereading and reviewing the changes.\n- Prefer small, focused changes. Keep files UTF-8 and use relative links for workspace attachments.\n- Do not edit .tano/config.json, Tano application caches, conflict copies or recovered drafts unless explicitly requested.\n- Do not delete or rename documents unless requested. Preserve both versions when resolving a conflict.\n- Summarize changed paths and the reason for each change. Do not claim tests or checks that were not run.\n\n## Attribution\n\nOrdinary filesystem changes have an unknown author. Tano MCP records its own tool calls and content hashes; the connecting client name is self-reported and does not prove a person or model’s identity.\n`;
}
