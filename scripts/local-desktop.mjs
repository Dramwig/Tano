import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, failureMessage) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`${failureMessage}${result.error ? ` ${result.error.message}` : ''}`);
  }
}

try {
  run(process.execPath, [resolve(root, 'scripts/check-node.mjs')], 'Node.js 版本检查失败。');
  run(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'scripts/check-desktop.ps1'),
    ],
    '桌面开发工具链检查失败，请根据上方提示安装所需组件。',
  );

  console.log('正在检查并同步项目依赖，首次启动或依赖变更时可能需要几分钟...');
  run(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', 'npm install --no-audit --no-fund'],
    '依赖安装失败，请检查上方提示。',
  );

  console.log('正在启动同页桌面开发版。首次编译 Rust 可能需要较长时间。');
  console.log('请保留此窗口，关闭窗口即可停止桌面开发服务。');
  console.log('工作台加载完成后会自动显示主窗口；加载期间请查看此处的编译进度。');
  run(
    process.execPath,
    [resolve(root, 'scripts/dev-desktop.mjs')],
    '桌面启动失败，请查看上方具体错误。',
  );
} catch (error) {
  console.error(`\n[错误] ${error.message}`);
  process.exitCode = 1;
}
