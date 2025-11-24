@echo off
echo Starting Pluely in Development Mode...
cd /d "%~dp0"
npm run tauri dev
pause
