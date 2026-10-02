import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAssistantSession } from '../packages/protocol/src/assistant.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = text => text.replace(/\r\n/g, '\n');
const sha256 = text => createHash('sha256').update(text).digest('hex');

export async function loadEvaluationCases() {
  const dataset = JSON.parse(await readFile(resolve(root, 'test-data/assistant-eval/cases.json'), 'utf8'));
  if (dataset.version !== 1) throw new Error('不支持的验收集版本');
  const paths = [...new Set(dataset.cases.flatMap(item => item.sources))];
  const materials = Object.fromEntries(await Promise.all(paths.map(async path => {
    const content = await readFile(resolve(root, 'test-data/assistant-eval/workspace', path), 'utf8');
    return [path, normalize(content)];
  })));
  return { ...dataset, materials };
}

export function evaluateSession(value, testCase, materials) {
  const session = parseAssistantSession(value);
  const checks = [];
  const check = (id, passed) => checks.push({ id, passed: !!passed });
  const questions = session.messages.filter(message => message.role === 'user');
  const questionIndex = session.messages.findIndex(message => message.role === 'user' && message.content.trim() === testCase.prompt);
  const reply = questionIndex >= 0 && session.messages[questionIndex + 1]?.role === 'assistant'
    ? session.messages[questionIndex + 1] : undefined;
  check('fresh_session_and_exact_prompt', questions.length === 1 && questionIndex === 0 && session.messages.length === 2);
  check('completed_response', reply?.state === 'completed');
  check('model_recorded', typeof reply?.model === 'string' && !!reply.model.trim());
  const sources = reply?.sources ?? [];
  check('only_expected_sources', sources.length === testCase.sources.length &&
    new Set(sources.map(source => source.path)).size === sources.length &&
    new Set(sources.map(source => source.id)).size === sources.length &&
    sources.every(source => testCase.sources.includes(source.path)));
  check('unchanged_source_snapshots', testCase.sources.every(path => sources.some(source => source.path === path &&
    normalize(source.content) === materials[path])));

  const references = [...(reply?.content ?? '').matchAll(/\[来源:(S\d+)\]/g)].map(match => match[1]);
  check('citations_reference_supplied_sources', references.every(id => sources.some(source => source.id === id)));
  check('required_citations_present', testCase.citations.every(path => sources.some(source => source.path === path && references.includes(source.id))));

  const proposals = reply?.proposals ?? [];
  if (testCase.proposal) {
    const expected = testCase.proposal;
    const proposal = proposals[0];
    check('one_expected_proposal', proposals.length === 1 && proposal?.kind === expected.kind && proposal?.path === expected.path &&
      proposal.workspaceId === session.workspaceId && proposal.runId === reply?.id);
    check('proposal_not_applied', proposal?.status === 'ready' && !proposal.applied);
    check('proposal_changes_content', !!proposal?.content.trim() && proposal.content !== proposal.base);
    if (expected.kind === 'edit') {
      const source = sources.find(item => item.path === expected.path);
      check('proposal_matches_read_baseline', source && proposal?.fileId === source.fileId && proposal?.base === source.content);
      if (testCase.selection && source) {
        const from = source.content.indexOf(testCase.selection);
        const to = from + testCase.selection.length;
        check('expected_selection_supplied', from >= 0 && source.selection?.text === testCase.selection &&
          source.selection.from === from && source.selection.to === to);
        check('only_selection_changed', proposal && from >= 0 && proposal.content.startsWith(source.content.slice(0, from)) &&
          proposal.content.endsWith(source.content.slice(to)) &&
          proposal.content.length >= source.content.length - testCase.selection.length);
      }
    } else check('new_document_has_empty_baseline', proposal?.base === '');
  } else check('no_unrequested_proposals', proposals.length === 0);

  const output = [reply?.content ?? '', ...proposals.map(proposal => proposal.content)].join('\n');
  check('no_unselected_marker_disclosed', (testCase.forbidden ?? []).every(text => !output.includes(text)));
  return {
    version: 1, caseId: testCase.id, sessionId: session.id, model: reply?.model ?? null,
    promptHash: sha256(testCase.prompt), sourceHashes: Object.fromEntries(sources.map(source => [source.path, sha256(normalize(source.content))])),
    checks, gatesPassed: checks.every(item => item.passed),
    factTokens: testCase.facts.map(text => ({ text, present: output.includes(text) })),
    timing: reply?.timing ? { firstContentMs: reply.timing.firstContentMs, totalMs: reply.timing.totalMs } : null,
    usage: reply?.usage ? { input: reply.usage.input, output: reply.usage.output } : null,
    providerVerification: 'manual_required', quality: 'pending_human_review',
    humanCriteria: testCase.humanCriteria.map(criterion => ({ criterion, score: null, evidence: '' })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  while (args.length) {
    const name = args.shift();
    if (name === '--list') options.list = true;
    else if (['--case', '--session', '--out'].includes(name) && args[0] && !args[0].startsWith('--')) options[name.slice(2)] = args.shift();
    else throw new Error('用法：node scripts/assistant-eval.mjs --list 或 --case <用例 ID> --session <会话 JSON> [--out <报告 JSON>]');
  }
  const dataset = await loadEvaluationCases();
  if (options.list) {
    for (const item of dataset.cases) console.log(`${item.id}\n参考：${item.sources.join('、')}\n任务：${item.prompt}\n${item.selection ? `选区：${item.selection}\n` : ''}`);
    return;
  }
  const testCase = dataset.cases.find(item => item.id === options.case);
  if (!testCase || !options.session) throw new Error('请指定已知的 --case 和 --session；用 --list 查看固定任务');
  const sessionPath = resolve(options.session);
  if ((await stat(sessionPath)).size > 8_000_000) throw new Error('会话文件超过大小限制');
  const report = evaluateSession(JSON.parse(await readFile(sessionPath, 'utf8')), testCase, dataset.materials);
  const engineFiles = ['packages/protocol/src/assistant.ts', 'packages/workbench/src/assistant/engine.ts',
    'packages/workbench/src/assistant/store.ts', 'packages/workbench/src/assistant/transport.ts'];
  report.implementationHashes = Object.fromEntries(await Promise.all(engineFiles.map(async path =>
    [path, sha256(await readFile(resolve(root, path)))])));
  report.datasetHash = sha256(await readFile(resolve(root, 'test-data/assistant-eval/cases.json')));
  report.evaluatedAt = new Date().toISOString();
  if (options.out) {
    const path = resolve(options.out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(`报告已生成：${path}`);
  }
  for (const item of report.checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.id}`);
  console.log(`结构检查${report.gatesPassed ? '通过' : '失败'}；真实服务确认与语义评分仍需人工完成。`);
  if (!report.gatesPassed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
