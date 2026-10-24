@echo off
cd /d "%~dp0"
rem 先關掉還在執行的舊討論室（只關佔用 3456 的程式）
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
node server.js
pause
