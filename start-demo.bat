@echo off
REM ============================================================
REM  Starts both apps with sample data. No Supabase needed.
REM
REM  Opens two small windows (mock API + web server) and your
REM  browser. Close those two windows to stop everything.
REM
REM  NOTE: keep this file ASCII-only. Arabic text inside a .bat
REM  is mangled by the console codepage.
REM ============================================================
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Python was not found on PATH.
  echo   Install it from https://python.org and tick "Add to PATH".
  echo.
  pause
  exit /b 1
)

echo Starting mock API on port 5174 ...
start "shop-sales mock API"  cmd /k python tools\mock_supabase.py

echo Starting web server on port 5173 ...
start "shop-sales web"       cmd /k python -m http.server 5173 --directory app

REM Give both a moment to bind their ports before the browser asks for them.
timeout /t 3 /nobreak >nul

echo Opening the worker app ...
start "" "http://localhost:5173/?demo"

timeout /t 1 /nobreak >nul
echo Opening the owner dashboard ...
start "" "http://localhost:5173/owner/?demo"

echo.
echo   Worker app : http://localhost:5173/?demo
echo   Owner app  : http://localhost:5173/owner/?demo
echo   Sign in with ANY password.
echo.
echo   To stop: close the two windows named "shop-sales ...".
echo.
timeout /t 6 /nobreak >nul
