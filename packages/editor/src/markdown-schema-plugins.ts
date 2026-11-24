import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { tableBreaksRemark } from './table-markdown';
import { codeBlankLinesRemark } from './code-blank-lines';
import { listMarkdown } from './list-markdown';
import { textStyles } from './text-styles';
import { wikiLink, wikiLinkRemark } from './wiki-link';
import { mathRemark, inlineMath, blockMath } from './math';
import { enhanced } from './enhanced';
import { references } from './references';
import { rawBlocks } from './raw-block';
import { liveSource, liveInlineSource } from './live-source';
import { nestedEmphasisRemark } from './nested-emphasis';

export interface MarkdownSchemaPluginSlots {
  commonmark: readonly MilkdownPlugin[];
  gfm: readonly MilkdownPlugin[];
  beforeGfm?: readonly MilkdownPlugin[];
  afterGfm?: readonly MilkdownPlugin[];
  afterWikiLink?: readonly MilkdownPlugin[];
  afterMathRemark?: readonly MilkdownPlugin[];
  afterReferences?: readonly MilkdownPlugin[];
  afterMathNodes?: readonly MilkdownPlugin[];
}

/**
 * Canonical ordered Tano Markdown schema & remark plugin sequence shared by
 * both the headless codec and the interactive MarkdownEditor shell so syntax
 * rules and node schemas cannot drift.
 */
export function composeMarkdownSchemaPlugins(slots: MarkdownSchemaPluginSlots): MilkdownPlugin[] {
  return [
    ...tableBreaksRemark,
    ...slots.commonmark,
    ...codeBlankLinesRemark,
    ...listMarkdown,
    ...(slots.beforeGfm ?? []),
    ...slots.gfm,
    ...(slots.afterGfm ?? []),
    ...textStyles,
    ...wikiLinkRemark,
    ...wikiLink,
    ...(slots.afterWikiLink ?? []),
    ...mathRemark,
    ...(slots.afterMathRemark ?? []),
    ...enhanced,
    ...references,
    ...(slots.afterReferences ?? []),
    ...rawBlocks,
    ...liveSource,
    ...liveInlineSource,
    ...nestedEmphasisRemark,
    ...inlineMath,
    ...blockMath,
    ...(slots.afterMathNodes ?? []),
  ];
}
