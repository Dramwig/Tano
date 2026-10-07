---
# 编辑正文时应保留这条注释。
title: "字段格式测试：冒号: 与中文"
plain_text: 无引号文本
description: |
  多行字符串第一行。
  第二行保留换行。
folded: >
  折叠形式第一行
  折叠形式第二行。
count: 42
ratio: 3.14
enabled: true
disabled: false
empty: null
tags: [Markdown, "中文 标签", Agent]
list_block:
  - 第一项
  - 第二项
created: 2026-09-26
updated: 2026-09-26T10:30:00+08:00
date: 2026/09/26
created_at: 2026-09-26T09:00:00+08:00
updated_at: 2026-09-26T18:00:00+08:00
nested:
  owner: 测试者
  score: 100
items:
  - name: 文档
    done: true
  - name: 附件
    done: false
---

# YAML 属性字段

[English](../en-US/02-yaml-properties.md) · [导航](00-从这里开始.md)

展开文档属性，检查字符串、数字、布尔值、空值、数组、多行字符串和嵌套对象。对比日期字段与普通文本字段。任意 YAML 键不会自动获得专用业务 schema。

切换源码模式修改 `title` 或 `tags`，保存并重新打开，检查注释、引号、顺序和多行写法。只编辑正文时，不应静默丢弃顶部注释或改写属性值。

文档标题和文件名与 YAML 的 `title` 属性是不同内容，请分别检查操作结果。
