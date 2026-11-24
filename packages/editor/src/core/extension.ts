import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';

/** A host-owned editing behavior. The editor never imports its implementation. */
export interface EditorExtension {
  plugins: MilkdownPlugin[];
  bind(ctx: Ctx, changed: (markdown: string) => void): () => void;
  apply(ctx: Ctx, markdown: string, options?: { addToHistory: boolean }): void;
  updateMetadata(markdown: string): void;
  /** Extensions owning history provide their own commands; local history stays isolated. */
  ownsHistory?: boolean;
  /** End a host-owned undo group around a standalone editor action. */
  stopHistoryCapture?(ctx: Ctx): void;
}
