// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  buildSandboxedEmailSrcdoc,
  emailToMarkdownDocument,
  markdownToEmailHtml,
  safeMailDocumentPath,
} from './mail-markdown';
import type { MailMessageDetail } from './types';

const sampleDetail: MailMessageDetail = {
  summary: {
    id: 'msg-1',
    accountId: 'acc-1',
    folderId: 'f-1',
    uid: 1,
    messageId: 'abc@qq.com',
    threadKey: 'abc@qq.com',
    subject: 'Q4 计划 / 评审: "确认版"',
    from: [{ name: '张三', address: 'zhangsan@qq.com' }],
    to: [{ name: '李四', address: 'lisi@gmail.com' }],
    dateTs: Date.UTC(2026, 10, 25, 4, 0, 0) / 1000,
    snippet: '附件为评审材料',
    seen: true,
    flagged: false,
    answered: false,
    hasAttachments: true,
    hasIcs: false,
    bodyFetched: true,
  },
  cc: [],
  replyTo: [],
  inReplyTo: null,
  references: [],
  textBody: '请查收 Q4 计划评审材料。',
  htmlSanitized: '<p>Hi</p><img data-tano-remote-src="https://img.example/a.png" alt="x" />',
  hasRemoteImages: true,
  attachments: [],
  invites: [],
};

describe('mail-markdown conversion and sandboxing', () => {
  it('generates safe filenames and structured Markdown with YAML frontmatter', () => {
    const path = safeMailDocumentPath(sampleDetail, '邮件归档');
    expect(path).toBe('邮件归档/2026-11-25 Q4 计划 评审 确认版.md');

    const md = emailToMarkdownDocument(sampleDetail, [
      { filename: 'plan.pdf', relativePath: './assets/plan.pdf' },
    ]);
    expect(md).toContain('source: mail');
    expect(md).toContain('mail_message_id: "abc@qq.com"');
    expect(md).toContain('请查收 Q4 计划评审材料。');
    expect(md).toContain('- [plan.pdf](./assets/plan.pdf)');
  });

  it('converts composer Markdown into clean escaped email HTML', () => {
    const html = markdownToEmailHtml('# 标题\n\n- **重要** 事项\n> 引用 `<script>`');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>重要</strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('keeps remote images blocked in sandboxed srcdoc unless explicitly allowed', () => {
    const blocked = buildSandboxedEmailSrcdoc(sampleDetail.htmlSanitized, false);
    expect(blocked).toContain("img-src data:;");
    expect(blocked).not.toContain(' src="https://img.example/a.png"');
    expect(blocked).toContain('data-tano-remote-src="https://img.example/a.png"');

    const allowed = buildSandboxedEmailSrcdoc(sampleDetail.htmlSanitized, true);
    expect(allowed).toContain('src="https://img.example/a.png"');
    expect(allowed).toContain('img-src data: https: http:;');
  });
});
