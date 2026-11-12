@echo off
cd /d "%~dp0"
call npm ci --prefix artcam-classic
if errorlevel 1 exit /b 1
node artcam-classic\scripts\make-mcp-config.mjs
pause
