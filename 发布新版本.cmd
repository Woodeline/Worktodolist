@echo off
rem One-click release: build -> verify -> tag -> create GitHub Release -> upload assets.
rem (The file name is Chinese, but the contents stay pure ASCII on purpose: cmd.exe in a
rem  non-UTF8 console codepage would otherwise garble the text.)
rem
rem Usage:
rem   发布新版本.cmd                 full chain (reads version from todolist-gui\package.json)
rem   发布新版本.cmd --skip-build    reuse the artifacts already in release\
rem   发布新版本.cmd --draft         create the Release as a draft
rem   发布新版本.cmd --dry-run       print the plan only
title Worktodolist release
cd /d "%~dp0"

rem Prefer the WorkBuddy managed Python; fall back to whatever python is on PATH.
set "PY=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" set "PY=python"

echo.
echo === Worktodolist release pipeline ===
echo   build -^> verify -^> tag -^> create Release -^> upload assets
echo.

"%PY%" "%~dp0scripts\release_github.py" %*
set "RC=%ERRORLEVEL%"

echo.
echo Exit code: %RC%
echo.
pause
exit /b %RC%
