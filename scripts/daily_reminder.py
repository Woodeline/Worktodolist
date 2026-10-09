"""每日提醒：扫描 todo.txt，把今天到期 / 逾期的任务弹窗告知（P1-3）。

设计文档把提醒定为「页内今日到期区 + Windows 任务计划程序兜底」——页内区域
只在用户主动打开时可见，所以应用**没打开**时的提醒靠本脚本 + 计划任务：
  python scripts/daily_reminder.py

用 schtasks 注册每日 09:00 运行（见 register_reminder_task.py）。

解析规则刻意从简：只认 todo.txt 格式的 `due:YYYY-MM-DD` 标记，行级正则足够；
不引入 topydo 依赖，坏行直接跳过。弹窗用 WScript.Shell.Popup——不依赖任何
第三方 toast 库，Win10/11 开箱即用；没到期任务时**完全静默**（不弹「没事」）。
"""
import datetime
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODO_FILE = os.path.join(HERE, 'todo.txt')

# 计划任务用 pythonw（无控制台）跑：不给 powershell 子进程带 CREATE_NO_WINDOW
# 的话，每天 09:00 提醒时会闪一个控制台窗口。
CREATE_NO_WINDOW = 0x08000000 if os.name == 'nt' else 0
TITLE = '待办清单提醒'
MAX_LINES = 10

DUE_RE = re.compile(r'(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?:\s|$)')


def parse_tasks(text):
    """从 todo.txt 文本提取 (标题, due)；解析不了的行原样忽略。"""
    tasks = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = DUE_RE.search(line)
        if not match:
            continue
        title = DUE_RE.sub(' ', line).strip()
        # 去掉行首优先级与完成日期等 todo.txt 语法，只留人话标题
        title = re.sub(r'^\([A-Z]\)\s*', '', title)
        title = re.sub(r'^\d{4}-\d{2}-\d{2}\s+', '', title)
        title = re.sub(r'\s{2,}', ' ', title)
        tasks.append((title, match.group(1)))
    return tasks


def collect_reminders(today):
    try:
        with open(TODO_FILE, 'r', encoding='utf-8', errors='replace') as fh:
            tasks = parse_tasks(fh.read())
    except OSError:
        return []
    overdue, due_today = [], []
    for title, due in tasks:
        if due < today:
            overdue.append((title, due))
        elif due == today:
            due_today.append((title, due))
    return overdue + due_today


def popup(message):
    """WScript.Shell.Popup：无第三方依赖的系统弹窗。失败时静默（提醒是增强）。

    消息经环境变量传入——任务标题是用户数据，可能含引号/$/反引号等任何字符，
    拼进 PowerShell 字符串字面量迟早被注入；环境变量不经过解析器，天然安全。
    """
    script = (
        '$ws = New-Object -ComObject Wscript.Shell; '
        '$null = $ws.Popup($env:TODOLIST_MSG, 0, "%s", 48)' % TITLE
    )
    env = dict(os.environ, TODOLIST_MSG=message)
    try:
        subprocess.run(
            ['powershell', '-NoProfile', '-Command', script],
            env=env, capture_output=True, timeout=120, check=False,
            creationflags=CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def main():
    today = datetime.date.today().isoformat()
    reminders = collect_reminders(today)
    if not reminders:
        return 0  # 没有到期/逾期任务：完全静默

    today_str = today
    lines = []
    for title, due in reminders[:MAX_LINES]:
        if due < today_str:
            days = (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(due)).days
            lines.append('[逾期 %d 天] %s' % (days, title))
        else:
            lines.append('[今天到期] %s' % title)
    if len(reminders) > MAX_LINES:
        lines.append('…… 以及另外 %d 条' % (len(reminders) - MAX_LINES))
    popup('\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
