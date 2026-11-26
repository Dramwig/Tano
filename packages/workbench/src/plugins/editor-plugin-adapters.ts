import {
  pluginRecord,
  type Workspace,
} from '@tano/protocol';
import type { ExternalSlashCommand } from '@tano/editor/slash-commands';
import type {
  ExternalCodeBlockRenderer,
  ExternalEditorDecoration,
} from '@tano/editor/external-decorations';
import { createPluginUiSandbox } from './ui-sandbox';
import type { useWorkspaceStore } from '../stores/workspace';

export function createEditorPluginAdapters(
  getStore: () => ReturnType<typeof useWorkspaceStore>,
  getWorkspace: () => Workspace | null,
) {
  const codeBlockRendererCache = new Map<
    string,
    { source: readonly unknown[]; list: ExternalCodeBlockRenderer[] }
  >();

  function editorPluginSlashCommands(fileId: string): ExternalSlashCommand[] {
    const ws = getWorkspace();
    const store = getStore();
    if (!ws) return [];
    return store.pluginSlashCommands.map((cmd) => ({
      id: cmd.key,
      label: cmd.label,
      marker: cmd.pluginName,
      keywords: [...(cmd.keywords ?? []), cmd.pluginName, cmd.id].join(' '),
      description: cmd.description,
      execute: () => {
        void store
          .interactWithPlugin({
            workspaceId: ws.id,
            pluginId: cmd.pluginId,
            instanceId: cmd.instanceId,
            kind: 'command',
            name: cmd.command,
            payload: { workspaceId: ws.id, fileId, source: 'slash' },
          })
          .catch((error) => store.report(String(error)));
      },
    }));
  }

  function editorPluginDecorations(fileId: string): ExternalEditorDecoration[] {
    const ws = getWorkspace();
    const store = getStore();
    if (!ws) return [];
    return store.pluginDecorationsFor(fileId).map((item) => ({
      key: item.key,
      from: item.from,
      to: item.to,
      tone: item.tone,
      badge: item.badge,
      tooltip: item.tooltip,
      ...(item.command
        ? {
            onClick: () => {
              void store
                .interactWithPlugin({
                  workspaceId: ws.id,
                  pluginId: item.pluginId,
                  instanceId: item.instanceId,
                  kind: 'command',
                  name: item.command!,
                  payload: {
                    workspaceId: ws.id,
                    fileId,
                    source: 'decoration',
                    decorationId: item.id,
                    from: item.from,
                    to: item.to,
                  },
                })
                .catch((error) => store.report(String(error)));
            },
          }
        : {}),
    }));
  }

  function editorPluginCodeBlockRenderers(fileId: string): ExternalCodeBlockRenderer[] {
    const ws = getWorkspace();
    const store = getStore();
    const source = store.pluginCodeBlockRenderers;
    if (!ws || !source.length) return [];
    const cacheKey = `${ws.id}:${fileId}`;
    const cached = codeBlockRendererCache.get(cacheKey);
    if (cached && cached.source === source) return cached.list;
    const list: ExternalCodeBlockRenderer[] = source.map((renderer) => ({
      id: `${renderer.key}:${renderer.instanceId}`,
      languages: renderer.languages,
      label: renderer.label ?? renderer.pluginName,
      height: renderer.height,
      mount(container, context) {
        const workspaceId = ws.id;
        const diagnostic = (level: string, message: string) => {
          void store
            .interactWithPlugin({
              workspaceId,
              pluginId: renderer.pluginId,
              instanceId: renderer.instanceId,
              name: renderer.view,
              kind: 'diagnostic',
              payload: { level, message },
            })
            .catch(() => {});
        };
        const buildState = (ctx: { language: string; source: string; readonly: boolean }) => ({
          kind: 'codeBlock',
          fileId,
          language: ctx.language,
          source: ctx.source,
          readonly: ctx.readonly,
        });
        const sandbox = createPluginUiSandbox(
          container,
          renderer.bundle,
          buildState(context),
          async (payload) => {
            if (
              pluginRecord(payload) &&
              payload.type === 'codeBlock.updateSource' &&
              typeof payload.source === 'string' &&
              payload.source.length <= 200 * 1024 &&
              !context.readonly
            ) {
              context.updateSource(payload.source);
              return;
            }
            await store.interactWithPlugin({
              workspaceId,
              pluginId: renderer.pluginId,
              instanceId: renderer.instanceId,
              name: renderer.view,
              kind: 'message',
              payload: { fileId, language: context.language, payload },
            });
          },
          (cause) => {
            diagnostic('error', cause);
          },
          diagnostic,
        );
        return {
          update(nextContext) {
            sandbox.update(buildState(nextContext));
          },
          dispose() {
            sandbox.dispose();
          },
        };
      },
    }));
    codeBlockRendererCache.set(cacheKey, { source, list });
    if (codeBlockRendererCache.size > 32) {
      codeBlockRendererCache.delete(codeBlockRendererCache.keys().next().value!);
    }
    return list;
  }

  return {
    editorPluginSlashCommands,
    editorPluginDecorations,
    editorPluginCodeBlockRenderers,
  };
}
