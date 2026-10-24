import type { Ctx } from '@milkdown/kit/ctx';
import { isShortId } from '@tano/protocol';
import type { SelectionWrappingPreferences } from './selection-wrapping';
export { selectionWrap, selectionWrappingOptions, defaultSelectionWrapping, normalizeSelectionWrapping } from './selection-wrapping';
export type { SelectionWrappingPreferences } from './selection-wrapping';
export { workspaceCapabilityPath as capabilityPath } from '@tano/protocol';

export const featureDefinitions = [
  { key: 'objectReferences', label: 'Level 2 · 工作区对象与统一引用' },
  { key: 'math', label: '数学公式' },
  { key: 'mermaid', label: 'Mermaid 图表' },
  { key: 'wikiLink', label: 'Wiki Links / 文档提及' },
  { key: 'callout', label: '提示块' },
  { key: 'footnotes', label: '脚注' },
  { key: 'embed', label: '嵌入预览' },
  { key: 'html', label: 'HTML 预览' },
  { key: 'enhanced', label: '折叠、标签页、分栏与附件' },
  { key: 'superscript', label: '上标（扩展）' },
  { key: 'subscript', label: '下标（扩展）' },
  { key: 'underline', label: '下划线（扩展）' },
  { key: 'highlight', label: '高亮' },
  { key: 'inlineComment', label: '注释（扩展）' },
] as const;
export type DocumentFeature = (typeof featureDefinitions)[number]['key'];
export type DocumentFeatures = Record<DocumentFeature, boolean>;
export type MarkdownDialect = 'obsidian' | 'github' | 'pandoc' | 'commonmark';
export type MathSyntax = 'preserve' | 'dollar' | 'latex';
export type BulletListMarker = '-' | '+' | '*';
export interface WorkspaceCapabilities {
  version: 1;
  features: DocumentFeatures;
  markdownDialect: MarkdownDialect;
  mathSyntax: MathSyntax;
  bulletListMarker: BulletListMarker;
  /** Shared per-document layout keyed by the stable short file ID; absent means limited width. */
  pageWidthLimits: Record<string, boolean>;
}
export interface EditorPreferences {
  /** Device-local visual spacing; never inserts characters into Markdown. */
  autoSpacing?: boolean;
  previewMathWhileEditing: boolean;
  folding: boolean;
  /** Pressing Space in an empty paragraph opens the one-shot AI composer. */
  blankBlockAiShortcut: boolean;
  selectionWrapping?: SelectionWrappingPreferences;
}
export const defaultCapabilities: WorkspaceCapabilities = {
  version: 1,
  features: Object.fromEntries(
    featureDefinitions.map(({ key }) => [key, true]),
  ) as DocumentFeatures,
  markdownDialect: 'obsidian',
  mathSyntax: 'preserve',
  bulletListMarker: '*',
  pageWidthLimits: {},
};
export const defaultEditorPreferences: EditorPreferences = {
  autoSpacing: false,
  previewMathWhileEditing: true,
  folding: true,
  blankBlockAiShortcut: true,
};

/** Validate portable policy without discarding unknown fields from newer clients. */
export function parseCapabilities(content: string): WorkspaceCapabilities {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('工作区规则必须是 JSON 对象');
  const data = value as Record<string, unknown>;
  if (data.version !== undefined && data.version !== 1) throw new Error('不支持此工作区规则版本');
  const features = { ...defaultCapabilities.features };
  if (data.features !== undefined) {
    if (!data.features || typeof data.features !== 'object' || Array.isArray(data.features))
      throw new Error('features 必须是对象');
    for (const { key } of featureDefinitions) {
      const enabled = (data.features as Record<string, unknown>)[key];
      if (enabled !== undefined && typeof enabled !== 'boolean')
        throw new Error(`${key} 必须是布尔值`);
      if (typeof enabled === 'boolean') features[key] = enabled;
    }
  }
  const markdownDialect = data.markdownDialect ?? defaultCapabilities.markdownDialect;
  const mathSyntax = data.mathSyntax ?? defaultCapabilities.mathSyntax;
  const bulletListMarker = data.bulletListMarker ?? defaultCapabilities.bulletListMarker;
  if (!['obsidian', 'github', 'pandoc', 'commonmark'].includes(String(markdownDialect)))
    throw new Error('未知的 Markdown 方言');
  if (!['preserve', 'dollar', 'latex'].includes(String(mathSyntax)))
    throw new Error('未知的公式输出语法');
  if (!['-', '+', '*'].includes(bulletListMarker as string))
    throw new Error('未知的无序列表标记');
  const pageWidthLimits: Record<string, boolean> = {};
  if (data.pageWidthLimits !== undefined) {
    if (!data.pageWidthLimits || typeof data.pageWidthLimits !== 'object' || Array.isArray(data.pageWidthLimits))
      throw new Error('pageWidthLimits 必须是对象');
    for (const [id, limited] of Object.entries(data.pageWidthLimits)) {
      if (!isShortId(id) || typeof limited !== 'boolean')
        throw new Error('pageWidthLimits 必须以文档 ID 对应布尔值');
      pageWidthLimits[id] = limited;
    }
  }
  return {
    version: 1,
    features,
    markdownDialect: markdownDialect as MarkdownDialect,
    mathSyntax: mathSyntax as MathSyntax,
    bulletListMarker: bulletListMarker as BulletListMarker,
    pageWidthLimits,
  };
}

export const commandFeatures: Record<string, DocumentFeature> = {
  superscript: 'superscript', subscript: 'subscript', underline: 'underline',
  highlight: 'highlight', inline_comment: 'inlineComment',
  reference: 'objectReferences', 'object-reference': 'objectReferences',
  math: 'math',
  'math-block': 'math',
  mermaid: 'mermaid',
  mention: 'wikiLink',
  callout: 'callout',
  footnote: 'footnotes',
  embed: 'embed',
  toggle: 'enhanced',
  tabs: 'enhanced',
  columns: 'enhanced',
  file: 'enhanced',
};
export function featureEnabled(command: string, features = defaultCapabilities.features) {
  const feature = commandFeatures[command];
  return !feature || features[feature];
}

/** Device shortcuts cannot enable syntax disabled by the workspace. */
export function workspaceWrapping(options: Partial<SelectionWrappingPreferences> | undefined, features = defaultCapabilities.features) {
  const result = { ...options };
  for (const key of ['superscript', 'subscript', 'underline', 'highlight', 'math'] as const)
    if (!features[key]) result[key] = false;
  if (!features.inlineComment) result.comment = false;
  return result;
}

// Policy belongs to the codec instance, never to a process-wide current workspace.
const policies = new WeakMap<Ctx, () => WorkspaceCapabilities>();
export function configureMarkdownRuntime(ctx: Ctx, policy: () => WorkspaceCapabilities) {
  policies.set(ctx, policy);
}
export function markdownPolicy(ctx: Ctx) {
  return policies.get(ctx)?.() ?? defaultCapabilities;
}
export function newMathSyntax(policy: WorkspaceCapabilities) {
  return policy.mathSyntax === 'preserve'
    ? policy.markdownDialect === 'pandoc'
      ? 'latex'
      : 'dollar'
    : policy.mathSyntax;
}
