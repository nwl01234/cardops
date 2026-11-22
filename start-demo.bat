@echo off
setlocal
chcp 65001 >nul
title CardOps demo
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [CardOps] Node.js was not found. Install Node.js 22+ and try again.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo [CardOps] Node.js 22+ is required. Current version:
  node --version
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [CardOps] Installing dependencies. This can take a couple of minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [CardOps] npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [CardOps] Created .env from .env.example.
)

echo [CardOps] Cleaning stale project processes...
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-demo.ps1" >nul 2>&1

echo [CardOps] Starting PostgreSQL, Redis, NATS, API, notifications, OCR and web...
echo [CardOps] Press Ctrl+C or run stop-demo.bat to stop everything cleanly.
call node scripts/dev.mjs
exit /b %errorlevel%
