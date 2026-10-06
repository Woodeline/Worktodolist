"""在桌面生成 topydo 一键启动器（.bat）。

- 内容走纯 cmd 语法，用 goto 分支避免括号块转义问题；
- 文件以 CRLF + UTF-8 写入，并在开头 chcp 65001，保证中文提示不乱码；
- 只创建文件，不修改任何系统设置。
"""
import os

DESKTOP = os.path.join(os.path.expanduser("~"), "Desktop")
TARGET = os.path.join(DESKTOP, "topydo 启动器.bat")

LINES = [
    "@echo off",
    "chcp 65001 >nul 2>&1",
    "title topydo",
    'cd /d "%USERPROFILE%\\WorkBuddy\\todolist"',
    "",
    'set "TOPYDO=%USERPROFILE%\\bin\\topydo.cmd"',
    'if not exist "%TOPYDO%" goto missing',
    "",
    "echo.",
    "echo   ==============================================",
    "echo     topydo 0.16  -  todo.txt 任务清单",
    "echo   ==============================================",
    "echo.",
    "echo     [1] 交互模式 prompt   ^(推荐^: 连续敲命令, 输入 exit 退出^)",
    "echo     [2] 查看清单 ls",
    "echo     [3] 列式界面 columns  ^(vim 式按键, :q 退出^)",
    "echo     [4] 退出",
    "echo.",
    'set /p "choice=  请输入序号后回车 [默认 1]: "',
    'if "%choice%"=="" set "choice=1"',
    "",
    'if "%choice%"=="1" goto prompt',
    'if "%choice%"=="2" goto list',
    'if "%choice%"=="3" goto columns',
    'if "%choice%"=="4" goto end',
    "echo   输入无效, 按默认进入 [1] 交互模式",
    "",
    ":prompt",
    "echo.",
    'call "%TOPYDO%" prompt',
    "goto done",
    "",
    ":list",
    "echo.",
    'call "%TOPYDO%" ls',
    "goto done",
    "",
    ":columns",
    "echo.",
    'call "%TOPYDO%" columns',
    "goto done",
    "",
    ":done",
    "echo.",
    "echo   [已退出 topydo]  按任意键关闭本窗口",
    "pause >nul",
    "goto end",
    "",
    ":missing",
    "echo.",
    'echo   找不到 topydo: "%TOPYDO%"',
    "echo   请确认 C:\\Users\\<用户名>\\bin\\topydo.cmd 与 .venv-topydo 虚拟环境仍然存在。",
    "echo   ^(若已卸载, 本启动器可直接删除^)",
    "pause",
    "",
    ":end",
]

with open(TARGET, "w", encoding="utf-8", newline="\r\n") as f:
    f.write("\n".join(LINES) + "\n")

print("已生成:", TARGET)
print("大小  : %d bytes" % os.path.getsize(TARGET))
print()
print(open(TARGET, encoding="utf-8").read())
