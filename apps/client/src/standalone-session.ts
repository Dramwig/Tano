import { mergeMarkdown } from '@tano/markdown';

export interface Snapshot { content: string; hash: string; modified: number }
export type WriteResult = { status: 'saved' | 'conflict'; snapshot: Snapshot } | { status: 'missing' };

/** The host owns persistence; this model never replaces a conflicting draft. */
export class StandaloneSession {
  content: string;
  conflict?: Snapshot;
  constructor(public base: Snapshot) { this.content = base.content; }
  get dirty() { return this.content !== this.base.content; }
  acceptExternal(snapshot: Snapshot) {
    const merged = mergeMarkdown(this.base.content, this.content, snapshot.content);
    if (!merged.clean) { this.conflict = snapshot; return false; }
    this.base = snapshot;
    this.content = merged.content;
    this.conflict = undefined;
    return true;
  }
  async save(write: (content: string, expected: string) => Promise<WriteResult>) {
    // Bounded retries preserve concurrent changes without spinning on a busy file.
    for (let attempt = 0; attempt < 3; attempt++) {
      const submitted = this.content;
      const result = await write(submitted, this.base.hash);
      if (result.status === 'missing') throw new Error('原文件已被移动或删除，请另存副本。');
      if (result.status === 'conflict') {
        if (!this.acceptExternal(result.snapshot)) return false;
      } else {
        // Typing during the write is still a dirty draft after this save.
        this.base = result.snapshot;
        this.conflict = undefined;
        if (this.content === submitted) this.content = result.snapshot.content;
        return !this.dirty;
      }
    }
    throw new Error('文件正在被其他程序修改，请稍后保存或另存副本。');
  }
}
