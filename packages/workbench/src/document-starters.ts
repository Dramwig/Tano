import { splitFrontmatter } from '@tano/editor/syntax';
import { builtinTemplates, renderTemplate } from './workspace-templates';
import { localDayKey } from './calendar';

/** The page already owns its title and properties; initialize only the template body. */
export function templateStarterBody(content: string) {
  return splitFrontmatter(content).body.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, '').trimStart();
}

export function documentStarter(kind: 'meeting' | 'weekly' | 'todo', workspaceName: string) {
  if (kind === 'todo') return '## 待办事项\n\n- [ ] 第一项待办\n- [ ] 第二项待办\n\n## 备注\n\n';
  const template = builtinTemplates.find(item => item.id === kind)!;
  return templateStarterBody(renderTemplate(template.content, {
    title: template.name, date: localDayKey(new Date()), owner: '待补充', project: workspaceName || '待补充',
  }));
}
