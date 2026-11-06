import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';

/** Configure an isolated example through the editor's real folding plugin. */
export function prepareEditorPreview(ctx: Ctx, options: { folded?: boolean }) {
  const view = ctx.get(editorViewCtx);
  if (options.folded !== undefined) {
    const plugin = view.state.plugins.find(plugin => 'key' in plugin && typeof plugin.key === 'string' && plugin.key.startsWith('tano-folding$'));
    const node = view.state.doc.firstChild;
    if (plugin && node?.type.name === 'heading') {
      const key = `0:heading:${node.textContent.slice(0, 80)}`;
      if ((plugin.getState(view.state) as Set<string>).has(key) !== options.folded)
        view.dispatch(view.state.tr.setMeta(plugin, key).setMeta('addToHistory', false));
    }
  }
}
