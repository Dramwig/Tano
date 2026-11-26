// SPDX-License-Identifier: MIT
import { formatMailAddressList, type MailMessageDetail } from './types';

function escapeYaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function safeMailDocumentPath(detail: MailMessageDetail, folderPrefix = ''): string {
  const date = new Date((detail.summary.dateTs || Math.floor(Date.now() / 1000)) * 1000);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const cleanedSubject = (detail.summary.subject || '无主题邮件')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  const filename = `${day} ${cleanedSubject || '邮件'}.md`;
  const prefix = folderPrefix.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${filename}` : filename;
}

export function emailToMarkdownDocument(
  detail: MailMessageDetail,
  importedAttachments: readonly { filename: string; relativePath: string }[] = [],
): string {
  const sentAt = detail.summary.dateTs
    ? new Date(detail.summary.dateTs * 1000).toISOString()
    : new Date().toISOString();
  const from = formatMailAddressList(detail.summary.from);
  const to = formatMailAddressList(detail.summary.to);
  const cc = formatMailAddressList(detail.cc);

  const frontmatter = [
    '---',
    `title: ${escapeYaml(detail.summary.subject || '无主题邮件')}`,
    'source: mail',
    `date: ${escapeYaml(sentAt)}`,
    `mail_from: ${escapeYaml(from)}`,
    `mail_to: ${escapeYaml(to)}`,
    ...(cc ? [`mail_cc: ${escapeYaml(cc)}`] : []),
    ...(detail.summary.messageId ? [`mail_message_id: ${escapeYaml(detail.summary.messageId)}`] : []),
    '---',
  ].join('\n');

  const body = (detail.textBody || stripHtmlToPlain(detail.htmlSanitized) || detail.summary.snippet).trim();
  const headerLines = [
    `# ${detail.summary.subject || '无主题邮件'}`,
    '',
    `- **发件人**：${from || '未知'}`,
    `- **收件人**：${to || '未知'}`,
    ...(cc ? [`- **抄送**：${cc}`] : []),
    `- **时间**：${new Date(sentAt).toLocaleString('zh-CN')}`,
  ];

  const attachmentSection = importedAttachments.length
    ? [
        '',
        '## 附件',
        '',
        ...importedAttachments.map((item) => `- [${item.filename}](${encodeURI(item.relativePath)})`),
      ]
    : [];

  return `${frontmatter}\n\n${headerLines.join('\n')}\n\n---\n\n${body}\n${attachmentSection.join('\n')}\n`;
}

/**
 * Converts lightweight Markdown from the mail composer into clean, email-client-safe HTML.
 */
export function markdownToEmailHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      blocks.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      blocks.push(`<h${level} style="margin:14px 0 8px;line-height:1.4;">${renderInline(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        blocks.push('<ul style="margin:8px 0;padding-left:20px;">');
        inList = true;
      }
      blocks.push(`<li style="margin:4px 0;">${renderInline(bullet[1]!)}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      blocks.push(
        `<blockquote style="margin:8px 0;padding:4px 12px;border-left:3px solid #d0d5dd;color:#475467;">${renderInline(quote[1]!)}</blockquote>`,
      );
      continue;
    }
    closeList();
    blocks.push(`<p style="margin:8px 0;line-height:1.65;">${renderInline(line)}</p>`);
  }
  closeList();

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;font-size:14px;color:#1f2328;line-height:1.65;">${blocks.join('')}</body></html>`;
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:4px;">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

/**
 * Builds the sandboxed `<iframe srcdoc>` content for rendering sanitized HTML emails.
 * Remote images remain blocked unless `allowRemoteImages` is explicitly toggled on for the message.
 */
export function buildSandboxedEmailSrcdoc(sanitizedHtml: string, allowRemoteImages: boolean): string {
  const rendered = allowRemoteImages
    ? sanitizedHtml.replace(/\bdata-tano-remote-src="(https?:\/\/[^"]+)"/gi, 'src="$1"')
    : sanitizedHtml;
  const csp = allowRemoteImages
    ? "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline';"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline';";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <base target="_blank" />
  <style>
    html, body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      font-size: 14px;
      line-height: 1.65;
      color: #1f2328;
      background: #ffffff;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    blockquote {
      margin: 8px 0;
      padding: 4px 12px;
      border-left: 3px solid #d0d5dd;
      color: #57606a;
    }
    a { color: #3b5bdb; }
    pre, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>${rendered}</body>
</html>`;
}

function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
