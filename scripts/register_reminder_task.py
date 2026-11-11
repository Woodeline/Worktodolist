"""注册／删除「每日提醒」计划任务（Windows）。

提醒逻辑在应用自身（`src-tauri/src/reminder.rs`），不需要 Python：
计划任务只要每天拉起一次 `Worktodolist.exe --reminder`，壳会算好今天到期／
逾期的任务、弹系统通知，然后自己退出（无窗口、无托盘图标）。

用法：
  python scripts/register_reminder_task.py            # 注册／覆盖，每天 09:00
  python scripts/register_reminder_task.py --time 8:30
  python scripts/register_reminder_task.py --delete   # 删除该任务
  python scripts/register_reminder_task.py --dry-run  # 只打印将要执行的命令

应用**正在运行**时提醒由壳自己弹，这条计划任务只为「应用没打开」兜底。
重复运行安全（`/F` 覆盖同名任务）。受限环境里 schtasks 被拦截会明确报错。
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE_NAME = 'Worktodolist.exe'
TASK_NAME = 'Worktodolist每日提醒'

# 定位顺序与 launch_todolist_tauri.py 一致：先仓库内产物，再安装版。
CANDIDATES = [
    os.path.join(HERE, 'todolist-gui', 'src-tauri', 'target', 'release', EXE_NAME),
    os.path.join(HERE, 'todolist-gui', 'src-tauri', 'target', 'debug', EXE_NAME),
]
for _env in ('LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'):
    _base = os.environ.get(_env)
    if _base:
        CANDIDATES.append(os.path.join(_base, 'Programs', 'Worktodolist', EXE_NAME))
        CANDIDATES.append(os.path.join(_base, 'Worktodolist', EXE_NAME))


def find_exe(explicit=None):
    if explicit:
        return explicit if os.path.isfile(explicit) else None
    for path in CANDIDATES:
        if os.path.isfile(path):
            return path
    return None


def run(cmd, dry_run=False):
    printable = ' '.join('"%s"' % c if ' ' in c else c for c in cmd)
    if dry_run:
        print('[dry-run] %s' % printable)
        return 0
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding='utf-8', errors='replace', check=False)
    except OSError as exc:
        print('无法调用 schtasks：%s\n本功能需要在真实 Windows 环境执行。' % exc)
        return 1
    if proc.returncode != 0:
        print('schtasks 退出码 %d：%s' % (proc.returncode,
                                          (proc.stderr or proc.stdout or '').strip()))
        print('注意：某些受限/沙箱环境会拦截 schtasks.exe；请在真实桌面环境重试。')
    return proc.returncode


def main():
    ap = argparse.ArgumentParser(description='注册/删除每日提醒计划任务')
    ap.add_argument('--time', default='09:00', help='每天触发时间 HH:MM，默认 09:00')
    ap.add_argument('--exe', default=None, help='显式指定 Worktodolist.exe 路径')
    ap.add_argument('--delete', action='store_true', help='删除该计划任务')
    ap.add_argument('--dry-run', action='store_true', help='只打印命令，不执行')
    args = ap.parse_args()

    if args.delete:
        code = run(['schtasks', '/Delete', '/TN', TASK_NAME, '/F'], args.dry_run)
        if code == 0:
            print('已删除计划任务「%s」。' % TASK_NAME)
        return code

    exe = find_exe(args.exe)
    if not exe:
        print('找不到 %s，先构建一次（sh build-mac.sh / build_todolist_tauri.cmd）'
              '或用 --exe 指定路径。' % EXE_NAME)
        return 1

    # --reminder：无界面实例，算完提醒就退出（见 src-tauri/src/lib.rs）。
    action = '"%s" --reminder' % exe
    cmd = ['schtasks', '/Create', '/TN', TASK_NAME, '/TR', action,
           '/SC', 'DAILY', '/ST', args.time, '/F']
    code = run(cmd, args.dry_run)
    if code == 0:
        print('已注册「%s」：每天 %s 运行 %s --reminder' % (TASK_NAME, args.time, exe))
        print('删除：python scripts/register_reminder_task.py --delete')
    return code


if __name__ == '__main__':
    sys.exit(main())
