import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { evaluateSession, loadEvaluationCases } from './assistant-eval.mjs';
import { parseAssistantSession } from '../packages/protocol/src/assistant.ts';

let dataset;
beforeAll(async () => { dataset = await loadEvaluationCases(); });

function fixture(caseId) {
  const testCase = dataset.cases.find(item => item.id === caseId);
  const sources = testCase.sources.map((path, index) => ({ id: `S${index + 1}`, workspaceId: 'workspace',
    fileId: `file-${index}`, path, content: dataset.materials[path], hash: 'fixture', origin: 'disk' }));
  if (testCase.selection) {
    const from = sources[0].content.indexOf(testCase.selection);
    sources[0].selection = { text: testCase.selection, from, to: from + testCase.selection.length };
  }
  const proposals = testCase.proposal ? [{ id: 'proposal', runId: 'reply', workspaceId: 'workspace',
    kind: testCase.proposal.kind, path: testCase.proposal.path, fileId: sources[0].fileId,
    base: testCase.proposal.kind === 'edit' ? sources[0].content : '',
    content: testCase.proposal.kind === 'edit' ? sources[0].content.replace(testCase.selection, '可知建议采纳情况，但长期写作质量尚无定论。') : '# 总结\n24 位、7 位、29%。[试验记录](reference.md#记录)',
    reason: '测试', status: 'ready' }] : [];
  const session = { version: 1, id: 'eval-session', workspaceId: 'workspace', title: testCase.id,
    createdAt: 1, updatedAt: 3, revision: 1, messages: [
      { id: 'question', role: 'user', content: testCase.prompt, createdAt: 1 },
      { id: 'reply', role: 'assistant', content: '24 人中 7 人采纳，约 29%。30 人中 12 人采纳，40%。[来源:S1][来源:S2]',
        createdAt: 2, model: 'test', state: 'completed', sources, proposals, timing: { firstContentMs: 100, totalMs: 200 } },
    ] };
  session.messages[1].content = session.messages[1].content.replace('[来源:S2]', sources.length > 1 ? '[来源:S2]' : '');
  return { session, testCase, grade: value => evaluateSession(value, testCase, dataset.materials) };
}

describe('offline assistant evaluation', () => {
  it('passes mechanically correct outputs but keeps service and semantic quality unverified', () => {
    const { session, grade } = fixture('grounded-qa');
    const report = grade(session);
    expect(report.gatesPassed).toBe(true);
    expect(report.quality).toBe('pending_human_review');
    expect(report.providerVerification).toBe('manual_required');
    expect(report.humanCriteria.every(item => item.score === null)).toBe(true);
    expect(report).not.toHaveProperty('messages');
    expect(report).not.toHaveProperty('content');
  });
  it('fails missing material, unexpected context, and references to unsupplied sources', () => {
    const { session, grade } = fixture('grounded-qa');
    session.messages[1].sources.push({ ...session.messages[1].sources[0], id: 'S2', path: 'private.md' });
    session.messages[1].content += '[来源:S99]';
    const report = grade(session);
    expect(report.checks.filter(item => !item.passed).map(item => item.id))
      .toEqual(['only_expected_sources', 'citations_reference_supplied_sources']);
    session.messages[1].sources[0].content = '另一份资料';
    expect(grade(session).checks.find(item => item.id === 'unchanged_source_snapshots').passed).toBe(false);
  });
  it('rejects a different task or additional conversation history', () => {
    const { session, grade } = fixture('grounded-qa');
    session.messages[0].content = '不同任务';
    expect(grade(session).gatesPassed).toBe(false);
    session.messages.unshift({ id: 'earlier', role: 'user', content: '旧的材料', createdAt: 0 });
    expect(grade(session).checks.find(item => item.id === 'fresh_session_and_exact_prompt').passed).toBe(false);
  });
  it('requires citations to both documents for a comparison', () => {
    const { session, grade } = fixture('cross-document');
    expect(grade(session).gatesPassed).toBe(true);
    session.messages[1].content = session.messages[1].content.replace('[来源:S2]', '');
    expect(grade(session).checks.find(item => item.id === 'required_citations_present').passed).toBe(false);
  });
  it('fails a rewrite that changes text outside the selected paragraph', () => {
    const { session, grade } = fixture('selection-edit');
    expect(grade(session).gatesPassed).toBe(true);
    session.messages[1].proposals[0].content = session.messages[1].proposals[0].content.replace('const adopted = 7;', 'const adopted = 8;');
    expect(grade(session).checks.find(item => item.id === 'only_selection_changed').passed).toBe(false);
  });
  it('distinguishes a pending new file from an already applied or wrongly targeted proposal', () => {
    const { session, grade } = fixture('create-summary');
    expect(grade(session).gatesPassed).toBe(true);
    session.messages[1].proposals[0].path = 'note.md';
    session.messages[1].proposals[0].status = 'applied';
    expect(grade(session).checks.filter(item => !item.passed).map(item => item.id))
      .toEqual(['one_expected_proposal', 'proposal_not_applied']);
  });
  it('fails disclosure of the unselected synthetic document marker', () => {
    const { session, grade } = fixture('injection-isolation');
    session.messages[1].content += 'TANO_UNSELECTED_EVAL_7BF8C1';
    expect(grade(session).checks.find(item => item.id === 'no_unselected_marker_disclosed').passed).toBe(false);
  });
  it('does not equate token presence with factual accuracy', () => {
    const { session, grade } = fixture('grounded-qa');
    session.messages[1].content = '7 人参与，24 人采纳，29%。[来源:S1]';
    const report = grade(session);
    expect(report.factTokens.every(item => item.present)).toBe(true);
    expect(report.quality).toBe('pending_human_review');
  });
  it('loads old records without latency and rejects invalid persisted measurements', () => {
    const { session } = fixture('grounded-qa');
    delete session.messages[1].timing;
    expect(parseAssistantSession(session).messages[1].timing).toBeUndefined();
    for (const timing of [null, {}, { totalMs: -1 }, { totalMs: 10, firstContentMs: 11 }, { totalMs: 10, firstContentMs: -1 }, { totalMs: Infinity }]) {
      session.messages[1].timing = timing;
      expect(() => parseAssistantSession(session)).toThrow('消息格式');
    }
  });
  it('runs with the supported Node runtime and refuses to overwrite an existing report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tano-assistant-eval-'));
    try {
      const { session } = fixture('grounded-qa');
      const path = join(directory, 'session.json');
      const out = join(directory, 'report.json');
      await writeFile(path, JSON.stringify(session));
      const command = [fileURLToPath(new URL('./assistant-eval.mjs', import.meta.url)), '--case', 'grounded-qa', '--session', path, '--out', out];
      await promisify(execFile)(process.execPath, command);
      const report = JSON.parse(await readFile(out, 'utf8'));
      expect(report.gatesPassed).toBe(true);
      expect(report.quality).toBe('pending_human_review');
      expect(Object.keys(report.implementationHashes)).toHaveLength(4);
      await expect(promisify(execFile)(process.execPath, command)).rejects.toMatchObject({ code: 1 });
      expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(report);
      session.messages[1].state = 'failed';
      await writeFile(path, JSON.stringify(session));
      await expect(promisify(execFile)(process.execPath, command.slice(0, -2))).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
