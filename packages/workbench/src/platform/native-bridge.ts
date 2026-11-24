/**
 * Single Tauri IPC / Window / Event / Dialog gateway for `@tano/workbench`.
 * All workbench modules must call native APIs through this bridge rather than
 * importing `@tauri-apps/*` directly.
 */
import * as tauriCore from '@tauri-apps/api/core';
import * as tauriDpi from '@tauri-apps/api/dpi';
import * as tauriEvent from '@tauri-apps/api/event';
import * as tauriWebviewWindow from '@tauri-apps/api/webviewWindow';
import * as tauriWindow from '@tauri-apps/api/window';
import * as tauriDialog from '@tauri-apps/plugin-dialog';

export type { Channel, InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';
export type { EventCallback, Options as EventOptions, UnlistenFn } from '@tauri-apps/api/event';
export type { PhysicalPosition } from '@tauri-apps/api/dpi';
export type { WebviewOptions } from '@tauri-apps/api/webview';
export type { WebviewWindow } from '@tauri-apps/api/webviewWindow';
export type { Window as NativeWindow, WindowOptions } from '@tauri-apps/api/window';
export type { OpenDialogOptions, SaveDialogOptions } from '@tauri-apps/plugin-dialog';

export function isNativeRuntime(): boolean {
  return tauriCore.isTauri();
}

export function nativeInvoke<T>(
  ...args: Parameters<typeof tauriCore.invoke>
): Promise<T> {
  return tauriCore.invoke<T>(...args);
}

export function nativeConvertFileSrc(
  ...args: Parameters<typeof tauriCore.convertFileSrc>
): string {
  return tauriCore.convertFileSrc(...args);
}

export function createNativeChannel<T = unknown>(): tauriCore.Channel<T> {
  return new tauriCore.Channel<T>();
}

export function nativeEmit(...args: Parameters<typeof tauriEvent.emit>): Promise<void> {
  return tauriEvent.emit(...args);
}

export function nativeEmitTo(...args: Parameters<typeof tauriEvent.emitTo>): Promise<void> {
  return tauriEvent.emitTo(...args);
}

export function nativeListen<T>(
  event: string,
  handler: tauriEvent.EventCallback<T>,
  ...rest: [tauriEvent.Options?]
): Promise<tauriEvent.UnlistenFn> {
  return tauriEvent.listen<T>(event, handler, ...rest);
}

export function getNativeCurrentWindow(): tauriWindow.Window {
  return tauriWindow.getCurrentWindow();
}

export function getNativeWindowByLabel(label: string): Promise<tauriWindow.Window | null> {
  return tauriWindow.Window.getByLabel(label);
}

export function nativeCursorPosition() {
  return tauriWindow.cursorPosition();
}

export function nativeMonitorFromPoint(x: number, y: number) {
  return tauriWindow.monitorFromPoint(x, y);
}

export function createNativeWebviewWindow(
  ...args: ConstructorParameters<typeof tauriWebviewWindow.WebviewWindow>
): tauriWebviewWindow.WebviewWindow {
  return new tauriWebviewWindow.WebviewWindow(...args);
}

export function createNativePhysicalPosition(
  position: { x: number; y: number },
): tauriDpi.PhysicalPosition {
  return new tauriDpi.PhysicalPosition(position);
}

export function nativeOpenDialog<T extends tauriDialog.OpenDialogOptions>(
  ...args: [T?]
) {
  return tauriDialog.open(...args);
}

export function nativeSaveDialog(...args: Parameters<typeof tauriDialog.save>) {
  return tauriDialog.save(...args);
}
