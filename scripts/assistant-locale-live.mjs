// Opt-in: uses the configured desktop API connection and synthetic documents only.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.TANO_LOCALE_EVAL_OUTPUT;
if (!output) throw new Error('Set TANO_LOCALE_EVAL_OUTPUT to an external evidence directory.');
await mkdir(output, { recursive: true });
const binary = resolve(root, 'apps/client/src-tauri/target/release/tano.exe');
const bundle = await build({ stdin: { contents: `
  export { runAssistant } from './packages/workbench/src/assistant/engine.ts';
  export { assistantTaskPrompts } from './packages/workbench/src/assistant/language.ts';
  export { nativeAssistantTransport } from './packages/workbench/src/assistant/transport.ts';`,
  resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'TanoLocaleEval', platform: 'browser' });
const child = spawn(binary, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: resolve(output, 'webview-profile'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=43849' } });
let browser;
try {
  const deadline = Date.now() + 60000;
  while (!browser && Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:43849'); }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!browser) throw new Error('Native WebView debug port unavailable.');
  const page = browser.contexts().flatMap(context => context.pages()).find(page => !page.url().includes('settingsOpener'));
  if (!page) throw new Error('Native main WebView unavailable.');
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  await page.evaluate(bundle.outputFiles[0].text);
  const metadata = await page.evaluate(async () => {
    const transport = TanoLocaleEval.nativeAssistantTransport();
    const connection = (await transport.connections()).find(item => !item.kind || item.kind === 'api');
    if (!connection) throw new Error('No configured API connection.');
    const models = await transport.models(connection.id, new AbortController().signal);
    return { connection: { id: connection.id, name: connection.name }, models };
  });
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify(metadata, null, 2));
  } else {
    const model = process.env.TANO_LOCALE_EVAL_MODEL;
    if (!model || !metadata.models.includes(model)) throw new Error('Choose an available TANO_LOCALE_EVAL_MODEL using --list.');
    const chinese = '项目将在周五发布。小林负责测试，小周负责文档。';
    const english = 'The project launches on Friday. Lin handles testing, and Zhou handles documentation.';
    const cases = [];
    for (const mode of ['inline', 'sidebar']) {
      for (const locale of ['zh-CN', 'en-US']) {
        cases.push({ id: `${mode}-${locale}-summary`, mode, locale, task: 'summary', content: locale === 'zh-CN' ? english : chinese });
        cases.push({ id: `${mode}-${locale}-user-language`, mode, locale, prompt: locale === 'zh-CN' ? 'Summarize this note in one sentence.' : '请用一句话总结这篇笔记。', content: locale === 'zh-CN' ? chinese : english });
        cases.push({ id: `${mode}-${locale}-japanese`, mode, locale, prompt: 'Summarize this note in Japanese in one sentence.', content: chinese });
        cases.push({ id: `${mode}-${locale}-polish`, mode, locale, prompt: 'Propose a polished version of this note, preserving its original language. Do not write it yet.', content: locale === 'zh-CN' ? english : chinese });
        cases.push({ id: `${mode}-${locale}-translate`, mode, locale, prompt: `Propose a translation of this note into ${locale === 'zh-CN' ? 'English' : 'Simplified Chinese'}. Do not write it yet.`, content: locale === 'zh-CN' ? chinese : english });
        cases.push({ id: `${mode}-${locale}-clarify`, mode, locale, task: 'startDraft', content: '' });
      }
    }
    const report = { model, connectionName: metadata.connection.name, startedAt: new Date().toISOString(),
      scope: 'Current frontend engine through the existing native API transport; synthetic sources, no writes or saved sessions.',
      implementation: {}, results: [] };
    for (const path of ['packages/workbench/src/assistant/prompts.ts', 'packages/workbench/src/assistant/task-prompts.json',
      'packages/workbench/src/assistant/engine.ts', 'packages/workbench/src/assistant/language.ts', binary]) {
      report.implementation[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
    }
    const caseArgument = process.argv.indexOf('--case');
    const selectedIds = caseArgument >= 0 ? process.argv[caseArgument + 1]?.split(',') : undefined;
    if (caseArgument >= 0 && (!selectedIds?.length || selectedIds.some(id => !cases.some(testCase => testCase.id === id))))
      throw new Error('Provide known comma-separated case IDs after --case.');
    const selectedCases = selectedIds ? cases.filter(testCase => selectedIds.includes(testCase.id)) : cases;
    if (!selectedCases.length) throw new Error('Unknown --case.');
    for (const testCase of selectedCases) {
      console.log(`RUN ${testCase.id}`);
      const result = await page.evaluate(async ({ testCase, model, connectionId }) => {
        const { runAssistant, assistantTaskPrompts, nativeAssistantTransport } = TanoLocaleEval;
        const native = nativeAssistantTransport();
        const result = { id: testCase.id, mode: testCase.mode, locale: testCase.locale, source: testCase.content, text: '', proposals: [], questions: [], requests: [] };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
          result.usage = await runAssistant({ transport: { ...native, request: async (id, request, signal, chunk) => {
            result.requests.push(structuredClone(request));
            return native.request(id, request, signal, chunk);
          } }, connectionId, model, tools: true, mode: testCase.mode, locale: testCase.locale,
          workspaceId: 'synthetic-language-eval', runId: crypto.randomUUID(), history: [],
          sources: [{ id: 'S1', workspaceId: 'synthetic-language-eval', fileId: 'abc123', path: '语言测试.md', content: testCase.content, hash: 'synthetic', origin: 'draft' }],
          prompt: testCase.prompt ?? (testCase.task === 'startDraft' ? assistantTaskPrompts.startDraft : assistantTaskPrompts.starters.summary),
          promptOrigin: testCase.task ? 'builtin' : 'user',
          signal: controller.signal, delta: text => { result.text += text; }, progress: () => {},
          proposal: proposal => result.proposals.push(structuredClone(proposal)),
          ...(testCase.mode === 'sidebar' ? { askUser: async questions => {
            result.questions.push(...questions);
            return questions.map(question => ({ questionId: question.id, answer: null }));
          } } : {}),
          });
        } catch (error) { result.error = String(error); }
        finally { clearTimeout(timeout); }
        return result;
      }, { testCase, model, connectionId: metadata.connection.id });
      report.results.push(result);
      await writeFile(resolve(output, 'live-results.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ id: result.id, text: result.text, proposals: result.proposals.map(p => ({ content: p.content, reason: p.reason })), questions: result.questions, error: result.error }));
    }
    if (report.results.some(result => result.error)) process.exitCode = 1;
  }
} finally {
  await browser?.close();
  child.kill();
}
