export interface UpdateStatus {
  currentVersion: string;
  configured: boolean;
  reason: string | null;
}
export interface UpdateCandidate {
  id: string;
  version: string;
  notes: string;
}
export interface UpdateProgress {
  downloaded: number;
  total?: number;
}
export type UpdatePhase =
  'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'installing';
export interface UpdateHost {
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateCandidate | null>;
  download(id: string, progress: (value: UpdateProgress) => void): Promise<void>;
  install(id: string): Promise<void>;
  flush(): Promise<boolean>;
  disconnect(): Promise<void>;
}

/** Owns the save/install order independently of the view and native updater. */
export class UpdateController {
  status?: UpdateStatus;
  candidate?: UpdateCandidate;
  phase: UpdatePhase = 'idle';
  error = '';
  progress: UpdateProgress = { downloaded: 0 };
  constructor(
    private host: UpdateHost,
    private changed: () => void,
  ) {}
  get busy() {
    return ['checking', 'downloading', 'installing'].includes(this.phase);
  }
  async initialize() {
    if (this.status || this.busy) return;
    try {
      this.status = await this.host.status();
      this.changed();
      if (this.status.configured) await this.check();
    } catch (error) {
      this.error = String(error);
      this.changed();
    }
  }
  async check() {
    if (this.busy || !this.status?.configured) return;
    this.phase = 'checking';
    this.error = '';
    this.candidate = undefined;
    this.changed();
    try {
      this.candidate = (await this.host.check()) ?? undefined;
      this.phase = this.candidate ? 'available' : 'current';
    } catch (error) {
      this.phase = 'idle';
      this.error = String(error);
    }
    this.changed();
  }
  async download() {
    if (this.phase !== 'available' || !this.candidate) return;
    this.phase = 'downloading';
    this.error = '';
    this.progress = { downloaded: 0 };
    this.changed();
    try {
      await this.host.download(this.candidate.id, (value) => {
        this.progress = value;
        this.changed();
      });
      this.phase = 'ready';
    } catch (error) {
      this.phase = 'available';
      this.error = String(error);
    }
    this.changed();
  }
  async install() {
    if (this.phase !== 'ready' || !this.candidate) return;
    this.phase = 'installing';
    this.error = '';
    this.changed();
    let installing = false;
    try {
      if (!(await this.host.flush())) throw new Error('还有未保存内容或冲突，请先保存或另存副本。');
      // The host disconnect hook finishes any active external editing session.
      await this.host.disconnect();
      // Capture any materialization that finished while suspending collaboration.
      if (!(await this.host.flush())) throw new Error('保存未完成，已取消安装。请处理后重试。');
      installing = true;
      await this.host.install(this.candidate.id);
    } catch (error) {
      this.error = `${String(error)}${installing ? '。请重新检查更新后重试安装；文件同步可在连接面板重连。' : ''}`;
      this.phase = installing ? 'idle' : 'ready';
      if (installing) this.candidate = undefined;
    }
    this.changed();
  }
}
