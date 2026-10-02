@echo off
setlocal
chcp 65001 >nul
title Tano - Local Desktop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 请先安装 Node.js 24.12 或更新版本，然后重新打开本文件。
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 npm，请检查 Node.js 安装和 PATH 配置。
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\check-desktop.ps1"
if errorlevel 1 (
  echo.
  echo [错误] 桌面开发工具链检查失败，请根据上方提示安装所需组件。
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" goto install_dependencies
if not exist "node_modules\@tauri-apps\cli\tauri.js" goto install_dependencies
goto start_desktop

:install_dependencies
echo 正在安装项目依赖，首次启动可能需要几分钟...
call npm ci
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查上方提示。
  pause
  exit /b 1
)

:start_desktop
echo 正在启动同页桌面开发版。首次编译 Rust 可能需要较长时间。
echo 请保留此窗口，关闭窗口即可停止桌面开发服务。
echo.
call npm run desktop
if errorlevel 1 (
  echo.
  echo [错误] 桌面启动失败。若 43842 端口已占用，请先关闭之前的桌面开发服务。
  pause
  exit /b 1
)
endlocal
