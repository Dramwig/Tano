import { t } from './i18n';
export type HelpContext = 'welcome' | 'empty-document' | 'document' | 'reading' | 'source' | 'graph' | 'plan' | 'plugins' | 'assistant' | 'tables';
export type HelpTopicId = HelpContext | 'find' | 'templates' | 'comments' | 'folders' | 'suggestions';

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
    get hint() { return t('从侧栏打开一篇文档；底部可在工作区和主页之间切换。'); },
    docsPage: 'quickstart',
  },
  'empty-document': {
    id: 'empty-document', get title() { return t('写下你的第一行'); },
    get hint() { return t('在空白段落输入 / 选择标题，或在行首输入 # 和空格。'); },
    docsPage: 'editor',
  },
  document: {
    id: 'document', get title() { return t('把相关的文档连起来'); },
    get hint() { return t('输入 [[ 搜索并选择文档或对象；@ 用于提及人员和 Agent。'); },
    docsPage: 'organize',
  },
  reading: {
    id: 'reading', get title() { return t('更轻松地阅读文档'); },
    get hint() { return t('从文档「更多（⋯）」打开目录，点击标题跳到对应段落。'); },
    docsPage: 'editor',
  },
  source: {
    id: 'source', get title() { return t('在源码与排版之间切换'); },
    get hint() { return t('点击文档工具栏的源码按钮查看 Markdown，再次点击返回编辑。'); },
    docsPage: 'editor',
  },
  graph: {
    id: 'graph', get title() { return t('读懂文档之间的联系'); },
    get hint() { return t('节点表示文档或对象；拖动空白处移动图谱，点击节点查看关联内容。'); },
    docsPage: 'organize',
  },
  plan: {
    id: 'plan', get title() { return t('按自己的节奏安排计划'); },
    get hint() { return t('按日、周或月查看安排；主页可汇总个人与当前工作区的计划，工作区只显示本区事项。'); },
    docsPage: 'tasks',
  },
  plugins: {
    id: 'plugins', get title() { return t('了解插件，再决定启用'); },
    get hint() { return t('打开插件详情，核对来源、能力和权限，再决定安装或授权。'); },
    docsPage: 'plugins',
  },
  find: {
    id: 'find', get title() { return t('快速找回一篇文档'); },
    get hint() { return t('打开侧栏「查找文档」，按名称或已保存的正文搜索并打开结果。'); },
    docsPage: 'organize',
  },
  templates: {
    id: 'templates', get title() { return t('复用常用的文档结构'); },
    get hint() { return t('打开文档模板，预览内置或自定义模板后创建文档。'); }, docsPage: 'templates',
  },
  folders: {
    id: 'folders', get title() { return t('用首页组织一组文档'); },
    get hint() { return t('文件夹可用首页介绍内容；右键文档选择「新建子文档」，继续展开想法。'); }, docsPage: 'organize',
  },
  tables: {
    id: 'tables', get title() { return t('用数据表持续整理信息'); },
    get hint() { return t('数据表支持字段、筛选和多种视图；每行是表内记录，不会自动新建文档。'); }, docsPage: 'organize',
  },
  assistant: {
    id: 'assistant', get title() { return t('让助手带着上下文工作'); },
    get hint() { return t('选择连接、模型和参考内容后提问；也可用 @ 提及已配置的 Agent。浏览器演示使用模拟响应。'); }, docsPage: 'assistant',
  },
  suggestions: {
    id: 'suggestions', get title() { return t('先审阅建议，再更新正文'); },
    get hint() { return t('在文档「更多（⋯）」中开启建议编辑，核对每处修改后再接受。'); }, docsPage: 'suggesting',
  },
  comments: {
    id: 'comments', get title() { return t('围绕文档交流'); },
    get hint() { return t('选中正文，通过浮动工具栏添加批注，让讨论指向具体文字。'); }, docsPage: 'editor',
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
  { id: 'assistant', get label() { return t('与助手一起工作'); }, advance: 2 },
  { id: 'extensions', get label() { return t('了解扩展能力'); }, advance: 2 },
] as const;
export type HelpStageId = typeof helpStages[number]['id'];
export type HelpRequirement = 'document-write' | 'workspace-write' | 'plans' | 'comments' | 'templates' | 'import' | 'duplicate' | 'plugins' | 'folder-home' | 'folder-conversion' | 'panes' | 'assistant' | 'assistant-configure' | 'suggestions' | 'math' | 'mermaid';
export type HelpAvailability = Partial<Record<HelpRequirement, boolean>>;
interface HelpStep { id: string; stage: HelpStageId; topic: HelpTopicId; label: string; hint: string; requires?: HelpRequirement }

// Each milestone describes an actual operation. The linked docs remain the full guide.
// Keep existing milestone IDs stable so expanding the checklist preserves progress.
export const helpChecklist = [
  { id: 'welcome', stage: 'start', topic: 'welcome', get label() { return t('认识工作区'); }, get hint() { return t('从侧栏打开一篇文档；底部可在工作区和主页之间切换。'); } },
  { id: 'empty-document', stage: 'start', topic: 'empty-document', get label() { return t('写下第一段内容'); }, get hint() { return t('点击正文写一句话，内容会自动保存在当前工作区。'); }, requires: 'document-write' },
  { id: 'create-document', stage: 'start', topic: 'welcome', get label() { return t('新建一篇文档'); }, get hint() { return t('在文件树空白处或文件夹上右键，选择「新建文档」。'); }, requires: 'workspace-write' },
  { id: 'rename-document', stage: 'start', topic: 'document', get label() { return t('给文档起个名字'); }, get hint() { return t('点击页面标题改名，或在文件树右键文档选择「重命名」。'); }, requires: 'workspace-write' },
  { id: 'heading', stage: 'writing', topic: 'empty-document', get label() { return t('用标题分清层次'); }, get hint() { return t('在空白段落输入 / 选择标题，或在行首输入 # 和空格。'); }, requires: 'document-write' },
  { id: 'bold', stage: 'writing', topic: 'empty-document', get label() { return t('强调重点文字'); }, get hint() { return t('选中文字，在浮动工具栏中加粗；也可用 **包住重点**。'); }, requires: 'document-write' },
  { id: 'bullet-list', stage: 'writing', topic: 'empty-document', get label() { return t('列一份清单'); }, get hint() { return t('在行首输入 - 和空格；按 Enter 继续添加下一项。'); }, requires: 'document-write' },
  { id: 'ordered-list', stage: 'writing', topic: 'empty-document', get label() { return t('按顺序写步骤'); }, get hint() { return t('在行首输入 1. 和空格，按步骤记录操作。'); }, requires: 'document-write' },
  { id: 'todo-list', stage: 'writing', topic: 'empty-document', get label() { return t('在正文记下待办'); }, get hint() { return t('输入 - [ ] 和空格创建正文待办；需要日期时可使用计划。'); }, requires: 'document-write' },
  { id: 'italic', stage: 'writing', topic: 'empty-document', get label() { return t('用斜体补充语气'); }, get hint() { return t('选中文字，在浮动工具栏中选择斜体，或用 *包住文字*。'); }, requires: 'document-write' },
  { id: 'quote', stage: 'structure', topic: 'empty-document', get label() { return t('引用一段文字'); }, get hint() { return t('在空白段落输入 / 选择引用，或在行首输入 > 和空格。'); }, requires: 'document-write' },
  { id: 'code-block', stage: 'structure', topic: 'source', get label() { return t('插入代码块'); }, get hint() { return t('在空白段落输入 / 选择代码块，再选择语言并填写代码。'); }, requires: 'document-write' },
  { id: 'inline-code', stage: 'structure', topic: 'source', get label() { return t('标注行内代码'); }, get hint() { return t('用一对反引号包住命令、文件名或短代码。'); }, requires: 'document-write' },
  { id: 'table', stage: 'structure', topic: 'empty-document', get label() { return t('用表格整理信息'); }, get hint() { return t('在空白段落输入 / 选择表格，再填写单元格和调整行列。'); }, requires: 'document-write' },
  { id: 'divider', stage: 'structure', topic: 'empty-document', get label() { return t('分隔不同主题'); }, get hint() { return t('在空白段落输入 / 选择分隔线，或在单独一行输入 ---。'); }, requires: 'document-write' },
  { id: 'external-link', stage: 'structure', topic: 'document', get label() { return t('附上参考链接'); }, get hint() { return t('选中文字后添加网页链接，或写 [文字](https://网址)。'); }, requires: 'document-write' },
  { id: 'image', stage: 'structure', topic: 'empty-document', get label() { return t('插入一张图片'); }, get hint() { return t('在空白段落输入 / 选择图片并填写地址；支持上传时也可粘贴或拖入图片。'); }, requires: 'document-write' },
  { id: 'footnote', stage: 'structure', topic: 'empty-document', get label() { return t('用脚注补充说明'); }, get hint() { return t('在源码模式写 [^1]，再在文末添加 [^1]: 说明。'); }, requires: 'document-write' },
  { id: 'create-folder', stage: 'organize', topic: 'document', get label() { return t('创建分类文件夹'); }, get hint() { return t('在文件树空白处或父文件夹上右键，选择「新建文件夹」。'); }, requires: 'workspace-write' },
  { id: 'move-document', stage: 'organize', topic: 'document', get label() { return t('把文档归入文件夹'); }, get hint() { return t('将文档拖到目标文件夹；打开的文档会跟随新位置。'); }, requires: 'workspace-write' },
  { id: 'duplicate-document', stage: 'organize', topic: 'document', get label() { return t('从副本尝试新想法'); }, get hint() { return t('在文件树右键文档，选择「创建副本」，再编辑复制的文档。'); }, requires: 'duplicate' },
  { id: 'document', stage: 'organize', topic: 'document', get label() { return t('连接相关文档'); }, get hint() { return t('输入 [[ 搜索并选择文档或对象；@ 用于提及人员和 Agent。'); }, requires: 'document-write' },
  { id: 'graph', stage: 'organize', topic: 'graph', get label() { return t('浏览关系图谱'); }, get hint() { return t('在文档「更多（⋯）」中选择「查看关系图谱」，浏览关联。'); } },
  { id: 'find', stage: 'reading', topic: 'find', get label() { return t('搜索并找到文档'); }, get hint() { return t('打开侧栏「查找文档」，按名称或已保存的正文搜索并打开结果。'); } },
  { id: 'reading', stage: 'reading', topic: 'reading', get label() { return t('通过大纲跳转'); }, get hint() { return t('从文档「更多（⋯）」打开目录，点击标题跳到对应段落。'); } },
  { id: 'page-find', stage: 'reading', topic: 'find', get label() { return t('定位页内关键词'); }, get hint() { return t('从文档「更多（⋯）」打开页内查找，输入关键词定位正文。'); } },
  { id: 'page-replace', stage: 'reading', topic: 'source', get label() { return t('替换一处文字'); }, get hint() { return t('在页内查找中展开替换，核对匹配文字后替换当前项。'); }, requires: 'document-write' },
  { id: 'source', stage: 'reading', topic: 'source', get label() { return t('切换源码模式'); }, get hint() { return t('点击文档工具栏的源码按钮查看 Markdown，再次点击返回编辑。'); } },
  { id: 'plan', stage: 'planning', topic: 'plan', get label() { return t('安排一个小计划'); }, get hint() { return t('打开侧栏计划，新增事项；创建前确认放在个人还是工作区。'); }, requires: 'plans' },
  { id: 'plan-date', stage: 'planning', topic: 'plan', get label() { return t('给计划安排时间'); }, get hint() { return t('打开事项详情，设置日期或起止时间，再在计划视图中查看。'); }, requires: 'plans' },
  { id: 'plan-description', stage: 'planning', topic: 'plan', get label() { return t('补充计划说明'); }, get hint() { return t('在事项详情补充说明，也可引用相关文档，留下行动背景。'); }, requires: 'plans' },
  { id: 'plan-complete', stage: 'planning', topic: 'plan', get label() { return t('完成一项待办'); }, get hint() { return t('将事项设为待办，完成工作后勾选；正文清单和计划分别记录。'); }, requires: 'plans' },
  { id: 'use-template', stage: 'workflow', topic: 'templates', get label() { return t('从模板开始一篇文档'); }, get hint() { return t('打开文档模板，预览内置或自定义模板后创建文档。'); }, requires: 'templates' },
  { id: 'save-template', stage: 'workflow', topic: 'templates', get label() { return t('保存自己的模板'); }, get hint() { return t('在文档模板中编辑并保存自定义模板，复用会议或周报结构。'); }, requires: 'templates' },
  { id: 'import-document', stage: 'workflow', topic: 'welcome', get label() { return t('导入已有内容'); }, get hint() { return t('从工作区菜单打开导入，选择文件并核对预览和目标目录。'); }, requires: 'import' },
  { id: 'export-document', stage: 'workflow', topic: 'source', get label() { return t('导出一篇文档'); }, get hint() { return t('在文档「更多（⋯）」中选择导出格式，将当前内容保存一份。'); } },
  { id: 'comment', stage: 'review', topic: 'comments', get label() { return t('留下文档评论'); }, get hint() { return t('在文档底部发表评论；讨论保留在当前工作区。'); }, requires: 'comments' },
  { id: 'annotation', stage: 'review', topic: 'comments', get label() { return t('为选中的文字加批注'); }, get hint() { return t('选中正文，通过浮动工具栏添加批注，让讨论指向具体文字。'); }, requires: 'comments' },
  { id: 'reply-comment', stage: 'review', topic: 'comments', get label() { return t('回复一条讨论'); }, get hint() { return t('在已有评论或批注下回复，继续同一条讨论。'); }, requires: 'comments' },
  { id: 'resolve-comment', stage: 'review', topic: 'comments', get label() { return t('解决一条批注'); }, get hint() { return t('处理批注后选择解决；需要继续讨论时可重新打开。'); }, requires: 'comments' },
  { id: 'plugins', stage: 'extensions', topic: 'plugins', get label() { return t('浏览插件中心'); }, get hint() { return t('从工作区导航打开插件，查看内置扩展和当前可用的插件。'); }, requires: 'plugins' },
  { id: 'plugin-details', stage: 'extensions', topic: 'plugins', get label() { return t('查看插件详情与权限'); }, get hint() { return t('打开插件详情，核对来源、能力和权限，再决定安装或授权。'); }, requires: 'plugins' },
  { id: 'strikethrough', stage: 'structure', topic: 'empty-document', get label() { return t('标记不再适用的文字'); }, get hint() { return t('用 ~~包住文字~~，保留原文并标出已取消的内容。'); }, requires: 'document-write' },
  { id: 'math', stage: 'structure', topic: 'empty-document', get label() { return t('写下公式'); }, get hint() { return t('在空白段落输入 / 选择公式，或在源码模式用 $ 和 $$ 编写公式。'); }, requires: 'math' },
  { id: 'mermaid', stage: 'structure', topic: 'source', get label() { return t('用 Mermaid 绘制图表'); }, get hint() { return t('插入代码块并选择 mermaid，填写图表语法后查看预览。'); }, requires: 'mermaid' },
  { id: 'folder-home', stage: 'organize', topic: 'folders', get label() { return t('打开文件夹首页'); }, get hint() { return t('有首页的文件夹点击名称打开首页，点击图标展开；默认首页是 README.md。'); }, requires: 'folder-home' },
  { id: 'child-document', stage: 'organize', topic: 'folders', get label() { return t('给文档添加子文档'); }, get hint() { return t('右键文档选择「新建子文档」；原文会成为文件夹首页，内容保留。'); }, requires: 'folder-conversion' },
  { id: 'flatten-folder', stage: 'organize', topic: 'folders', get label() { return t('将首页转回普通文档'); }, get hint() { return t('文件夹只剩首页时，右键选择「转为普通文档」。'); }, requires: 'folder-conversion' },
  { id: 'split-view', stage: 'reading', topic: 'reading', get label() { return t('并排查看文档'); }, get hint() { return t('打开两篇文档，将一个标签拖到正文区域边缘，预览分屏位置后松开。'); }, requires: 'panes' },
  { id: 'data-table', stage: 'workflow', topic: 'tables', get label() { return t('创建可筛选的数据表'); }, get hint() { return t('在文件树右键选择「新建数据表」，用字段和记录整理信息。'); }, requires: 'workspace-write' },
  { id: 'assistant', stage: 'assistant', topic: 'assistant', get label() { return t('打开同页助手'); }, get hint() { return t('点击页面右下角的助手入口，或从工作区导航进入助手。'); }, requires: 'assistant' },
  { id: 'assistant-connection', stage: 'assistant', topic: 'assistant', get label() { return t('配置模型连接'); }, get hint() { return t('在设置的助手页面添加 API 或本机 CLI 连接，再在会话中选择模型。'); }, requires: 'assistant-configure' },
  { id: 'assistant-question', stage: 'assistant', topic: 'assistant', get label() { return t('让助手回答一个问题'); }, get hint() { return t('选择连接和模型后发送问题并查看回答；浏览器演示使用模拟响应。'); }, requires: 'assistant' },
  { id: 'assistant-context', stage: 'assistant', topic: 'assistant', get label() { return t('带着参考内容提问'); }, get hint() { return t('在助手中添加文档或数据表作为参考，再发送与这些内容有关的问题。'); }, requires: 'assistant' },
  { id: 'suggestion-mode', stage: 'review', topic: 'suggestions', get label() { return t('尝试建议编辑'); }, get hint() { return t('在文档「更多（⋯）」选择「建议编辑」；修改会保留为建议，接受前正文不变。'); }, requires: 'suggestions' },
  { id: 'accept-suggestion', stage: 'review', topic: 'suggestions', get label() { return t('审阅并接受一处修改'); }, get hint() { return t('核对建议卡片中的原文和修改，确认后点击接受，将这一处写入正文。'); }, requires: 'suggestions' },
] as const satisfies readonly HelpStep[];
export type HelpChecklistId = typeof helpChecklist[number]['id'];
export interface HelpLessonCursor { stage: HelpStageId; first: HelpChecklistId }

export function isHelpStepAvailable(step: typeof helpChecklist[number], availability: HelpAvailability = {}) {
  return !('requires' in step) || availability[step.requires] !== false;
}

export function selectHelpLesson(completed: readonly HelpChecklistId[], context: HelpContext,
  availability: HelpAvailability = {}, current?: HelpLessonCursor) {
  const available = (step: typeof helpChecklist[number]) => isHelpStepAvailable(step, availability);
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
    assistant: 'assistant', tables: 'workflow', plan: 'planning', plugins: 'extensions', graph: 'organize', reading: 'reading', source: 'reading',
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
