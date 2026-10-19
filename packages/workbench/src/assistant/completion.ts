import type { AssistantActivity, AssistantTerminationReason } from '@tano/protocol';

export type AssistantTextPhase = Extract<AssistantActivity, { kind: 'text' }>['phase'];
export type AssistantTextSegment = { start: number; end: number; phase: AssistantTextPhase };

export class AssistantRunError extends Error {
  constructor(public reason: AssistantTerminationReason, message: string) { super(message); }
}

export function responsePhase(value: unknown): AssistantTextPhase | undefined {
  if (value === 'commentary' || value === 'partial_answer') return 'working';
  if (value === 'final_answer') return 'answer';
  return undefined;
}

const markers = [
  { prefix: '[[tano:progress]]', phase: 'working' },
  { prefix: '[[tano:final]]', phase: 'answer' },
] as const;

/** Only an exact leading protocol marker is interpreted; ordinary prose is never guessed. */
export class AssistantTextDecoder {
  private buffer = '';
  private started = false;
  private afterMarker = false;
  phase: AssistantTextPhase = 'pending';
  constructor(private emit: (text: string, phase: AssistantTextPhase) => void) {}
  push(text: string, nativePhase?: AssistantTextPhase) {
    if (nativePhase) this.phase = nativePhase;
    if (this.started && !this.afterMarker) { this.emit(text, this.phase); return; }
    this.buffer += text;
    if (!this.started) {
      const marker = markers.find(marker => this.buffer.startsWith(marker.prefix));
      if (marker) {
        this.phase = nativePhase ?? marker.phase;
        this.buffer = this.buffer.slice(marker.prefix.length);
        this.afterMarker = true;
      } else if (markers.some(marker => marker.prefix.startsWith(this.buffer))) return;
      this.started = true;
    }
    if (this.afterMarker) {
      if (!this.buffer || this.buffer === '\r') return;
      this.buffer = this.buffer.replace(/^\r?\n/, '');
      this.afterMarker = false;
    }
    if (this.buffer) this.emit(this.buffer, this.phase);
    this.buffer = '';
  }
  finish() {
    if (!this.started && this.buffer) throw new AssistantRunError('incomplete', '模型的回答阶段标记未完整返回');
    if (this.buffer) this.emit(this.buffer, this.phase);
    this.buffer = '';
  }
}

export function decodeAssistantText(text: string, phase?: AssistantTextPhase) {
  let content = '';
  const decoder = new AssistantTextDecoder(value => { content += value; });
  decoder.push(text, phase); decoder.finish();
  return { content, phase: phase ?? decoder.phase };
}
