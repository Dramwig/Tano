import { expect, it, vi } from 'vitest';
import { UpdateController } from './controller';
import type { UpdateHost } from './controller';

function fixture() {
  const host: UpdateHost = {
    status: vi.fn(async () => ({ currentVersion: '0.1.0', configured: true, reason: null })),
    check: vi.fn(async () => ({
      id: 'native-candidate',
      version: '0.2.0',
      notes: 'Release notes',
    })),
    download: vi.fn(async (_id, progress) => {
      progress({ downloaded: 100, total: 100 });
    }),
    install: vi.fn(async () => {
      throw new Error('installer refused');
    }),
    flush: vi.fn(async () => true),
    disconnect: vi.fn(async () => {}),
  };
  const controller = new UpdateController(host, vi.fn());
  return { host, controller };
}

it('checks automatically when configured but never downloads or installs automatically', async () => {
  const { host, controller } = fixture();
  await controller.initialize();
  expect(controller.phase).toBe('available');
  expect(host.check).toHaveBeenCalledOnce();
  expect(host.download).not.toHaveBeenCalled();
  expect(host.install).not.toHaveBeenCalled();
  await controller.initialize();
  expect(host.check).toHaveBeenCalledOnce();
});

it('does not contact a feed when the binary has no pinned release configuration', async () => {
  const { host, controller } = fixture();
  vi.mocked(host.status).mockResolvedValue({
    currentVersion: '0.1.0',
    configured: false,
    reason: 'unconfigured',
  });
  await controller.initialize();
  await controller.check();
  expect(host.check).not.toHaveBeenCalled();
});

it('announces Local versions and opens only the public Core release without entering the installer path', async () => {
  const { host, controller } = fixture();
  const url = 'https://github.com/Dramwig/Tano/releases/tag/core-v1.2.3';
  host.openRelease = vi.fn(async () => {});
  vi.mocked(host.status).mockResolvedValue({ configured: false, currentVersion: '1.2.2', reason: 'manual', manual: true });
  vi.mocked(host.check).mockResolvedValue({ id: 'core-v1.2.3', version: '1.2.3', notes: '', manualUrl: url });
  await controller.initialize();
  expect(controller.phase).toBe('available');
  await controller.download();
  expect(host.openRelease).toHaveBeenCalledWith(url);
  expect(host.download).not.toHaveBeenCalled();
  controller.phase = 'ready';
  await controller.install();
  expect(host.install).not.toHaveBeenCalled();
  expect(host.flush).not.toHaveBeenCalled();
  controller.phase = 'available';
  controller.candidate!.manualUrl = 'https://example.com/setup.exe';
  await controller.download();
  expect(controller.error).toContain('链接无效');
  expect(host.openRelease).toHaveBeenCalledOnce();
});

it('retries a failed status request through manual check', async () => {
  const { host, controller } = fixture();
  vi.mocked(host.status).mockRejectedValueOnce(new Error('status IPC unavailable'));
  await controller.initialize();
  expect(controller.error).toContain('status IPC unavailable');
  expect(controller.busy).toBe(false);
  await controller.check();
  expect(host.status).toHaveBeenCalledTimes(2);
  expect(host.check).toHaveBeenCalledOnce();
  expect(controller.phase).toBe('available');
  expect(controller.error).toBe('');
});

it('serializes concurrent initialization and manual checks while loading status', async () => {
  const { host, controller } = fixture();
  let finish!: (value: Awaited<ReturnType<UpdateHost['status']>>) => void;
  vi.mocked(host.status).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const initializing = controller.initialize();
  expect(controller.busy).toBe(true);
  await controller.initialize();
  await controller.check();
  expect(host.status).toHaveBeenCalledOnce();
  finish({ configured: true, currentVersion: '0.1.0', reason: null });
  await initializing;
  expect(host.check).toHaveBeenCalledOnce();
});

it('never enables installation after an invalid signature or download failure', async () => {
  const { host, controller } = fixture();
  vi.mocked(host.download).mockRejectedValue(new Error('signature mismatch'));
  await controller.initialize();
  await controller.download();
  await controller.install();
  expect(controller.phase).toBe('available');
  expect(controller.error).toContain('signature mismatch');
  expect(host.install).not.toHaveBeenCalled();
  expect(host.flush).not.toHaveBeenCalled();
});

it('cancels installation on an unsaved conflict, then flushes both sides of collaboration shutdown', async () => {
  const { host, controller } = fixture();
  await controller.initialize();
  await controller.download();
  vi.mocked(host.flush).mockResolvedValueOnce(false);
  await controller.install();
  expect(host.disconnect).not.toHaveBeenCalled();
  expect(host.install).not.toHaveBeenCalled();
  expect(controller.phase).toBe('ready');
  const order: string[] = [];
  vi.mocked(host.flush).mockImplementation(async () => {
    order.push('flush');
    return true;
  });
  vi.mocked(host.disconnect).mockImplementation(async () => {
    order.push('disconnect');
  });
  vi.mocked(host.install).mockImplementation(async () => {
    order.push('install');
    throw new Error('installer refused');
  });
  await controller.install();
  expect(order).toEqual(['flush', 'disconnect', 'flush', 'install']);
  expect(controller.phase).toBe('idle');
  expect(controller.candidate).toBeUndefined();
});

it('retains the verified update when collaboration persistence fails and refuses duplicate download', async () => {
  const { host, controller } = fixture();
  let finish!: () => void;
  vi.mocked(host.download).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await controller.initialize();
  const downloading = controller.download();
  await controller.download();
  await controller.check();
  expect(host.download).toHaveBeenCalledOnce();
  finish();
  await downloading;
  vi.mocked(host.disconnect).mockRejectedValue(new Error('draft write failed'));
  await controller.install();
  expect(controller.phase).toBe('ready');
  expect(controller.error).toContain('draft write failed');
  expect(host.install).not.toHaveBeenCalled();
});
