@echo off
cd /d "%~dp0artcam-classic"
start "Carving Studio Classic" /min node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4318 --strictPort
start "" "http://127.0.0.1:4318/"
