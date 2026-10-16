@echo off
rem Build the Tauri desktop app (frontend + Rust shell) into the single exe
rem that launch_todolist_tauri.py starts. Invoked automatically by that launcher
rem whenever the source is newer than the built exe.
rem
rem This window is intentional: under pythonw.exe the launcher has no console,
rem so this is the only place the (slow) cargo output can be seen. Closing it
rem aborts the build.
rem
rem Contents stay pure ASCII on purpose: cmd.exe in a non-UTF8 console codepage
rem would otherwise garble the text.
title Building Worktodolist (Tauri) - please wait, do not close
cd /d "%~dp0todolist-gui"

echo.
echo   Rebuilding Worktodolist from source...
echo   (tauri build --no-bundle: frontend + Rust release, installer skipped)
echo.

call npm run build:app
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo   Build OK. Launching the new version...
) else (
  echo   Build FAILED ^(exit code %RC%^). The old version was left untouched.
)

rem Give the user a moment to read the result before this window vanishes.
rem (ping, not timeout: timeout errors out when stdin is redirected.)
ping -n 4 127.0.0.1 >nul 2>&1
exit /b %RC%
