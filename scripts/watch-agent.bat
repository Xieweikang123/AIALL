@echo off
cd /d "%~dp0..\src-tauri"
cargo watch -q -w src -w Cargo.toml --poll --delay 1 -s "powershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0..\scripts\restart-agent.ps1"""
