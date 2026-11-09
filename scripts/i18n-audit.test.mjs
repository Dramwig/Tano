import { expect, it } from 'vitest';
import { auditI18n, inspectUiSource } from './i18n-audit.mjs';

it('rejects template text, attributes, ternaries and dynamic message keys', () => {
  const { issues } = inspectUiSource(`<script setup>t(\`错误：\${id}\`)</script>
    <template><button title="保存">标题{{ ok ? '完成' : t('取消') }}</button></template>`);
  expect(issues.map(issue => issue.kind)).toContain('dynamic');
  expect(issues.map(issue => issue.text)).toEqual(expect.arrayContaining(['保存', '标题', '完成']));
  expect(issues.map(issue => issue.text)).not.toContain('取消');
  expect(inspectUiSource('<template>{{ `当前分支 ${branch}` }}</template>').issues).toHaveLength(1);
});

it('permits explicit content examples and preserves interpolation expressions', () => {
  expect(inspectUiSource(`<template><Example markdown="中文正文" />{{ t('工作区 · {0}', [name]) }}
    <!-- i18n-ignore: Chinese brand name --><span>同页</span></template>`).issues).toEqual([]);
  expect(inspectUiSource("<template>{{ `${t('文件')} · ${name}` }}</template>").issues).toEqual([]);
});

it('keeps workbench and client templates translated and literal message keys covered', () => {
  const result = auditI18n();
  expect(result.issues).toEqual([]);
  expect(result.missing).toEqual([]);
}, 15000);
