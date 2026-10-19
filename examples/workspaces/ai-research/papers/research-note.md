---
title: AI Research · 可复现实验笔记
status: active
---

# AI Research

这篇 Markdown 是研究项目的内容事实源。结构化关系由 `.tano/` 保存，但正文仍然可以被任何编辑器打开。

语义入口： [AI Research 对象](object://event/d4e5f6)

## 本轮问题

我们比较两种轻量模型在同一小型数据集上的召回率，并保留足够的上下文，让人和 Agent 都能回到原始材料。

## 原始材料

- 论文：[Methods PDF](methods.pdf)
- 运行结果：[experiments.csv](../data/experiments.csv)
- 实验元数据：[metadata.json](../data/metadata.json)
- 训练脚本：[train.py](../code/train.py)
- 系统图：[architecture.png](../assets/architecture.png)

## 当前结论

`model-a` 的召回率略高，但需要更多样本确认。下一步由 `AI Research` 事件对象跟踪，结果回写到实验表和本页。

## Agent 协作约定

Agent 先读取本页和被引用的真实文件，回答时带来源；需要修改时提交提案，用户审阅后再写回原始文件。文件路径可以变化，文件 ID 和 revision 才是引用依据。
