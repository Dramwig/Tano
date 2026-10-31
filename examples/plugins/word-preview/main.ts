import type { TanoPluginApi } from '@tano/workbench/plugin-sdk';

export default async function activate(tano: TanoPluginApi) {
  let generation = 0;
  let current: { fileId: string; revision: string; token: number } | undefined;
  let imported: { id: string; token: number; offset: number } | undefined;
  let acknowledgment: { token: number; offset: number; resolve: () => void } | undefined;
  const header = (title = 'Word 文档预览', page = 0, count = 0, detail = '') => tano.views.setHeader('document', {
    ...(count && detail ? { previewInfo: { label: '只读预览', detail: detail.slice(0, 2000) } } : {}),
    title, status: count ? `${page} / ${count}` : '', statusAfter: 'previous', actions: [
      { id: 'open', label: '打开 DOC/DOCX', icon: 'open', accept: '.doc,.docx', group: '文件' },
      { id: 'previous', label: '上一页', icon: 'previous', disabled: page <= 1 },
      { id: 'next', label: '下一页', icon: 'next', disabled: !count || page >= count },
      { id: 'minus', label: '缩小', icon: 'minus', disabled: !count, group: '预览缩放' },
      { id: 'fit', label: '适应宽度', icon: 'fit', disabled: !count, group: '预览缩放' },
      { id: 'plus', label: '放大', icon: 'plus', disabled: !count, group: '预览缩放' },
      { id: 'license', label: '预览说明与许可', icon: 'info', group: '说明' },
    ],
  });
  await header();
  await tano.views.renderCustom('document', { idle: true });
  tano.views.onMessage('document', async message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'header') {
      if (message.token !== generation) return;
      await header(String(message.title).slice(0, 200), Number(message.page), Number(message.count), typeof message.note === 'string' ? message.note : ''); return;
    }
    if (message.type === 'received') {
      if (acknowledgment?.token === message.token && acknowledgment.offset === message.offset) acknowledgment.resolve();
      return;
    }
    if (message.type === 'header-action') {
      await tano.views.renderCustom('document', { action: message.action, nonce: Date.now() }); return;
    }
    if (message.type === 'header-file-start' && message.action === 'open' && typeof message.transferId === 'string') {
      current = undefined; imported = { id: message.transferId, token: ++generation, offset: 0 };
      await header(String(message.name).slice(0, 200));
      await tano.views.renderCustom('document', { loading: true, token: imported.token }); return;
    }
    if (message.type === 'header-file-error' && imported?.id === message.transferId) {
      await tano.views.renderCustom('document', { error: String(message.error), token: imported.token }); imported = undefined; return;
    }
    if (message.type === 'header-file') {
      if (message.action !== 'open' || typeof message.chunk !== 'string' || typeof message.transferId !== 'string' || typeof message.offset !== 'number') return;
      if (message.offset === 0 && imported?.id !== message.transferId) { current = undefined; imported = { id: message.transferId, token: ++generation, offset: 0 }; }
      const active = imported;
      if (!active || active.id !== message.transferId || active.offset !== message.offset) return;
      const length = atob(message.chunk).length;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { acknowledgment = undefined; reject(new Error('文件传输超时')); }, 10000);
        acknowledgment = { token: active.token, offset: active.offset + length, resolve: () => { clearTimeout(timer); acknowledgment = undefined; resolve(); } };
        void tano.views.renderCustom('document', { ...message, path: message.name, token: active.token, imported: true }).catch(error => { clearTimeout(timer); acknowledgment = undefined; reject(error); });
      });
      active.offset += length; return;
    }
    if (!current || message.token !== current.token) return;
    const active = current;
    try {
      const chunk = await tano.attachments.read(active.fileId, Number(message.offset), active.revision);
      if (current === active) await tano.views.renderCustom('document', { ...chunk, token: active.token });
    } catch (error) {
      if (current === active) await tano.views.renderCustom('document', { error: String(error), token: active.token });
    }
  });
  await tano.commands.register('open', async context => {
    const token = ++generation;
    current = undefined; imported = undefined;
    await header();
    await tano.views.renderCustom('document', context?.fileId ? { loading: true, token } : { idle: true, token });
    await tano.views.open('document');
    if (!context?.fileId) return;
    try {
      const chunk = await tano.attachments.read(context.fileId);
      if (token !== generation) return;
        if (!/\.docx?$/i.test(chunk.path)) throw new Error('请选择 DOC 或 DOCX 文件');
      current = { fileId: context.fileId, revision: chunk.revision, token };
      await tano.views.renderCustom('document', { ...chunk, token });
    } catch (error) { if (token === generation) await tano.views.renderCustom('document', { error: String(error), token }); }
  });
}
