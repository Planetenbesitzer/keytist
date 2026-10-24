@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it, then open this file again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo The built application is missing. Extract the complete ZIP archive first.
  pause
  exit /b 1
)
echo Slide Studio
echo Open http://127.0.0.1:4178 in your browser.
echo Keep this window open. Press Ctrl+C to stop.
node scripts\serve.mjs
if errorlevel 1 pause
