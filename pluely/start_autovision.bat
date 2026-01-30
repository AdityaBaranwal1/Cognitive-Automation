@echo off
echo Starting Auto-Vision in Development Mode...
cd /d "%~dp0"
npm run tauri dev
pause
