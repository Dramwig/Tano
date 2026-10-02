@echo off
if /i "%~1"=="--tano-web-run" goto run
"%ComSpec%" /d /k ""%~f0" --tano-web-run"
exit /b

:run
setlocal
chcp 65001 >nul
title Tano - Local Frontend
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

node scripts\check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo 正在安装项目依赖，首次启动可能需要几分钟...
  call npm ci
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查上方提示。
    pause
    exit /b 1
  )
)

echo 正在启动同页前端，浏览器将自动打开 http://127.0.0.1:43841
echo 浏览器演示直接进入工作台，数据保存在浏览器中。请保留此窗口，关闭窗口即可停止前端服务。
echo.
call npm run dev -w @tano/client -- --host 127.0.0.1 --open
if errorlevel 1 (
  echo.
  echo [错误] 前端启动失败。若 43841 端口已占用，请先关闭之前的浏览器前端服务。
  pause
  exit /b 1
)
echo.
echo 前端服务已停止。请检查上方输出。
pause
endlocal
