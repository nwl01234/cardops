@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-demo.ps1"
exit /b %errorlevel%
