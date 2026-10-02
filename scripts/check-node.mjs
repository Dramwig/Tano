import { readFileSync } from 'node:fs';

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const minimum = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/.exec(engines.node);
if (!minimum) throw new Error(`Unsupported Node.js engine requirement: ${engines.node}`);

const required = minimum.slice(1).map((part) => Number(part ?? 0));
const current = process.versions.node.split('.').map(Number);
const difference = current.map((part, index) => part - required[index]).find((part) => part !== 0) ?? 0;

if (difference < 0) {
  console.error(`[错误] 当前 Node.js ${process.version}，项目要求 ${engines.node}。`);
  console.error('请安装满足要求的 Node.js 并重新打开终端；使用 nvm-windows 时，请安装并切换到 Node.js 24。');
  console.error(`当前 Node.js 路径：${process.execPath}`);
  process.exitCode = 1;
}
