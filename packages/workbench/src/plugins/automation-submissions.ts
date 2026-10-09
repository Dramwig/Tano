import { pluginApplicationStorage } from './packages';

interface Submission { version: string; key: string; createdAt: number }
/** Only submission identities, never plugin payloads or credentials, in device application state. */
export class AutomationSubmissions {
  private key: string;
  constructor(principal: string, workspace: string, private storage = pluginApplicationStorage()) {
    this.key = `tano.automation-submissions.v1.${encodeURIComponent(principal)}.${encodeURIComponent(workspace)}`;
  }
  private read(): Record<string, Submission> {
    const data: unknown = JSON.parse(this.storage.getItem(this.key) ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([id, value]) =>
      !/^[a-f0-9-]{36}$/.test(id) || !value || typeof value !== 'object' ||
      !/^[a-f0-9-]{36}$/.test(value.version) || !/^[a-f0-9-]{36}$/.test(value.key) || !Number.isFinite(value.createdAt)))
      throw new Error('后台任务提交记录损坏，请先核对服务端运行记录。');
    return data as Record<string, Submission>;
  }
  pending(id: string, version: string) { const entry = this.read()[id]; return entry?.version === version ? entry : undefined; }
  begin(id: string, version: string) {
    const data = this.read(), previous = data[id];
    if (previous?.version === version) {
      if (Date.now() - previous.createdAt >= 29 * 86400_000) throw new Error('上次提交已接近去重记录保留期限。请先核对运行记录，再结束本次提交确认。');
      return previous.key;
    }
    // A changed job version cannot accept an earlier trigger. Keep only the current attempt.
    data[id] = { version, key: crypto.randomUUID(), createdAt: Date.now() };
    this.storage.setItem(this.key, JSON.stringify(data)); return data[id].key;
  }
  clear(id: string, version: string, key?: string) {
    const data = this.read(), entry = data[id];
    if (entry?.version !== version || key && entry.key !== key) return;
    delete data[id]; this.storage.setItem(this.key, JSON.stringify(data));
  }
}
