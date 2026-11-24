import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import {
  confirmEntryReferenceDrop,
  droppedEntryReferences,
  entryReferenceDragType,
  referenceUrl,
  type ReferenceTarget,
} from '@tano/protocol';
import { commandEnabled } from '../core/document-model';
import type { WorkspaceCapabilities } from '../core/runtime';
import { containsEmbeddedImage } from './editor-clipboard';

export interface ImportedResource {
  url: string;
  name: string;
  image: boolean;
}

export interface EditorUploadsOptions {
  document: Document;
  getEditor: () => Editor | undefined;
  isDisposed: () => boolean;
  readonly: () => boolean;
  enabledLevels: () => readonly number[] | undefined;
  policy: () => WorkspaceCapabilities;
  referencesEnabled: () => boolean;
  referenceTargets: () => readonly ReferenceTarget[];
  importFile: () => ((file: File, requireImage: boolean) => Promise<ImportedResource>) | undefined;
  onError: (message: string) => void;
}

export const uploadsPluginKey = new PluginKey<DecorationSet>('tano-uploads');

export function createEditorUploads(options: EditorUploadsOptions) {
  const {
    document,
    getEditor,
    isDisposed,
    readonly,
    enabledLevels,
    policy,
    referencesEnabled,
    referenceTargets,
    importFile,
    onError,
  } = options;

  async function importInto(
    ctx: Ctx,
    view: EditorView,
    file: File,
    position: number,
    requireImage: boolean,
  ) {
    const importer = importFile();
    if (!importer || readonly()) return;
    const id = crypto.randomUUID();
    view.dispatch(
      view.state.tr
        .setMeta(uploadsPluginKey, { add: { id, position } })
        .setMeta('addToHistory', false),
    );
    try {
      const resource = await importer(file, requireImage);
      if (isDisposed() || readonly()) return;
      const placeholder = uploadsPluginKey
        .getState(view.state)
        ?.find(undefined, undefined, (spec) => spec.id === id)[0];
      if (!placeholder) throw new Error('插入位置已被删除；附件已保存在 assets 文件夹');
      const node = resource.image
        ? imageSchema.type(ctx).create({ src: resource.url, alt: resource.name })
        : commandEnabled('file', enabledLevels(), policy().features)
          ? view.state.schema.nodes.tano_file!.create({ title: resource.name, url: resource.url })
          : view.state.schema.text(resource.name, [
              view.state.schema.marks.link!.create({ href: resource.url }),
            ]);
      view.dispatch(
        view.state.tr
          .insert(placeholder.from, node)
          .setMeta(uploadsPluginKey, { remove: id })
          .scrollIntoView(),
      );
    } catch (error) {
      if (!isDisposed()) onError(String(error));
    } finally {
      if (!isDisposed()) {
        view.dispatch(
          view.state.tr.setMeta(uploadsPluginKey, { remove: id }).setMeta('addToHistory', false),
        );
      }
    }
  }

  function importFiles(files: File[]) {
    getEditor()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      for (const file of files.slice(0, 10)) {
        void importInto(ctx, view, file, view.state.selection.from, false);
      }
    });
  }

  const plugin = $prose(
    (ctx) =>
      new Plugin<DecorationSet>({
        key: uploadsPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, current) {
            let next = current.map(transaction.mapping, transaction.doc);
            const change = transaction.getMeta(uploadsPluginKey);
            if (change?.add) {
              const label = document.createElement('span');
              label.className = 'asset-upload-placeholder';
              label.textContent = '正在导入附件…';
              next = next.add(transaction.doc, [
                Decoration.widget(change.add.position, label, { id: change.add.id, side: -1 }),
              ]);
            }
            if (change?.remove) {
              next = next.remove(
                next.find(undefined, undefined, (spec) => spec.id === change.remove),
              );
            }
            return next;
          },
        },
        props: {
          decorations: (state) => uploadsPluginKey.getState(state),
          handleDOMEvents: {
            paste(view, event) {
              const files = Array.from(event.clipboardData?.files ?? []);
              const embeddedImage = containsEmbeddedImage(event.clipboardData);
              if ((!files.length && !embeddedImage) || readonly()) return false;
              event.preventDefault();
              if (!importFile()) {
                onError('当前工作区不能保存图片或附件，请在桌面工作空间中粘贴图片');
                return true;
              }
              if (!files.length) {
                onError('剪贴板没有提供可导入的图片文件，请先将图片保存为文件后再导入');
                return true;
              }
              for (const file of files.slice(0, 10)) {
                void importInto(
                  ctx,
                  view,
                  file,
                  view.state.selection.from,
                  file.type.startsWith('image/'),
                );
              }
              return true;
            },
            dragover(_view, event) {
              if (
                readonly() ||
                !referencesEnabled() ||
                !event.dataTransfer?.types.includes(entryReferenceDragType)
              ) {
                return false;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              return true;
            },
            drop(view, event) {
              if (event.dataTransfer?.types.includes(entryReferenceDragType)) {
                event.preventDefault();
                event.stopPropagation();
                if (readonly() || !referencesEnabled()) return true;
                const targets = droppedEntryReferences(
                  event.dataTransfer.getData(entryReferenceDragType),
                  referenceTargets(),
                );
                if (!targets.length) return true;
                const pos =
                  view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                  view.state.selection.from;
                const nodes = targets.flatMap((target, index) => [
                  ...(index ? [view.state.schema.text(' ')] : []),
                  view.state.schema.nodes.tano_reference!.create({
                    url: referenceUrl(target),
                    label: target.name,
                  }),
                ]);
                const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos)));
                view.dispatch(
                  tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView(),
                );
                confirmEntryReferenceDrop(event);
                view.focus();
                return true;
              }
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (!files.length || !importFile() || readonly()) return false;
              event.preventDefault();
              const pos =
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                view.state.selection.from;
              for (const file of files.slice(0, 10)) void importInto(ctx, view, file, pos, false);
              return true;
            },
          },
        },
      }),
  );

  return {
    plugin,
    importInto,
    importFiles,
  };
}
