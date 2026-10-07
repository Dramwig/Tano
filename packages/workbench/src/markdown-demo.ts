import { basename, resolveWorkspaceReference, safeRemoteImage } from '@tano/protocol';
import { DemoAdapter } from './adapter';
import type { AttachmentService } from './attachments';
import { defineComponent, h } from 'vue';
import MarkdownDemoStatus from './components/MarkdownDemoStatus.vue';
import { markdownDemoWorkspaceId, type MarkdownDemoLocale } from './markdown-demo-routes';
import { markdownDemoWorkspaces } from './markdown-demo-content';

/** Distinct caches preserve both languages' edits and all older demo drafts. */
export function markdownDemoStorageKey(locale: MarkdownDemoLocale) {
  return `tano.demo.markdown.${locale}.v1`;
}

export function createMarkdownDemoStatus(locale: MarkdownDemoLocale) {
  return defineComponent({ setup: () => () => h(MarkdownDemoStatus, { locale }) });
}

export function createMarkdownDemo(
  locale: MarkdownDemoLocale = 'zh-cn',
  files: Record<string, string> = markdownDemoWorkspaces[locale],
) {
  const english = locale === 'en-us';
  const workspaceId = markdownDemoWorkspaceId(locale);
  const adapter = new DemoAdapter({
    files,
    storageKey: markdownDemoStorageKey(locale),
    workspaceId,
    name: english ? 'Markdown QA Workspace' : 'Markdown 功能验收工作区',
    workspacePath: english ? 'English demo · Saved only in this browser' : '中文演示 · 数据仅保存在本浏览器',
  });
  const urls = new Map<string, { content: string; url: string }>();
  function resourceUrl(path: string) {
    const resource = adapter.resource(path);
    if (!resource) return null;
    const cached = urls.get(resource.id);
    if (cached?.content === resource.content) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const encoded = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(resource.content);
    const bytes = encoded
      ? Uint8Array.from(atob(encoded[2]!), char => char.charCodeAt(0))
      : new TextEncoder().encode(resource.content);
    const url = URL.createObjectURL(new Blob([bytes], { type: encoded?.[1] ?? 'text/plain;charset=utf-8' }));
    urls.set(resource.id, { content: resource.content, url });
    return url;
  }
  const attachments: AttachmentService = {
    imageUrl(workspace, documentPath, reference) {
      const remote = safeRemoteImage(reference);
      if (remote) return remote;
      if (!workspace || workspace.id !== workspaceId) return null;
      const path = resolveWorkspaceReference(documentPath, reference);
      return path && workspace.files.some(file => file.path === path && file.kind === 'file')
        ? resourceUrl(path) : null;
    },
    async importAttachment() {
      throw new Error(english ? 'The browser demo includes bundled attachments. Use the desktop app to import new files.' : '浏览器演示仅提供内置附件；导入新附件请使用桌面版');
    },
    async exportAttachment(workspaceId, path) {
      const url = workspaceId === markdownDemoWorkspaceId(locale) && resourceUrl(path);
      if (!url) throw new Error(english ? 'The sample attachment no longer exists' : '示例附件已不存在');
      const link = document.createElement('a');
      link.href = url;
      link.download = basename(path);
      document.body.append(link);
      link.click();
      link.remove();
    },
  };
  return { adapter, attachments };
}
