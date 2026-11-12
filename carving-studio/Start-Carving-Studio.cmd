@echo off
cd /d "%~dp0"
start "Carving Studio Original" /min node server.mjs
start "" "http://127.0.0.1:4317/"
