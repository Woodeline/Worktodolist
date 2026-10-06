@echo off
title Todolist - diagnostics window
cd /d "%~dp0"

rem Thin wrapper: node discovery and port selection live in launch_todolist.py.
rem This window uses python.exe (not pythonw.exe) so vite's output is visible,
rem which is exactly what you need when the desktop icon reports a startup failure.
set "PY=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" "%~dp0launch_todolist.py" --show-window

echo.
echo   Launcher finished. If the app started, you can close this window any time.
echo   The server keeps running; use the stop launcher in this folder to stop it.
pause
