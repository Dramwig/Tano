import { isTemplatePath, newShortId, templateDirectory } from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';
import { headings, mergeMarkdown } from '@tano/markdown';
import { Document, isMap, parseDocument, visit } from 'yaml';

export interface DocumentTemplate { id: string; name: string; content: string; path?: string; snapshot?: FileSnapshot }
export const builtinTemplates: DocumentTemplate[] = [
  { id: 'meeting', name: '会议纪要', content: '# {{title}}\n\n日期：{{date}}\n\n参与人：{{owner}}\n\n## 议题\n\n- 本次会议需要讨论的问题\n\n## 决定\n\n记录达成共识的结论。\n\n## 行动项\n\n- [ ] 明确下一步与负责人\n\n## 依据\n\n补充相关文档与参考资料。\n' },
  { id: 'weekly', name: '周报', content: '# {{title}}\n\n周期：{{date}}\n\n项目：{{project}}\n\n## 已完成\n\n- 本周完成的工作与成果\n\n## 待处理\n\n- [ ] 下周需要推进的事项\n\n## 逾期\n\n记录延期事项与调整计划。\n\n## 阻塞\n\n需要哪些支持或协作？\n\n## 来源与依据\n\n补充相关文档与参考资料。\n' },
  { id: 'handoff', name: '交接', content: '# {{title}}\n\n日期：{{date}}\n\n接手人：{{owner}}\n\n## 当前进展\n\n概括目前的状态与已完成的工作。\n\n## 未完成事项\n\n- [ ] 需要继续跟进的任务\n\n## 验收要求\n\n记录完成标准与注意事项。\n\n## 相关文档与任务\n\n补充接手时需要的资料。\n' },
  { id: 'project', name: '项目计划', content: '# {{title}}\n\n项目：{{project}}\n日期：{{date}}\n\n## 项目目标\n\n希望解决什么问题？如何判断项目成功？\n\n## 里程碑\n\n- [ ] 明确需求与范围\n- [ ] 完成第一版方案\n- [ ] 验收与复盘\n\n## 任务分工\n\n| 任务 | 负责人 | 截止日期 |\n| --- | --- | --- |\n| 确认项目范围 | 待分配 | 待确定 |\n\n## 风险与应对\n\n## 相关资料\n' },
  { id: 'todo', name: '待办清单', content: '# {{title}}\n\n日期：{{date}}\n\n## 今天要做\n\n- [ ] 最重要的一件事\n- [ ] 第二项待办\n- [ ] 第三项待办\n\n## 稍后处理\n\n- [ ] 待安排的事项\n\n## 备注\n\n记录需要跟进的细节。\n' },
  { id: 'study', name: '学习笔记', content: '# {{title}}\n\n日期：{{date}}\n\n## 核心观点\n\n用自己的话概括这次学到的内容。\n\n## 知识整理\n\n- 关键概念\n- 例子与应用\n- 和已有知识的联系\n\n## 我的疑问\n\n## 下一步\n\n- [ ] 回顾笔记\n- [ ] 尝试在实践中应用\n\n## 参考资料\n' },
  { id: 'travel', name: '旅行计划', content: '# {{title}}\n\n出发日期：{{date}}\n\n## 行程安排\n\n| 日期 | 目的地 | 安排 |\n| --- | --- | --- |\n| 第一天 | 待确定 | 出发与入住 |\n| 第二天 | 待确定 | 自由探索 |\n\n## 准备清单\n\n- [ ] 证件与车票\n- [ ] 住宿预订\n- [ ] 衣物与日用品\n- [ ] 充电器与常用药品\n\n## 预算\n\n## 旅行备忘\n' },
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
