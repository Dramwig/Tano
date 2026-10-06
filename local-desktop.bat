@echo off
setlocal
chcp 65001 >nul
title Tano - Local Desktop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Install Node.js 24.12 or newer, then reopen this file.
  pause
  exit /b 1
)
node scripts\local-desktop.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
endlocal
