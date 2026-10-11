@echo off
rem Stops the running Worktodolist.exe (Tauri desktop build).
rem (Folder / file name is Chinese, but the contents stay pure ASCII on purpose:
rem  cmd.exe in a non-UTF8 console codepage would otherwise garble the text.)
cd /d "%~dp0"

rem Prefer the WorkBuddy managed Python; fall back to whatever pythonw is on PATH
set "PYW=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw"

"%PYW%" "%~dp0launch_todolist_tauri.py" --stop --quiet
exit /b 0
