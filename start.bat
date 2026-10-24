@echo off
cd /d "%~dp0"
rem Debug start: asks a running AI Roundtable to quit (only after verifying its lock file and identity), then runs it in this window.
node app\server.js --replace
pause
