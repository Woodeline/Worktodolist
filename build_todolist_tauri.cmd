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
rem
rem Every run also leaves breadcrumbs in .todolist-build.log (start / cwd /
rem resolved npm / rc): a build that dies in a fraction of a second leaves no
rem window behind to inspect, and the launcher used to be able to report only
rem "rc=1" for it.
title Building Worktodolist (Tauri) - please wait, do not close

set "HERE=%~dp0"
set "LOG=%HERE%.todolist-build.log"
set "RC=0"

rem Breadcrumbs go into the log as well as the window: a build that dies in a
rem fraction of a second (window closed, npm missing) would otherwise leave no
rem trace at all, and the launcher can only report "rc=1".
>>"%LOG%" echo.
>>"%LOG%" echo ==== build window %DATE% %TIME% ====

rem npm must resolve inside this window. Double-clicking the desktop icon hands
rem this process the environment Explorer has cached, which can predate the Node
rem install, so fall back to the known Node locations instead of failing blind.
rem (Labels, not a (...) block: %NODEDIR% inside a block would expand at parse
rem time -- empty -- and the prepend below would silently do nothing.)
where npm >nul 2>&1
if not errorlevel 1 goto :npm_ready
set "NODEDIR="
for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do if exist "%%~fD\npm.cmd" set "NODEDIR=%%~fD"
if not defined NODEDIR if exist "C:\Program Files\nodejs\npm.cmd" set "NODEDIR=C:\Program Files\nodejs"
if not defined NODEDIR if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "NODEDIR=C:\Program Files (x86)\nodejs"
if not defined NODEDIR goto :npm_ready
>>"%LOG%" echo npm was not on PATH; using "%NODEDIR%"
set "PATH=%NODEDIR%;%PATH%"
:npm_ready

cd /d "%HERE%todolist-gui"
if not exist "package.json" (
  set "RC=3"
  echo.
  echo   Cannot find todolist-gui\package.json under "%HERE%" -- build aborted.
  >>"%LOG%" echo ABORT: cannot enter todolist-gui, or package.json missing, under %HERE%
  goto :report
)

where npm >nul 2>&1
if errorlevel 1 (
  set "RC=2"
  echo.
  echo   npm was not found, so the build cannot start. Install Node.js, or run
  echo     python launch_todolist_tauri.py --status
  echo   to see what this machine resolves.
  >>"%LOG%" echo ABORT: npm not found on PATH
  goto :report
)

echo.
echo   Rebuilding Worktodolist from source...
echo   (tauri build --no-bundle: frontend + Rust release, installer skipped)
echo.
>>"%LOG%" echo cwd=%CD%
where npm >>"%LOG%" 2>&1

call npm run build:app
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo finished rc=%RC% at %DATE% %TIME%

:report

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
