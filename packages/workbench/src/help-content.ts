import { t } from './i18n';
export type HelpContext = 'welcome' | 'empty-document' | 'document' | 'reading' | 'source' | 'graph' | 'plan' | 'plugins';
export type HelpTopicId = HelpContext | 'find' | 'templates' | 'comments';

export interface HelpTopic {
  id: HelpTopicId;
  title: string;
  hint: string;
  docsPage: string;
}

// Short contextual cues only. Complete instructions live in the documentation site.
export const helpTopics: Record<HelpTopicId, HelpTopic> = {
  welcome: {
    id: 'welcome', get title() { return t('从第一篇文档开始'); },
    get hint() { return t('不知道从哪里开始？可以先新建一篇文档，随手记下一点想法。'); },
    docsPage: 'quickstart',
  },
  'empty-document': {
    id: 'empty-document', get title() { return t('写下你的第一行'); },
    get hint() { return t('从一句话开始就好。输入 # 和空格可以写标题，输入 - 和空格可以列清单。'); },
    docsPage: 'editor',
  },
  document: {
    id: 'document', get title() { return t('把相关的文档连起来'); },
    get hint() { return t('有相关的文档？输入 [[ 可以插入文档引用，把想法连起来。'); },
    docsPage: 'organize',
  },
  reading: {
    id: 'reading', get title() { return t('更轻松地阅读文档'); },
    get hint() { return t('长文档可以通过目录跳转。点击目录中的标题，就能找到对应段落。'); },
    docsPage: 'editor',
  },
  source: {
    id: 'source', get title() { return t('在源码与排版之间切换'); },
    get hint() { return t('这里可以直接编辑 Markdown。再次点击「源码模式」，就能回到排版视图。'); },
    docsPage: 'editor',
  },
  graph: {
    id: 'graph', get title() { return t('读懂文档之间的联系'); },
    get hint() { return t('每个节点是一篇文档。拖动空白处移动图谱，点击节点打开文档。'); },
    docsPage: 'organize',
  },
  plan: {
    id: 'plan', get title() { return t('按自己的节奏安排计划'); },
    get hint() { return t('可以按日、周或月查看安排。在侧栏选择日期，就能回到那一天。'); },
    docsPage: 'tasks',
  },
  plugins: {
    id: 'plugins', get title() { return t('了解插件，再决定启用'); },
    get hint() { return t('插件可以扩展工作区。先查看详情和所需权限，再决定是否安装或启用。'); },
    docsPage: 'plugins',
  },
  find: {
    id: 'find', get title() { return t('快速找回一篇文档'); },
    get hint() { return t('想找之前的内容？侧栏的搜索可以帮你查找文档。'); },
    docsPage: 'organize',
  },
  templates: {
    id: 'templates', get title() { return t('复用常用的文档结构'); },
    get hint() { return t('把重复使用的结构保存为模板，下次从模板开始。'); }, docsPage: 'templates',
  },
  comments: {
    id: 'comments', get title() { return t('围绕文档交流'); },
    get hint() { return t('可以在文档下方评论，也可以选中文字留下批注。'); }, docsPage: 'editor',
  },
};

export function helpContextTopic(context: HelpContext): HelpTopic {
  return helpTopics[context];
}

// Internal teaching stages, not a category browser. These thresholds only choose
// a starting point before a lesson has been shown; they never interrupt a lesson.
export const helpStages = [
  { id: 'start', get label() { return t('开始记录'); }, advance: 2 },
  { id: 'writing', get label() { return t('写作基础'); }, advance: 3 },
  { id: 'organize', get label() { return t('整理与连接'); }, advance: 3 },
  { id: 'structure', get label() { return t('丰富文档内容'); }, advance: 4 },
  { id: 'reading', get label() { return t('检索与阅读'); }, advance: 3 },
  { id: 'planning', get label() { return t('把想法变成计划'); }, advance: 2 },
  { id: 'workflow', get label() { return t('复用与迁移'); }, advance: 2 },
  { id: 'review', get label() { return t('评论与讨论'); }, advance: 2 },
  { id: 'extensions', get label() { return t('了解扩展能力'); }, advance: 2 },
] as const;
export type HelpStageId = typeof helpStages[number]['id'];
export type HelpRequirement = 'document-write' | 'workspace-write' | 'plans' | 'comments' | 'templates' | 'import' | 'duplicate' | 'plugins';
export type HelpAvailability = Partial<Record<HelpRequirement, boolean>>;
interface HelpStep { id: string; stage: HelpStageId; topic: HelpTopicId; label: string; hint: string; requires?: HelpRequirement }

// Each milestone describes an actual operation. The linked docs remain the full guide.
// Keep existing milestone IDs stable so expanding the checklist preserves progress.
export const helpChecklist = [
  { id: 'welcome', stage: 'start', topic: 'welcome', get label() { return t('认识工作区'); }, get hint() { return t('打开一篇文档，熟悉工作区。'); } },
  { id: 'empty-document', stage: 'start', topic: 'empty-document', get label() { return t('写下第一段内容'); }, get hint() { return t('随手写一句话，记录自己的想法。'); }, requires: 'document-write' },
  { id: 'create-document', stage: 'start', topic: 'welcome', get label() { return t('新建一篇文档'); }, get hint() { return t('在侧栏新建文档，留下一点自己的想法。'); }, requires: 'workspace-write' },
  { id: 'rename-document', stage: 'start', topic: 'document', get label() { return t('给文档起个名字'); }, get hint() { return t('在侧栏右键文档，选择「重命名」。'); }, requires: 'workspace-write' },
  { id: 'heading', stage: 'writing', topic: 'empty-document', get label() { return t('用标题分清层次'); }, get hint() { return t('在行首输入 # 和空格，写一个标题。'); }, requires: 'document-write' },
  { id: 'bold', stage: 'writing', topic: 'empty-document', get label() { return t('强调重点文字'); }, get hint() { return t('选中文字加粗，或用 **包住重点**。'); }, requires: 'document-write' },
  { id: 'bullet-list', stage: 'writing', topic: 'empty-document', get label() { return t('列一份清单'); }, get hint() { return t('在行首输入 - 和空格，把想法逐条列出。'); }, requires: 'document-write' },
  { id: 'ordered-list', stage: 'writing', topic: 'empty-document', get label() { return t('按顺序写步骤'); }, get hint() { return t('用 1. 和空格开始一组有序步骤。'); }, requires: 'document-write' },
  { id: 'todo-list', stage: 'writing', topic: 'empty-document', get label() { return t('在正文记下待办'); }, get hint() { return t('输入 - [ ] 和待办内容，得到可勾选的清单。'); }, requires: 'document-write' },
  { id: 'italic', stage: 'writing', topic: 'empty-document', get label() { return t('用斜体补充语气'); }, get hint() { return t('选中文字设为斜体，或用 *包住文字*。'); }, requires: 'document-write' },
  { id: 'quote', stage: 'structure', topic: 'empty-document', get label() { return t('引用一段文字'); }, get hint() { return t('在行首输入 > 和空格，写下引用内容。'); }, requires: 'document-write' },
  { id: 'code-block', stage: 'structure', topic: 'source', get label() { return t('插入代码块'); }, get hint() { return t('用三个反引号开始代码块，再写入代码。'); }, requires: 'document-write' },
  { id: 'inline-code', stage: 'structure', topic: 'source', get label() { return t('标注行内代码'); }, get hint() { return t('用一对反引号包住命令或代码片段。'); }, requires: 'document-write' },
  { id: 'table', stage: 'structure', topic: 'empty-document', get label() { return t('用表格整理信息'); }, get hint() { return t('插入一张表格，填写需要对照的信息。'); }, requires: 'document-write' },
  { id: 'divider', stage: 'structure', topic: 'empty-document', get label() { return t('分隔不同主题'); }, get hint() { return t('在单独一行输入 ---，插入分隔线。'); }, requires: 'document-write' },
  { id: 'external-link', stage: 'structure', topic: 'document', get label() { return t('附上参考链接'); }, get hint() { return t('选中文字添加网页链接，保留资料来源。'); }, requires: 'document-write' },
  { id: 'image', stage: 'structure', topic: 'empty-document', get label() { return t('插入一张图片'); }, get hint() { return t('在正文插入图片，让记录更直观。'); }, requires: 'document-write' },
  { id: 'footnote', stage: 'structure', topic: 'empty-document', get label() { return t('用脚注补充说明'); }, get hint() { return t('用 [^1] 引用，并在文末写 [^1]: 说明。'); }, requires: 'document-write' },
  { id: 'create-folder', stage: 'organize', topic: 'document', get label() { return t('创建分类文件夹'); }, get hint() { return t('在侧栏新建文件夹，给同类内容一个位置。'); }, requires: 'workspace-write' },
  { id: 'move-document', stage: 'organize', topic: 'document', get label() { return t('把文档归入文件夹'); }, get hint() { return t('把一篇文档拖到文件夹里，整理一下。'); }, requires: 'workspace-write' },
  { id: 'duplicate-document', stage: 'organize', topic: 'document', get label() { return t('从副本尝试新想法'); }, get hint() { return t('在侧栏右键文档，选择创建副本。'); }, requires: 'duplicate' },
  { id: 'document', stage: 'organize', topic: 'document', get label() { return t('连接相关文档'); }, get hint() { return t('输入 [[，选择另一篇文档，把想法连起来。'); }, requires: 'document-write' },
  { id: 'graph', stage: 'organize', topic: 'graph', get label() { return t('浏览关系图谱'); }, get hint() { return t('从侧栏打开关系图谱，看看文档之间的联系。'); } },
  { id: 'find', stage: 'reading', topic: 'find', get label() { return t('搜索并找到文档'); }, get hint() { return t('用侧栏搜索输入关键词，再打开一条结果。'); } },
  { id: 'reading', stage: 'reading', topic: 'reading', get label() { return t('通过大纲跳转'); }, get hint() { return t('在文档大纲中点击标题，跳到对应段落。'); } },
  { id: 'page-find', stage: 'reading', topic: 'find', get label() { return t('定位页内关键词'); }, get hint() { return t('打开页内查找，输入关键词定位匹配内容。'); } },
  { id: 'page-replace', stage: 'reading', topic: 'source', get label() { return t('替换一处文字'); }, get hint() { return t('展开页内替换，确认匹配内容后替换。'); }, requires: 'document-write' },
  { id: 'source', stage: 'reading', topic: 'source', get label() { return t('切换源码模式'); }, get hint() { return t('点击文档工具栏的源码按钮，看看 Markdown。'); } },
  { id: 'plan', stage: 'planning', topic: 'plan', get label() { return t('安排一个小计划'); }, get hint() { return t('在计划中新增一条安排，记下下一步。'); }, requires: 'plans' },
  { id: 'plan-date', stage: 'planning', topic: 'plan', get label() { return t('给计划安排时间'); }, get hint() { return t('在计划详情里设置日期，让安排有迹可循。'); }, requires: 'plans' },
  { id: 'plan-description', stage: 'planning', topic: 'plan', get label() { return t('补充计划说明'); }, get hint() { return t('写下计划的说明，留下具体的行动信息。'); }, requires: 'plans' },
  { id: 'plan-complete', stage: 'planning', topic: 'plan', get label() { return t('完成一项待办'); }, get hint() { return t('完成实际工作后，勾选对应的计划待办。'); }, requires: 'plans' },
  { id: 'use-template', stage: 'workflow', topic: 'templates', get label() { return t('从模板开始一篇文档'); }, get hint() { return t('打开文档模板，选择合适的结构并创建文档。'); }, requires: 'templates' },
  { id: 'save-template', stage: 'workflow', topic: 'templates', get label() { return t('保存自己的模板'); }, get hint() { return t('在文档模板中自定义结构并保存，以后重复使用。'); }, requires: 'templates' },
  { id: 'import-document', stage: 'workflow', topic: 'welcome', get label() { return t('导入已有内容'); }, get hint() { return t('从工作区菜单导入文档，把已有记录带过来。'); }, requires: 'import' },
  { id: 'export-document', stage: 'workflow', topic: 'source', get label() { return t('导出一篇文档'); }, get hint() { return t('在文档操作菜单中选择导出格式，保存一份。'); } },
  { id: 'comment', stage: 'review', topic: 'comments', get label() { return t('留下文档评论'); }, get hint() { return t('在文档下方写一条评论，记录问题或想法。'); }, requires: 'comments' },
  { id: 'annotation', stage: 'review', topic: 'comments', get label() { return t('为选中的文字加批注'); }, get hint() { return t('选中一段文字，添加一条针对这段内容的批注。'); }, requires: 'comments' },
  { id: 'reply-comment', stage: 'review', topic: 'comments', get label() { return t('回复一条讨论'); }, get hint() { return t('在已有评论或批注下回复，把讨论接下去。'); }, requires: 'comments' },
  { id: 'resolve-comment', stage: 'review', topic: 'comments', get label() { return t('解决一条批注'); }, get hint() { return t('处理完批注中的问题后，将这条讨论标记为解决。'); }, requires: 'comments' },
  { id: 'plugins', stage: 'extensions', topic: 'plugins', get label() { return t('浏览插件中心'); }, get hint() { return t('打开插件中心，了解当前可用的扩展。'); }, requires: 'plugins' },
  { id: 'plugin-details', stage: 'extensions', topic: 'plugins', get label() { return t('查看插件详情与权限'); }, get hint() { return t('打开一个插件的详情，先了解能力和权限。'); }, requires: 'plugins' },
] as const satisfies readonly HelpStep[];
export type HelpChecklistId = typeof helpChecklist[number]['id'];
export interface HelpLessonCursor { stage: HelpStageId; first: HelpChecklistId }

export function selectHelpLesson(completed: readonly HelpChecklistId[], context: HelpContext,
  availability: HelpAvailability = {}, current?: HelpLessonCursor) {
  const available = (step: typeof helpChecklist[number]) => !('requires' in step) || availability[step.requires] !== false;
  const stages = helpStages.map(stage => {
    const steps = helpChecklist.filter(step => step.stage === stage.id && available(step));
    return { ...stage, steps, done: steps.filter(step => completed.includes(step.id)).length };
  }).filter(stage => stage.steps.length);
  const pending = (stage: typeof stages[number]) => stage.done < stage.steps.length;
  const lesson = (stage: typeof stages[number]) => {
    const next = stage.steps.findIndex(step => !completed.includes(step.id));
    // Keep one completed predecessor for continuity, then roll in upcoming steps.
    const start = Math.max(0, next < 0 ? stage.steps.length - 4 : next - 1);
    const visible = stage.steps.slice(start, start + 4);
    return { ...stage, visible, cursor: { stage: stage.id, first: visible[0].id } };
  };
  const active = stages.find(stage => stage.id === current?.stage);
  if (active) {
    // Roll within the current stage without skipping its original next step.
    if (pending(active)) return lesson(active);
    const index = stages.indexOf(active);
    const next = [...stages.slice(index + 1), ...stages.slice(0, index + 1)].find(pending);
    return lesson(next ?? active);
  }
  const contextual: Partial<Record<HelpContext, HelpStageId>> = {
    plan: 'planning', plugins: 'extensions', graph: 'organize', reading: 'reading', source: 'reading',
  };
  // Existing users can demonstrate fluency without repeating newly added basics.
  // This affects recommendations only; it never fabricates completion checkmarks.
  const experienced = (['document', 'graph', 'source', 'find', 'plan'] as const)
    .filter(id => completed.includes(id)).length >= 3;
  const stage = stages.find(stage => stage.id === contextual[context]) ??
    stages.find(stage => !(experienced && ['start', 'writing'].includes(stage.id)) &&
      stage.done < Math.min(stage.advance, stage.steps.length)) ??
    stages.find(stage => stage.done < stage.steps.length) ?? stages.at(-1);
  if (!stage) return undefined;
  return lesson(stage);
}

export const defaultDocumentationBaseUrl = 'https://tano.page/zh-cn/docs';

export function helpDocumentationUrl(baseUrl = defaultDocumentationBaseUrl, topic?: HelpTopicId) {
  let base: URL;
  try {
    base = new URL(baseUrl);
    if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Unsupported documentation URL');
  } catch { base = new URL(defaultDocumentationBaseUrl); }
  base.search = base.hash = '';
  base.pathname = base.pathname.replace(/\/+$/, '') + (topic ? '/' + helpTopics[topic].docsPage : '');
  return base.href;
}
