# AI Research · File-Native Workspace

这是一份 Tano 的端到端示例工作区，用来展示同一组真实文件如何被人类界面、结构化对象和 Agent 共同使用。

## 文件入口

- [研究笔记](papers/research-note.md)：Markdown 内容事实源，链接到论文、图像、CSV、JSON 和代码。
- [实验数据](data/experiments.csv)：可被外部工具直接打开的 CSV。
- [实验元数据](data/metadata.json)：普通 JSON 文件，不复制到对象数据库。
- [训练脚本](code/train.py)：普通 Python 文件。
- [架构图](assets/architecture.png)：图片资产。
- [研究论文](papers/methods.pdf)：PDF 资产。
- [实验表](data/experiments.table.json)：Tano 数据表，记录和视图仍保存在用户文件中。

## Tano 语义入口

- `.tano/objects/d4e5f6.tano.json`：`AI Research` 事件对象，作为研究工作流的稳定语义入口。
- `.tano/relations.tano-relations.json`：把事件对象连接到笔记、论文、架构图、CSV、JSON 和代码文件。
- `.tano/views/ai-research.tano.json`：研究视图定义，只保存稳定文件 ID 和对象 ID，不保存文件正文；它为跨文件投影提供可重建的来源清单。

体验路径：打开 `papers/research-note.md` → 在文件菜单选择「查看文件对象」→ 查看 `AI Research` 的关联 → 从工作区菜单打开「AI Research 工作台」视图 → 点击来源卡片回到原始文件或对象。

所有内容都在普通文件中。`.tano/` 只携带身份、对象、关系和视图元数据；外部修改仍由文件 revision 和冲突机制保护。

## Phase 1 验收

直接点击 CSV、JSON、Python、PDF 和图片文件即可预览。右键论文选择「文件属性」，可以看到 `.tano/files/222222.tano.json` 中的标签和属性；将论文移动或重命名后，这些元数据和研究视图来源仍绑定 `222222`。

用外部编辑器更新文件后回到 Tano，检查刷新后的内容。全局标签与属性存放在 `.tano/files/`，普通 JSON/CSV 继续保持原格式；本阶段预览为只读，不运行代码或 CSV 公式。完整数据契约与边界见 [Workspace Contract v1](../../../docs/zh/workspace-contract.md)。

## 文件数据库

打开工作区视图“研究文件数据库”，可直接查询本目录的原始文件。论文已附带负责人、状态和标签；点击“编辑属性”可以修改属性并关联对象。筛选、排序及分组可保存为便携视图。

## 对象数据库

从工作区菜单打开「研究对象数据库」，在表格、看板、画廊之间切换。项目、任务、实验均为独立 JSON 记录；项目通过 contains 关系连接任务与实验。修改状态会更新同一条记录，切换视图不会复制数据。
