import type { AssistantAttachmentInfo, AssistantMediaAttachment, AssistantMediaKind } from '@tano/protocol';
import { t } from '../i18n/i18n';

export const maxAssistantAttachments = 10;
export const assistantAttachmentBytes = { text: 128 * 1024, media: 4 * 1024 * 1024 };
export const assistantClipboardSeparator = '\n\nClipboard attachments (reference data):\n';

const mediaTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', pdf: 'application/pdf',
};
const officeTypes: Readonly<Record<string, string>> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const genericMime = 'application/octet-stream';
const validMime = /^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/;

export interface AssistantDraftAttachment {
  id: string;
  file: File;
  name: string;
  kind: AssistantMediaKind;
  mime: string;
}

export function clipboardAssistantFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items).flatMap(item => {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

export function describeAssistantAttachment(file: File): AssistantDraftAttachment | undefined {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase() ?? '';
  const media = Object.values(mediaTypes).find(type => type === file.type)
    ?? (Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined);
  const name = file.name.trim().slice(0, 255);
  if (!name) return;
  const kind = media === 'application/pdf' ? 'pdf' : media ? 'image' : 'file';
  const reportedMime = file.type.length <= 127 && validMime.test(file.type) && file.type !== genericMime ? file.type : undefined;
  const officeMime = Object.hasOwn(officeTypes, extension) ? officeTypes[extension] : undefined;
  return { id: crypto.randomUUID(), file, name, kind, mime: media ?? officeMime ?? reportedMime ?? genericMime };
}

function readClipboardFile(file: Blob, asText: boolean): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result!);
    reader.onerror = reader.onabort = () => reject(reader.error);
    if (asText) reader.readAsArrayBuffer(file);
    else reader.readAsDataURL(file);
  });
}

function decodeAttachmentText(data: ArrayBuffer): string | undefined {
  const bytes = new Uint8Array(data);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (!/[\x00-\x08\x0e-\x1a\x1c-\x1f]/.test(content)) return content;
  } catch { /* Binary attachments are sent in the provider's file format. */ }
}

export async function readAssistantAttachments(attachments: readonly AssistantDraftAttachment[], accepts: (kind: AssistantMediaKind) => boolean, signal: AbortSignal) {
  const texts: { name: string; content: string }[] = [];
  const media: AssistantMediaAttachment[] = [];
  const info: AssistantAttachmentInfo[] = [];
  let textBytes = 0, mediaBytes = 0;
  for (const { file, kind, name, mime } of attachments) {
    signal.throwIfAborted();
    let bytes: ArrayBuffer | undefined;
    let content: string | undefined;
    if (kind === 'file') {
      try {
        bytes = await readClipboardFile(file, true) as ArrayBuffer;
        content = decodeAttachmentText(bytes);
      }
      catch { throw new Error(t('无法读取附件：{0}', [name])); }
    }
    signal.throwIfAborted();
    if (content !== undefined) {
      textBytes += new TextEncoder().encode(content).length;
      if (textBytes > assistantAttachmentBytes.text) throw new Error(t('附件超过大小限制：{0}', [name]));
      texts.push({ name, content });
      info.push({ name, kind: 'text' });
      continue;
    }
    if (!accepts(kind)) throw new Error(t('当前模型连接无法接收此附件：{0}。请切换连接或移除附件。', [name]));
    const mediaFile = bytes ? new Blob([bytes], { type: mime }) : file;
    mediaBytes += mediaFile.size;
    if (mediaBytes > assistantAttachmentBytes.media) throw new Error(t('附件超过大小限制：{0}', [name]));
    try {
      const url = await readClipboardFile(mediaFile, false) as string;
      media.push({ name, mime, data: url.slice(url.indexOf(',') + 1) });
      info.push({ name, kind });
    } catch {
      throw new Error(t('无法读取附件：{0}', [name]));
    }
  }
  return { texts, media, info };
}
