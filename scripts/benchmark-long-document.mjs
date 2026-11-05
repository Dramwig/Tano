import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Run against a production preview. This uses an isolated browser workspace;
// it never opens or edits the user's workspace files.
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:43847' },
  output: { type: 'string' }, sizes: { type: 'string', default: '20,100,400,1000' },
  executable: { type: 'string' },
} });
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(values.output ?? join(tmpdir(), `tano-long-document-${Date.now()}`));
const origin = values.url;
const sizes = values.sizes.split(',').map(Number);
if (sizes.some(size => !Number.isInteger(size) || size < 1)) throw new Error('sizes must be positive integers');
const edge = join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const executablePath = values.executable ?? (process.platform === 'win32' && existsSync(edge) ? edge : undefined);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'packages/editor/src', 'packages/workbench/src'],
  { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/).sort();
const hash = createHash('sha256');
for (const path of sourceFiles) { hash.update(path); hash.update(await readFile(resolve(repo, path))); }
const sourceSha256 = hash.digest('hex');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.stack ?? error.message));
await mkdir(root, { recursive: true });
const results = [];
function fixture(sections) {
  const paragraph = '这是一段用于测试长文档编辑性能的正文，包含中文、English、数字 12345，以及 **加粗**、*斜体* 和 `inline code`。滚动时应保持连续，打开文档后应能及时阅读和编辑。';
  return '# 长文档性能测试\n\n' + Array.from({ length: sections }, (_, i) =>
    `## 第 ${i + 1} 节\n\n${paragraph.repeat(3)}\n\n${paragraph.repeat(2)}\n\n` +
    (i % 10 === 0 ? '- 第一项\n- 第二项\n- 第三项\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n```javascript\nconst answer = 42;\nconsole.log(answer);\n```\n\n' : '')
  ).join('') + `\nEND-OF-FIXTURE-${sections}\n`;
}
async function frames() { await page.evaluate(async () => { for(let i=0;i<3;i++) await new Promise(requestAnimationFrame); }); }
async function measureOpen(path, marker) {
  return page.evaluate(async ({path,marker}) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const tasks = [];
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration}))));
    observer.observe({type:'longtask'});
    const start = performance.now();
    await store.openFile(store.workspace.files.find(f => f.path === path));
    const storeMs = performance.now() - start;
    while (!document.querySelector('.ProseMirror')?.textContent.includes(marker)) {
      if (performance.now()-start > 60000) throw new Error('Editor mount timeout');
      await new Promise(requestAnimationFrame);
    }
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const paintMs = performance.now()-start;
    await new Promise(resolve=>setTimeout(resolve,100));
    observer.disconnect();
    return {storeMs,paintMs,longTasks:tasks.length,maxLongTaskMs:Math.max(0,...tasks.map(t=>t.duration)),blockingMs:tasks.reduce((sum,t)=>sum+Math.max(0,t.duration-50),0),domNodes:document.querySelectorAll('.milkdown-host *').length,blocks:document.querySelectorAll('.tano-block-handle').length};
  }, {path,marker});
}
async function scroll(label, diagnostic = false) {
  return page.evaluate(async ({label,diagnostic}) => {
    const el = document.querySelector('.document-layout');
    el.scrollTop = 0;
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const intervals = [], tasks = [], calls = {};
    const original = Element.prototype.getBoundingClientRect;
    if (diagnostic) Element.prototype.getBoundingClientRect = function() {
      const key = new Error().stack.split('\n').slice(2,5).join('\n');
      calls[key] = (calls[key]??0)+1;
      return original.call(this);
    };
    const observer = new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));
    observer.observe({type:'longtask'});
    const started = performance.now(); let previous = started, ticks=0;
    await new Promise(resolve => {
      function step(now) {
        if(ticks) intervals.push(now-previous);
        previous=now; ticks++;
        el.scrollTop += 90;
        if(now-started < (diagnostic?500:2200)) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
    Element.prototype.getBoundingClientRect = original;
    await new Promise(resolve=>setTimeout(resolve,100)); observer.disconnect();
    intervals.sort((a,b)=>a-b);
    return {label,elapsedMs:performance.now()-started,frames:intervals.length,averageFrameMs:intervals.reduce((s,n)=>s+n,0)/intervals.length,p95FrameMs:intervals[Math.min(intervals.length-1,Math.floor(intervals.length*.95))],maxFrameMs:Math.max(...intervals),framesOver50ms:intervals.filter(n=>n>50).length,longTasks:tasks.length,maxLongTaskMs:Math.max(0,...tasks),scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,geometryCalls:diagnostic?Object.entries(calls).sort((a,b)=>b[1]-a[1]).slice(0,10):undefined};
  }, {label,diagnostic});
}
try {
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('baseline.md', false, '# 对照文档\n\n短文档。\n');
  });
  await page.waitForSelector('.ProseMirror'); await frames();
  for (const sections of sizes) {
    // Headings remain mounted in both builds. The full model and initial
    // viewport are ready here; an offscreen paragraph may be virtualized.
    const content = fixture(sections), path = `long-${sections}.md`, marker = `第 ${sections} 节`;
    await writeFile(`${root}/${path}`,content);
    await page.evaluate(async ({path,content})=>{
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await store.create(path,false,content);
    },{path,content});
    await page.waitForFunction(marker=>document.querySelector('.ProseMirror')?.textContent.includes(marker),marker,{timeout:60000});
    await frames();
    const opens = [];
    for(let round=0;round<3;round++) {
      await measureOpen('baseline.md','短文档。');
      await page.evaluate(async path=>{
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
        const doc = store.documents.find(d=>d.path===path); if(doc) await store.close(doc.id);
      },path);
      opens.push(await measureOpen(path,marker));
    }
    const richScroll = await scroll('rich');
    const session = await context.newCDPSession(page);
    await session.send('Profiler.enable'); await session.send('Profiler.start');
    await scroll('profile');
    const profile = await session.send('Profiler.stop');
    await writeFile(`${root}/cpu-${sections}.json`,JSON.stringify(profile.profile));
    await session.detach();
    const geometry = await scroll('geometry',true);
    const sourceStart=Date.now();
    await page.getByRole('button',{name:'切换源码模式',exact:true}).first().click();
    await page.waitForSelector('.cm-content'); await frames();
    const sourceSwitchMs=Date.now()-sourceStart;
    const sourceScroll = await scroll('source');
    const result = {sections,bytes:Buffer.byteLength(content),characters:content.length,lines:content.split('\n').length,opens,richScroll,sourceSwitchMs,sourceScroll,geometry};
    results.push(result); console.log(JSON.stringify(result));
    await writeFile(`${root}/results.json`,JSON.stringify({revision,sourceSha256,origin,recordedAt:new Date().toISOString(),browser:await browser.version(),viewport:{width:1280,height:900},mode:'production',results,errors},null,2));
    if (sections !== sizes.at(-1)) {
      await page.getByRole('button',{name:'返回编辑',exact:true}).first().click({timeout:90000});
      await page.waitForSelector('.ProseMirror'); await frames();
    }
  }
  await page.screenshot({path:`${root}/long-document.png`});
  if (errors.length) {
    console.error(`Recorded ${errors.length} browser errors; inspect results.json.`);
    process.exitCode = 1;
  }
} finally { await browser.close(); console.log(`Evidence: ${root}`); }
