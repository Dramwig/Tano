import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function availablePort(port, host) {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port, host, exclusive: true }, () => {
      const selected = server.address().port;
      server.close((error) => (error ? reject(error) : resolvePort(selected)));
    });
  });
}

export async function selectDevPort(preferredPort, host = '127.0.0.1') {
  try {
    return await availablePort(preferredPort, host);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    return availablePort(0, host);
  }
}

export function desktopDevConfig(port) {
  return {
    build: {
      devUrl: `http://127.0.0.1:${port}`,
      beforeDevCommand: `npm run build -w @tano/mcp && npm run dev -- --host 127.0.0.1 --port ${port}`,
    },
  };
}

async function main() {
  const base = JSON.parse(
    readFileSync(resolve(root, 'apps/client/src-tauri/tauri.conf.json'), 'utf8'),
  );
  const preferredPort = Number(new URL(base.build.devUrl).port);
  const port = await selectDevPort(preferredPort);
  if (port !== preferredPort) {
    console.log(`端口 ${preferredPort} 已占用，桌面开发服务改用 http://127.0.0.1:${port}。`);
  }
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'),
      'dev',
      '--config',
      JSON.stringify(desktopDevConfig(port)),
      ...process.argv.slice(2),
    ],
    { cwd: resolve(root, 'apps/client'), stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[错误] 桌面启动失败：${error.message}`);
    process.exitCode = 1;
  });
}
