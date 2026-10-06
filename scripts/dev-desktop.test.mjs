import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { desktopDevConfig, selectDevPort } from './dev-desktop.mjs';

it('uses a free preferred port', async () => {
  const port = await selectDevPort(0);
  expect(await selectDevPort(port)).toBe(port);
});

it('selects another port without stopping the existing listener and keeps Tauri and Vite in sync', async () => {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  try {
    const occupiedPort = listener.address().port;
    const port = await selectDevPort(occupiedPort);
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(occupiedPort);
    expect(listener.listening).toBe(true);
    const config = desktopDevConfig(port);
    expect(new URL(config.build.devUrl).port).toBe(String(port));
    expect(config.build.beforeDevCommand).toContain(`--host 127.0.0.1 --port ${port}`);
    expect(config.build.beforeDevCommand).toContain('npm run build -w @tano/mcp');
  } finally {
    await new Promise((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('reports listen errors other than port conflicts', async () => {
  await expect(selectDevPort(-1)).rejects.toThrow();
});

it.skipIf(process.platform !== 'win32')(
  'prints Chinese errors through the Windows batch launcher without executing them',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tano desktop launcher '));
    try {
      await mkdir(join(directory, 'scripts'));
      await copyFile(
        new URL('../local-desktop.bat', import.meta.url),
        join(directory, 'local-desktop.bat'),
      );
      await writeFile(
        join(directory, 'scripts/local-desktop.mjs'),
        "console.error('[错误] 桌面启动失败，请查看上方具体错误。'); process.exitCode = 1;\n",
      );
      const result = spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/c', 'local-desktop.bat'],
        {
          cwd: directory,
          input: '\n',
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[错误] 桌面启动失败，请查看上方具体错误。');
      expect(result.stderr).not.toContain('is not recognized');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
