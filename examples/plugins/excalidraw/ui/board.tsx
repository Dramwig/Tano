import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw, MainMenu, serializeAsJSON, exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { PluginJson, TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import { chunkSize, parseScene, sceneInMarkdown, sceneLimit, type BoardState, type Scene } from '../model';
import notices from '../THIRD_PARTY_NOTICES.txt';
import '@excalidraw/excalidraw/index.css';
import './style.css';

export default function mount(view: TanoPluginViewApi) {
  const listeners = new Set<(state: BoardState) => void>();
  let latest: BoardState;
  const unsubscribe = view.onState(state => { latest = state as unknown as BoardState; listeners.forEach(listener => listener(latest)); });
  const send = (message: PluginJson) => view.postMessage(message);
  function App() {
    const [state, setState] = useState<BoardState | undefined>(latest);
    const [loaded, setLoaded] = useState<{ scene: Scene; key: string }>();
    const [status, setStatus] = useState('请选择或新建白板');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [showNotices, setShowNotices] = useState(false);
    const api = useRef<ExcalidrawImperativeAPI | null>(null);
    const current = useRef<BoardState | undefined>(latest);
    const received = useRef({ revision: '', content: '' });
    const draft = useRef(''), saved = useRef(''), saving = useRef(false);
    const draftRevision = useRef('');
    const draftHash = useRef('');
    const operations = useRef(Promise.resolve());
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const file = useRef<HTMLInputElement | null>(null);
    const blocked = useRef(false);
    const handledRequest = useRef('');
    const save = useCallback(async () => {
      const baseline = current.current;
      if (saving.current || !baseline?.current || draftRevision.current !== baseline.revision || !draft.current || draft.current === saved.current || blocked.current) return;
      const content = draft.current, revision = baseline.revision;
      saving.current = true; setStatus('保存中…'); setError('');
      try {
        parseScene(content);
        await send({ type: 'begin', revision, baseHash: draftHash.current, length: content.length });
        for (let offset = 0; offset < content.length; offset += chunkSize) await send({ type: 'append', revision, offset, chunk: content.slice(offset, offset + chunkSize) });
        await send({ type: 'save', revision });
        if (current.current?.revision === revision) { saved.current = content; draftHash.current = current.current.hash ?? ''; setStatus('已保存到工作区'); }
      } catch (cause) {
        blocked.current = true;
        setError(String(cause)); setStatus('保存失败 · 可导出保留当前白板');
      } finally {
        saving.current = false;
        if (!blocked.current && current.current?.revision === revision && saved.current !== draft.current) timer.current = setTimeout(() => { void save(); }, 800);
      }
    }, []);
    useEffect(() => {
      let active = true;
      const listener = (next: BoardState) => {
        if (!active) return;
        current.current = next; setState(next);
        if (next.request && next.request.token !== handledRequest.current) {
          handledRequest.current = next.request.token;
          const request = next.request;
          void action(request.create ? { type: 'create' } : { type: 'open', id: request.id! });
        }
        if (!next.current || next.revision === received.current.revision && received.current.content.length === next.length) return;
        if (next.revision !== received.current.revision) {
          clearTimeout(timer.current); received.current = { revision: next.revision, content: '' }; setLoaded(undefined);
          draft.current = saved.current = ''; draftRevision.current = ''; api.current = null;
          setStatus('正在打开白板…'); setError(''); blocked.current = false;
        }
        if (next.offset !== received.current.content.length) return;
        received.current.content += next.chunk;
        if (received.current.content.length < next.length) {
          void send({ type: 'chunk', revision: next.revision, offset: received.current.content.length }).catch(cause => setError(String(cause)));
        } else {
          try {
            const scene = parseScene(received.current.content);
            saved.current = draft.current = JSON.stringify(scene);
            draftRevision.current = next.revision;
            draftHash.current = next.hash ?? '';
            setLoaded({ scene, key: next.revision }); setStatus('已保存到工作区');
          } catch (cause) { setError(String(cause)); }
        }
      };
      listeners.add(listener); if (latest) listener(latest);
      return () => { active = false; clearTimeout(timer.current); listeners.delete(listener); };
    }, []);
    function action(message: PluginJson) {
      const operation = operations.current.then(async () => {
        setBusy(true);
        try {
          while (saving.current) await new Promise(resolve => setTimeout(resolve, 20));
          clearTimeout(timer.current); await save();
          if (blocked.current) { setError('当前白板尚未保存。请先导出保留，再点击“重新打开”读取工作区版本。'); return; }
          setError(''); await send(message);
        } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
      });
      operations.current = operation; return operation;
    }
    function download(blob: Blob, name: string) {
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    const filename = () => (state?.current?.path.split('/').pop() ?? 'Drawing.excalidraw.md').replace(/\.md$/i, '');
    async function importFile(input: File) {
      if (input.size > sceneLimit) { setError('导入文件超过 240 KiB，请减少图片或元素后重试。'); return; }
      try {
        const text = await input.text(), scene = input.name.toLowerCase().endsWith('.md') ? sceneInMarkdown(text).scene : parseScene(text);
        await save(); if (blocked.current) throw new Error('当前白板尚未保存，请先导出。');
        const content = JSON.stringify(scene), revision = `import-${Date.now()}-${Math.random()}`;
        setBusy(true);
        await send({ type: 'begin-import', revision, length: content.length });
        for (let offset = 0; offset < content.length; offset += chunkSize) await send({ type: 'append', revision, offset, chunk: content.slice(offset, offset + chunkSize) });
        await send({ type: 'import', revision });
      } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
    }
    const onChange = useCallback<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>((elements, appState, files) => {
      if (!current.current?.current || appState.isLoading) return;
      let content: string;
      try { content = JSON.stringify(parseScene(serializeAsJSON(elements, appState, files, 'local'))); }
      catch (cause) { setError(String(cause)); setStatus('白板超过保存上限 · 请导出保留'); draft.current = serializeAsJSON(elements, appState, files, 'local'); return; }
      if (draft.current === content) return;
      draft.current = content;
      if (content === saved.current) return;
      setStatus('有未保存更改'); clearTimeout(timer.current);
      timer.current = setTimeout(() => { void save(); }, 800);
    }, [save]);
    return <main className="tano-drawing">
      <header className="drawing-toolbar">
        <strong>Excalidraw</strong>
        <select aria-label="选择白板" value={state?.current?.id ?? ''} disabled={busy || saving.current} onChange={event => { if (event.target.value) void action({ type: 'open', id: event.target.value }); }}>
          <option value="">选择白板…</option>
          {state?.drawings.map(drawing => <option key={drawing.id} value={drawing.id}>{drawing.path.split('/').pop()?.replace(/\.excalidraw\.md$/i, '')}</option>)}
        </select>
        <button disabled={busy} onClick={() => { void action({ type: 'create' }); }}>新建白板</button>
        <button disabled={busy} onClick={() => file.current?.click()}>导入</button>
        <input ref={file} hidden type="file" accept=".excalidraw,.json,.excalidraw.md" aria-label="导入 Excalidraw 文件" onChange={event => { const input = event.target.files?.[0]; event.target.value = ''; if (input) void importFile(input); }} />
        <button disabled={!loaded} onClick={() => download(new Blob([draft.current], { type: 'application/json' }), filename())}>导出 Excalidraw</button>
        <button disabled={!loaded} onClick={() => { const drawing = api.current; if (!drawing) return; void exportToBlob({ elements: drawing.getSceneElements(), appState: { ...drawing.getAppState(), exportBackground: true }, files: drawing.getFiles(), mimeType: 'image/png' }).then((blob: Blob) => download(blob, filename().replace(/\.excalidraw$/i, '.png'))).catch((cause: unknown) => setError(String(cause))); }}>导出 PNG</button>
        <button disabled={!loaded || busy} onClick={() => { void save(); }}>保存</button>
        <span role="status">{status}</span>
        <button className="license" onClick={() => setShowNotices(!showNotices)}>开源许可</button>
      </header>
      {(error || state?.error) && <div className="drawing-error" role="alert">{error || state?.error} {state?.current && <button onClick={() => { blocked.current = false; draft.current = saved.current; void action({ type: 'open', id: state.current!.id }); }}>重新打开</button>}</div>}
      {showNotices && <aside className="drawing-notices"><button onClick={() => setShowNotices(false)}>关闭</button><pre>{notices}</pre></aside>}
      {loaded ? <div className="drawing-canvas"><Excalidraw key={loaded.key} langCode="zh-CN" initialData={{ ...loaded.scene, scrollToContent: true } as unknown as React.ComponentProps<typeof Excalidraw>['initialData']} onChange={(elements, state, files) => { if (current.current?.revision === loaded.key) onChange(elements, state, files); }}
        excalidrawAPI={value => { api.current = value; }} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }} validateEmbeddable={false}>
        <MainMenu>
          <MainMenu.Item onSelect={() => file.current?.click()}>打开 Excalidraw 文件</MainMenu.Item>
          <MainMenu.Item onSelect={() => { void save(); }}>保存到工作区</MainMenu.Item>
          <MainMenu.DefaultItems.SearchMenu /><MainMenu.DefaultItems.Help />
          <MainMenu.Separator /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ToggleTheme /><MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw></div> : <section className="drawing-empty"><div className="drawing-symbol" aria-hidden="true">✎</div><h1>从一个想法开始</h1><p>用图形、箭头和手绘，把想法画在同一页。</p><button disabled={busy} onClick={() => { void action({ type: 'create' }); }}>新建白板</button><p className="drawing-hint">自动保存为 .excalidraw.md · 支持离线绘图</p></section>}
    </main>;
  }
  const root = createRoot(document.getElementById('app')!); root.render(<App />);
  addEventListener('pagehide', () => { root.unmount(); unsubscribe(); }, { once: true });
}
