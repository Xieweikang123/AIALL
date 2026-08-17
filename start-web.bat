@echo off
chcp 65001 >nul
title AIALL Web Service

echo ========================================
echo   AIALL Web Service Starting...
echo ========================================

REM Start backend agent-server in background
echo [1/2] Starting backend agent-server...
start "Agent-Server" /min "%~dp0src-tauri\target\debug\agent-server.exe"

REM Wait for backend to be ready
echo [2/2] Waiting for backend...
timeout /t 2 /nobreak >nul

REM Start frontend dev server
echo Starting frontend dev server...
cd /d "%~dp0"
npm run dev:web
