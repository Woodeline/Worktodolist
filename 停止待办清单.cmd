@echo off
rem Stops the background server launched by the desktop TodoList icon.
rem (Folder / file name is Chinese, but the contents stay pure ASCII on purpose:
rem  cmd.exe in a non-UTF8 console codepage would otherwise garble the text.)
cd /d "%~dp0"

rem Prefer the WorkBuddy managed Python; fall back to whatever pythonw is on PATH
set "PYW=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw"

"%PYW%" "%~dp0stop_todolist.py"
exit /b 0
