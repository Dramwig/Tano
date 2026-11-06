import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';

// This measures renderer animation callbacks in an isolated headless browser.
// It does not claim physical display presentations or desktop WebView2 FPS.
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:43847' },
  output: { type: 'string' }, hz: { type: 'string', default: '280' },
  seconds: { type: 'string', default: '3' }, rounds: { type: 'string', default: '3' },
  cases: { type: 'string', default: 'static,plain,qa,long,source,settings' },
  input: { type: 'string', default: 'wheel' },
  profile: { type: 'boolean', default: false },
  qa: { type: 'string' },
} });
if (!values.output) throw new Error('Pass --output with an external evidence directory.');
const hz = Number(values.hz), duration = Number(values.seconds) * 1000, rounds = Number(values.rounds);
if (![hz, duration, rounds].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(rounds)) throw new Error('Invalid measurement settings.');
if (!['wheel', 'raf'].includes(values.input)) throw new Error('--input must be wheel or raf');
if (values.cases.split(',').some(kind => !['static', 'plain', 'qa', 'long', 'source', 'settings'].includes(kind))) throw new Error('Unknown sample kind.');
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const paragraph = '正文包含中文、English、数字 123，以及 **加粗**、*斜体* 和 `inline code`。阅读时应连续滚动，编辑时保留完整 Markdown。';
const plain = '# 普通文章\n\n' + Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段。${paragraph.repeat(2)}\n\n`).join('');
const long = '# 长文档\n\n' + Array.from({ length: 1000 }, (_, i) => `第 ${i + 1} 段。${paragraph.repeat(2)}\n\n`).join('');
const qa = await readFile(values.qa ?? new URL('../markdown-test-workspace/en-US/00-getting-started.md', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
await context.addInitScript(() => {
  // Sandboxed attachment/preview frames intentionally have no localStorage.
  if (window.top === window && location.protocol !== 'about:') localStorage.setItem('tano.preference.locale', 'zh-CN');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const session = await context.newCDPSession(page);
const metadata = {
  recordedAt: new Date().toISOString(), browser: await browser.version(), origin: values.url,
  viewport: { width: 1440, height: 1080 }, headless: true, cpuThrottling: 1,
  targetHz: hz, frameBudgetMs: 1000 / hz, durationMs: duration, rounds, input: values.input,
  readinessSignal: 'CDP Runtime binding; no animation-frame polling after sampling starts',
  scope: 'Renderer requestAnimationFrame cadence during browser-native synthetic wheel gestures; not physical display or native desktop presentation FPS.',
  fixtureSha256: Object.fromEntries(Object.entries({ plain, qa, long }).map(([key, text]) => [key, createHash('sha256').update(text).digest('hex')])),
  fixtureSizes: Object.fromEntries(Object.entries({ plain, qa, long }).map(([key, text]) => [key, { bytes: Buffer.byteLength(text), characters: text.length }])),
};
const results = [];

function summarize(samples) {
  const sorted = samples.map(sample => sample.interval).sort((a, b) => a - b);
  if (!sorted.length) return { frames: 0 };
  const elapsed = sorted.reduce((sum, value) => sum + value, 0);
  const missed = sorted.reduce((sum, value) => sum + Math.max(0, Math.round(value * hz / 1000) - 1), 0);
  return {
    frames: sorted.length, elapsedMs: elapsed, callbackHz: sorted.length * 1000 / elapsed,
    medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)],
    p99Ms: sorted[Math.floor(sorted.length * .99)], maxMs: sorted.at(-1),
    lateFrames: sorted.filter(value => value > 1.5 * 1000 / hz).length,
    estimatedMissedVsyncPercent: 100 * missed / (missed + sorted.length),
    over16_7ms: sorted.filter(value => value > 1000 / 60 + .2).length,
    over50ms: sorted.filter(value => value > 50).length,
  };
}

async function openDocument(kind) {
  if (kind === 'static') {
    await page.setContent(`<style>body{margin:0;font:16px/1.7 Arial}#scroll{height:1080px;overflow:auto}article{width:680px;margin:auto}p{margin:24px 0}</style><div id="scroll"><article><h1>静态正文对照</h1>${Array.from({ length: 30 }, (_, i) => `<p>第 ${i + 1} 段。${paragraph.repeat(2)}</p>`).join('')}</article></div>`);
    return '#scroll';
  }
  await page.goto(values.url);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  const content = kind === 'qa' ? qa : kind === 'long' ? long : plain;
  await page.evaluate(async ({ kind, content }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create(`frame-pacing-${kind}.md`, false, content);
  }, { kind, content });
  await page.waitForSelector('.ProseMirror');
  if (kind === 'source') {
    await page.getByRole('button', { name: '切换源码模式', exact: true }).first().click();
    await page.waitForSelector('.cm-content');
  } else if (kind === 'settings') {
    await page.getByRole('button', { name: /^切换上下文：/ }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.waitForSelector('.settings-main');
    return '.settings-main';
  }
  return '.document-layout';
}

async function sample(selector, idle = false) {
  const cpuTime = () => cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle,
    total: sum.total + Object.values(cpu.times).reduce((total, time) => total + time, 0) }), { idle: 0, total: 0 });
  const cpuBefore = cpuTime();
  const geometry = await page.locator(selector).evaluate(element => {
    element.scrollTop = 0;
    const rect = element.getBoundingClientRect();
    return { maximum: element.scrollHeight - element.clientHeight, x: rect.left + rect.width * .6, y: rect.top + Math.min(rect.height * .5, 500) };
  });
  if (!idle && geometry.maximum <= 1) throw new Error(`Sample is not scrollable: ${selector}`);
  await page.mouse.move(geometry.x, geometry.y);
  await page.waitForTimeout(400);
  await session.send('Runtime.addBinding', { name: '__tanoFrameSampleReady' });
  const ready = new Promise(resolve => {
    const onReady = event => {
      if (event.name !== '__tanoFrameSampleReady') return;
      session.off('Runtime.bindingCalled', onReady);
      resolve();
    };
    session.on('Runtime.bindingCalled', onReady);
  });
  const pending = page.evaluate(async ({ selector, duration, input, idle }) => {
    const element = document.querySelector(selector);
    const maximum = element.scrollHeight - element.clientHeight;
    const frames = [], scrollTimes = [], longTasks = [];
    let previous, started;
    const onScroll = () => scrollTimes.push(performance.now());
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
    observer.observe({ type: 'longtask' });
    window.__tanoFrameSampleActive = true;
    window.__tanoFrameSampleReady('ready');
    await new Promise(resolve => {
      function tick(now) {
        started ??= now;
        if (previous !== undefined) frames.push({ time: now, interval: now - previous });
        previous = now;
        if (!idle && input === 'raf') {
          const phase = ((now - started) * .8) % (maximum * 2);
          element.scrollTop = phase <= maximum ? phase : maximum * 2 - phase;
        }
        if (now - started < duration) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    window.__tanoFrameSampleActive = false;
    element.removeEventListener('scroll', onScroll); observer.disconnect();
    return { frames, scrollTimes, longTasks, finalTop: element.scrollTop, maximum,
      domNodes: document.querySelectorAll('*').length, virtualPlaceholders: document.querySelectorAll('[data-tano-virtual-placeholder]').length };
  }, { selector, duration, input: values.input, idle });
  // Polling with waitForFunction here adds injected work after sampling has
  // begun. A native binding signals readiness without another page evaluation.
  await Promise.race([ready, pending.then(() => undefined)]);
  if (!idle && values.input === 'wheel') {
    // A CDP native gesture runs through Chromium's scrolling pipeline; there is
    // no per-frame automation command or scrollTop assignment in this variant.
    const distance = Math.min(geometry.maximum * .8, duration * .65);
    await session.send('Input.synthesizeScrollGesture', {
      x: geometry.x, y: geometry.y, yDistance: -distance,
      speed: Math.round(distance / (duration / 1000 * .85)),
      gestureSourceType: 'mouse', preventFling: true,
    });
  }
  const raw = await pending;
  const cpuAfter = cpuTime();
  const cpuTotal = cpuAfter.total - cpuBefore.total;
  const first = raw.scrollTimes[0], last = raw.scrollTimes.at(-1);
  const active = idle ? raw.frames : raw.frames.filter(frame => frame.time >= first && frame.time <= last);
  if (!idle && !active.length) throw new Error('No active scrolling frames were measured.');
  return { ...raw, hostCpuBusyPercent: cpuTotal ? 100 * (1 - (cpuAfter.idle - cpuBefore.idle) / cpuTotal) : 0,
    allFrames: summarize(raw.frames), activeFrames: summarize(active) };
}

try {
  for (const kind of values.cases.split(',')) {
    const selector = await openDocument(kind);
    await page.waitForTimeout(600);
    const idle = await sample(selector, true);
    results.push({ kind, round: -1, idle: true, ...idle });
    console.log(JSON.stringify({ kind, idle: true, ...idle.activeFrames }));
    for (let round = 0; round < rounds; round++) {
      const result = { kind, round, idle: false, ...await sample(selector) };
      results.push(result);
      console.log(JSON.stringify({ kind, round, ...result.activeFrames }));
      await writeFile(resolve(output, 'results.json'), JSON.stringify({ metadata, results, errors }, null, 2));
    }
    if (values.profile) {
      // Profiling is a separate run; its instrumentation cost must not enter
      // the frame-rate summaries above.
      await session.send('Profiler.enable');
      await session.send('Profiler.start');
      await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReturnAsStream' });
      await sample(selector);
      const { profile } = await session.send('Profiler.stop');
      await writeFile(resolve(output, `${kind}.cpuprofile`), JSON.stringify(profile));
      const completed = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
      await session.send('Tracing.end');
      const { stream } = await completed;
      let trace = '';
      try {
        for (;;) {
          const part = await session.send('IO.read', { handle: stream });
          trace += part.data;
          if (part.eof) break;
        }
      } finally { await session.send('IO.close', { handle: stream }); }
      await writeFile(resolve(output, `${kind}-trace.json`), trace);
      console.log(JSON.stringify({ kind, profile: true }));
    }
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ metadata, results, errors }, null, 2));
  if (errors.length) throw new Error(`Browser errors were recorded: ${errors.join('; ')}`);
} finally {
  await browser.close();
}
