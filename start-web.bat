@echo off
chcp 65001 >nul
title AIALL Web Service

echo ========================================
echo   AIALL Web Service Starting...
echo ========================================

REM ---- Restart semantics: kill any existing agent-server (8787) / vite (5173) ----
echo [1/4] Stopping existing agent-server / vite if running ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787 " ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

REM Wait for ports to free (also releases the exe file lock so build can overwrite)
timeout /t 1 /nobreak >nul

REM ---- Decide whether to rebuild: exe missing, or any .rs / Cargo.toml newer than exe ----
REM PowerShell exit code: 2 = exe missing, 0 = source newer (rebuild), 1 = up to date
set "AGENT_EXE=%~dp0src-tauri\target\debug\agent-server.exe"
set "SRC_DIR=%~dp0src-tauri\src"
powershell -NoProfile -Command "$exe='%AGENT_EXE%'; if(-not (Test-Path $exe)){exit 2}; $newest=Get-ChildItem -Path '%SRC_DIR%' -Recurse -Filter *.rs | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $toml=Get-Item '%~dp0src-tauri\Cargo.toml'; if($newest -and ($newest.LastWriteTime -gt (Get-Item $exe).LastWriteTime -or $toml.LastWriteTime -gt (Get-Item $exe).LastWriteTime)){exit 0}else{exit 1}" >nul 2>&1
set "NEED_BUILD=%errorlevel%"

if "%NEED_BUILD%"=="1" (
  echo [2/4] Source up to date, skipping build
  goto :skip_build
)

echo [2/4] Source changed (or first run), building agent-server ...
cd /d "%~dp0src-tauri"
REM ---- Ensure cargo is on PATH (rustup installs to %USERPROFILE%\.cargo\bin) ----
where cargo >nul 2>&1
if errorlevel 1 (
  if not exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
    echo.
    echo [ERROR] cargo not found. Please install Rust from https://rustup.rs
    pause
    exit /b 1
  )
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)
cargo build --bin agent-server
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. See cargo output above.
  pause
  exit /b 1
)
cd /d "%~dp0"

:skip_build

REM ---- Start backend agent-server (minimized background window) ----
echo [3/4] Starting backend agent-server (127.0.0.1:8787) ...
start "Agent-Server" /min "%AGENT_EXE%"

REM ---- Wait for backend to be ready ----
echo [3/4] Waiting for backend ...
timeout /t 2 /nobreak >nul

REM ---- Start frontend dev server ----
echo [4/4] Starting frontend dev server (http://localhost:5173) ...
cd /d "%~dp0"
npm run dev:web

echo.
echo Frontend exited (Ctrl+C or an error). Window kept open for logs.
pause >nul
