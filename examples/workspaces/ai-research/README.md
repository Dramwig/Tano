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
