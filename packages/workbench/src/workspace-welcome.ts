import type { Workspace, WorkspaceAdapter } from '@tano/protocol';
import { isWorkspaceInternalPath, pathKey } from '@tano/protocol';

export const workspaceWelcomePath = '开始使用.md';

export function workspaceWelcomeContent(mode: WorkspaceAdapter['mode']): string {
  const storage = mode === 'web'
    ? '这是一个在线工作区，文档会自动保存到服务器，请联网使用。'
    : mode === 'demo'
      ? '这是浏览器演示，数据仅保存在本浏览器中，不会保存到本地文件夹或同步到服务器。'
      : '这是一个本地工作区，文档会自动保存到这台设备的文件夹中。本地模式未启用网络同步与在线协作。';
  return `# 从这一页开始

👋 欢迎来到 **<span style="color: #15803d">Tano / 同页</span>**！

一个留给思考、记录，和一起工作的伙伴的地方。

${storage}

## 试着完成这几个小步骤

- [ ] 点击这段文字，写下今天的第一个想法。
- [ ] 选中几个字，试试**加粗**、*斜体*，或在工具栏的「文字样式」中选择<span style="color: #2563eb">文字颜色</span>。
- [ ] 点击左侧工作区名称旁的「新建文档」按钮，创建你的第一篇笔记。
- [ ] 点击侧栏的搜索按钮，查找刚刚写下的内容。
- [ ] 勾选一个方框，记录你已经完成的步骤。

## 让想法自然成形

在空白行输入\`#\`后按空格创建标题，输入\`-\`后按空格开始列表，输入\`>\`后按空格写一段引用。输入\`/\`，从菜单中选择要插入的内容。

> 不必一次写完。<span style="color: #7c3aed">先记录，再慢慢整理。</span>

下面是一份可以直接修改的小计划：

| 想做的事 | 下一步 |
| --- | --- |
| 整理一个想法 | 写下问题与线索 |
| 开始一个项目 | 记下目标与第一步 |
| 和伙伴一起工作 | 留下清楚的背景与进展 |

## 找到你的下一页

- 用左侧文档列表打开笔记，也可以右键重命名、移动或删除文档。
- 点击编辑器右上角的「切换源码模式」按钮，可以查看 Markdown。
- 点击左下角的工作区名称，可以切换工作区。
- 电脑上用 **Ctrl + N** 新建文档，**Ctrl + K** 查找文档；Mac 上使用 **⌘**。

---

这是一篇普通的 Markdown 文档。你可以修改、重命名或删除它，换成自己的内容。

**人与 Agent，在同一页工作。**
`;
}

/** Called only when a workspace is created; ordinary opens never replenish deleted guides. */
export async function addWorkspaceWelcome(adapter: WorkspaceAdapter, workspace: Workspace): Promise<Workspace> {
  if (workspace.readOnly || workspace.files.some(file => !isWorkspaceInternalPath(file.path))) return workspace;
  try {
    // Adapter creation must be exclusive, so a concurrent edit is never overwritten.
    await adapter.create(workspaceWelcomePath, workspaceWelcomeContent(adapter.mode));
  } catch (error) {
    const current = await adapter.refresh();
    if (!current.files.some(file => file.kind === 'file' && pathKey(file.path) === pathKey(workspaceWelcomePath))) throw error;
    return current;
  }
  return adapter.refresh();
}
