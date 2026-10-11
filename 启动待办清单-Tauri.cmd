@echo off
title Todolist Tauri - diagnostics window
cd /d "%~dp0"

rem Thin wrapper: all logic lives in launch_todolist_tauri.py.
rem This window uses python.exe (not pythonw.exe) so build/launch output is visible,
rem which is exactly what you need when the desktop icon reports a startup failure.
rem
rem Contents stay pure ASCII on purpose: cmd.exe in a non-UTF8 console codepage
rem would otherwise garble the text.
set "PY=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" "%~dp0launch_todolist_tauri.py" --show-window %*

echo.
echo   Launcher finished. If the app started, you can close this window any time.
echo   For a pure status report run:  python launch_todolist_tauri.py --status
pause
