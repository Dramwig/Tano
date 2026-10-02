import { isTemplatePath, newShortId, templateDirectory } from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';
import { headings, mergeMarkdown } from '@tano/markdown';
import { Document, isMap, parseDocument, visit } from 'yaml';

export interface DocumentTemplate { id: string; name: string; content: string; path?: string; snapshot?: FileSnapshot }
export const builtinTemplates: DocumentTemplate[] = [
  { id: 'meeting', name: '会议纪要', content: '# {{title}}\n\n日期：{{date}}\n参与人：{{owner}}\n\n## 议题\n\n## 决定\n\n## 行动项\n\n- [ ] \n\n## 依据\n' },
  { id: 'weekly', name: '周报', content: '# {{title}}\n\n周期：{{date}}\n项目：{{project}}\n\n## 已完成\n\n## 待处理\n\n## 逾期\n\n## 阻塞\n\n未知\n\n## 来源与依据\n' },
  { id: 'handoff', name: '交接', content: '# {{title}}\n\n日期：{{date}}\n接手人：{{owner}}\n\n## 当前进展\n\n## 未完成事项\n\n## 验收要求\n\n## 相关文档与任务\n' },
];
function header(content: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { document: new Document(), body: content };
  const document = parseDocument(match[1]!);
  if (document.errors.length || !isMap(document.contents)) throw new Error('模板 YAML 属性无效，原文件已保留');
  return { document, body: content.slice(match[0].length) };
}
export function nameTemplate(content: string, name: string) {
  if (!name.trim() || name.trim().length > 100 || /[\u0000-\u001f]/.test(name)) throw new Error('请填写有效的模板名称');
  const parsed = header(content);
  parsed.document.set('tanoTemplate', { version: 1, name: name.trim() });
  return `---\n${parsed.document.toString()}---\n${parsed.body}`;
}
function templateBody(content: string) {
  const parsed = header(content);
  if (!parsed.document.has('tanoTemplate')) return content;
  parsed.document.delete('tanoTemplate');
  return isMap(parsed.document.contents) && parsed.document.contents.items.length
    ? `---\n${parsed.document.toString()}---\n${parsed.body}` : parsed.body;
}
function templateName(content: string) {
  const metadata = header(content).document.get('tanoTemplate') as unknown;
  if (metadata !== undefined) {
    const value = isMap(metadata) ? metadata.toJSON() : metadata;
    if (!value || typeof value !== 'object' || value.version !== 1 || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100)
      throw new Error('模板名称属性无效');
    return value.name;
  }
  return headings(content)[0]?.text;
}
export function templateVariables(content: string): string[] {
  return [...new Set([...templateBody(content).matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g)].map(match => match[1]!))];
}
export function renderTemplate(content: string, values: Record<string, string>): string {
  const missing = templateVariables(content).filter(key => !values[key]?.trim());
  if (missing.length) throw new Error(`请填写模板字段：${missing.join('、')}`);
  const replace = (text: string) => text.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g, (_, key: string) => values[key]!);
  const body = templateBody(content), parsed = header(body);
  if (!parsed.document.contents) return replace(body);
  visit(parsed.document, { Scalar(_key, node) { if (typeof node.value === 'string') node.value = replace(node.value); } });
  return `---\n${parsed.document.toString()}---\n${replace(parsed.body)}`;
}
export async function loadTemplates(adapter: WorkspaceAdapter, workspace: Workspace) {
  const templates: DocumentTemplate[] = [], errors: string[] = [];
  for (const file of workspace.files.filter(file => file.kind === 'file' && isTemplatePath(file.path))) {
    try {
      const snapshot = await adapter.read(file.path);
      templates.push({ id: file.id, path: file.path, snapshot, content: snapshot.content,
        name: templateName(snapshot.content) ?? file.path.split('/').at(-1)! });
    } catch (error) { errors.push(`${file.path}：${String(error)}`); }
  }
  return { templates, errors };
}
export async function saveTemplate(adapter: WorkspaceAdapter, content: string, base?: DocumentTemplate, occupied = new Set<string>()) {
  if (!content.trim() || content.length > 100_000) throw new Error('模板正文不能为空或超过 100 KB');
  if (!base?.path || !base.snapshot) {
    const path = `${templateDirectory}/${newShortId(occupied)}.md`;
    await adapter.create(path, content); return path;
  }
  const current = await adapter.read(base.path);
  const merged = mergeMarkdown(base.snapshot.content, content, current.content);
  if (!merged.clean) throw new Error('模板已被外部修改，当前草稿已保留，请重新读取或另存模板');
  const result = await adapter.write(base.path, merged.content, current.hash);
  if (result.status !== 'saved') throw new Error('模板保存期间再次变化，当前草稿已保留');
  return base.path;
}
