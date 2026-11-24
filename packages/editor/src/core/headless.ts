import { Clock, Container, Ctx } from '@milkdown/kit/ctx';
import type { MilkdownPlugin, TimerType } from '@milkdown/kit/ctx';
import {
  Editor,
  init,
  config,
  schema,
  parser,
  serializer,
  parserCtx,
  serializerCtx,
  editorViewCtx,
} from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import {
  schema as commonmarkSchema,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkMarker,
  remarkPreserveEmptyLinePlugin,
} from '@milkdown/kit/preset/commonmark';
import { schema as gfmSchema, remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import { configureMarkdownSchema } from '../markdown/schema';
import { composeMarkdownSchemaPlugins } from '../markdown/markdown-schema-plugins';
import { splitFrontmatter, unsupportedMarkdown } from '../markdown/syntax';
import { projectCommentText } from './comment-projection';
import { makeCommentAnchor } from './comment-anchors';
import type { CommentAnchor } from '@tano/protocol';
import { configureMarkdownRuntime, defaultCapabilities } from './runtime';
import type { WorkspaceCapabilities } from './runtime';

// Milkdown's default clock uses browser-global events. This context supplies a
// per-instance promise clock; parsing needs neither a DOM nor an EditorView.
class HeadlessContext extends Ctx {
  private gates = new Map<symbol, { promise: Promise<void>; resolve: () => void }>();
  private gate(timer: TimerType) {
    let gate = this.gates.get(timer.id);
    if (!gate) {
      let resolve!: () => void;
      gate = {
        promise: new Promise<void>((done) => {
          resolve = done;
        }),
        resolve: () => resolve(),
      };
      this.gates.set(timer.id, gate);
    }
    return gate;
  }
  override readonly wait = (timer: TimerType) => this.gate(timer).promise;
  override readonly done = (timer: TimerType) => {
    this.gate(timer).resolve();
  };
}

export async function createHeadlessMarkdown(policy: WorkspaceCapabilities = defaultCapabilities) {
  const ctx = new HeadlessContext(new Container(), new Clock());
  configureMarkdownRuntime(ctx, () => policy);
  const plugins: MilkdownPlugin[] = [
    schema,
    parser,
    serializer,
    init(Editor.make()),
    config(configureMarkdownSchema),
    ...composeMarkdownSchemaPlugins({
      commonmark: commonmarkSchema,
      gfm: gfmSchema,
      afterGfm: [
        ...remarkAddOrderInListPlugin,
        ...remarkInlineLinkPlugin,
        ...remarkLineBreak,
        ...remarkHtmlTransformer,
        ...remarkMarker,
        ...remarkPreserveEmptyLinePlugin,
        ...remarkGFMPlugin,
      ],
    }),
  ];
  const runners = plugins.map((plugin) => plugin(ctx));
  const cleanups = await Promise.all(runners.map((run) => run()));
  // The paragraph serializer only reads view.state.doc.lastChild to distinguish
  // a trailing empty paragraph. Supply that read-only state, without a DOM view.
  let serializing: Node | undefined;
  ctx.inject(editorViewCtx, {
    get state() {
      return { doc: serializing };
    },
  } as EditorView);
  ctx.update(serializerCtx, (serialize) => (node) => {
    const previous = serializing;
    serializing = node;
    try {
      return serialize(node);
    } finally {
      serializing = previous;
    }
  });
  return {
    mentionAnchors(markdown: string, baseHash: string) {
      const { body } = splitFrontmatter(markdown);
      const doc = ctx.get(parserCtx)(body);
      if (!doc) throw new Error('无法解析提及位置');
      const projection = projectCommentText(doc);
      const anchors = new Map<string, CommentAnchor>();
      doc.descendants((node, pos) => {
        if (node.type.name !== 'tano_reference' || !node.attrs.mentionId) return;
        const at = doc.resolve(pos);
        const parts = projection.segments.filter(part => part.proseFrom >= at.start() && part.proseTo <= at.end());
        if (!parts.length) return;
        const from = parts[0].from, to = parts.at(-1)!.to;
        if (!anchors.has(node.attrs.mentionId)) anchors.set(node.attrs.mentionId,
          makeCommentAnchor('prose', projection.text, [{ from, to, text: projection.text.slice(from, to) }], baseHash));
      });
      return anchors;
    },
    projectComments(markdown: string) {
      const { body } = splitFrontmatter(markdown);
      const node = ctx.get(parserCtx)(body);
      if (!node) throw new Error('无法解析批注文档');
      return projectCommentText(node).text;
    },
    normalize(markdown: string) {
      if (unsupportedMarkdown(markdown).length) throw new Error('此 Markdown 扩展暂不支持规范化');
      const { prefix, body } = splitFrontmatter(markdown);
      const node = ctx.get(parserCtx)(body);
      if (!node) throw new Error('Markdown 解析失败');
      return prefix + ctx.get(serializerCtx)(node);
    },
    withContext<T>(action: (ctx: Ctx) => T): T { return action(ctx); },
    async destroy() {
      ctx.remove(editorViewCtx);
      // Dispose schema consumers before their core slices.
      for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') await cleanup();
    },
  };
}
