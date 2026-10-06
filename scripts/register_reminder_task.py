"""注册每日提醒计划任务（P1-3）。

运行一次即可：
  python scripts/register_reminder_task.py

效果：注册 Windows 计划任务「Worktodolist每日提醒」，每天 09:00 运行
daily_reminder.py，把今天到期/逾期的任务弹窗告知（应用没打开也会提醒）。
重复运行安全（/F 覆盖同名的旧任务）。沙箱/受限环境里 schtasks 被拦截时
会明确报出来——该功能只能在真实环境人工验证。

删除：
  schtasks /Delete /TN "Worktodolist每日提醒" /F
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMINDER_SCRIPT = os.path.join(HERE, 'scripts', 'daily_reminder.py')
TASK_NAME = 'Worktodolist每日提醒'


def main():
    if not os.path.isfile(REMINDER_SCRIPT):
        print('找不到提醒脚本：%s' % REMINDER_SCRIPT)
        return 1

    # 用当前 Python 的绝对路径注册，避免计划任务运行时 PATH 里没有 python
    python = sys.executable or 'python'
    action = '"%s" "%s"' % (python, REMINDER_SCRIPT)
    cmd = [
        'schtasks', '/Create',
        '/TN', TASK_NAME,
        '/TR', action,
        '/SC', 'DAILY',
        '/ST', '09:00',
        '/F',
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding='utf-8', errors='replace', check=False)
    except OSError as exc:
        print('无法调用 schtasks：%s\n本功能需要在真实 Windows 环境手动注册。' % exc)
        return 1

    if proc.returncode == 0:
        print('已注册计划任务「%s」：每天 09:00 弹窗提醒今天到期/逾期的任务。' % TASK_NAME)
        print('如需删除：schtasks /Delete /TN "%s" /F' % TASK_NAME)
        return 0

    print('注册失败（exit %d）：%s' % (proc.returncode, (proc.stderr or proc.stdout or '').strip()))
    print('注意：某些受限/沙箱环境会拦截 schtasks.exe；请在真实桌面环境重试。')
    return 1


if __name__ == '__main__':
    sys.exit(main())
