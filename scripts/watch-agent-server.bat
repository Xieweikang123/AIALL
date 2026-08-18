@echo off
chcp 65001 >nul
title agent-server watch (dev)

REM ============================================================
REM  agent-server dev mode: watches src-tauri sources.
REM  When any .rs / Cargo.toml is newer than the exe, it
REM  rebuilds and restarts the 8787 server automatically.
REM  Usage: run this script in its own window; edit Rust code
REM  and save - the server restarts itself in ~2 seconds.
REM  The frontend (vite) already hot-reloads, no need here.
REM  Ctrl+C to exit.
REM ============================================================

set "ROOT=%~dp0.."
set "EXE=%ROOT%\src-tauri\target\debug\agent-server.exe"

echo Watching %ROOT%\src-tauri\src (*.rs) and Cargo.toml ...
echo On save, agent-server (127.0.0.1:8787) rebuilds and restarts automatically.
echo.

:loop
timeout /t 2 /nobreak >nul

REM Exit code: 0 = rebuild needed, 1 = up to date
powershell -NoProfile -Command "$exe='%EXE%'; if(-not (Test-Path $exe)){exit 0}; $n=Get-ChildItem -Path '%ROOT%\src-tauri\src' -Recurse -Filter *.rs | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $t=Get-Item '%ROOT%\src-tauri\Cargo.toml'; if($n -and ($n.LastWriteTime -gt (Get-Item $exe).LastWriteTime -or $t.LastWriteTime -gt (Get-Item $exe).LastWriteTime)){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 goto :loop

echo [%date% %time%] Source changed. Rebuilding and restarting agent-server ...
REM Stop old process first (releases the exe file lock so build can overwrite)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787 " ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

cd /d "%ROOT%\src-tauri"
REM Ensure cargo is on PATH (rustup installs to %USERPROFILE%\.cargo\bin)
where cargo >nul 2>&1
if errorlevel 1 (
  if not exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
    echo [ERROR] cargo not found. Please install Rust from https://rustup.rs
    cd /d "%ROOT%"
    goto :loop
  )
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)
cargo build --bin agent-server
if errorlevel 1 (
  echo [%date% %time%] Build failed. Will retry on next change.
  cd /d "%ROOT%"
  goto :loop
)
start "Agent-Server" /min "%EXE%"
cd /d "%ROOT%"
echo [%date% %time%] agent-server restarted (127.0.0.1:8787)
goto :loop
