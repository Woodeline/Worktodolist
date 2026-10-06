"""待办清单 · 停止后台服务

双击「停止待办清单.cmd」运行：结束后台的本地服务进程。

定位方式有两级：
  1) 优先读 .todolist-server.pid（由 launch_todolist.py 写入）
  2) 兜底按端口反查（服务可能是别的方式起的，或 PID 文件被删了）：
     先读项目根的 .todolist-server.port（启动器选定的端口），
     读不到就依次试 PORT_CANDIDATES 候选端口。
无论哪条路径，杀之前都会核对进程映像名必须是 node.exe，避免误杀。

孤儿清扫：pid 文件只记最后一次启动的进程，快速连续启动（或竞态）留下的
更早的 vite 实例没人管。收尾时按命令行特征（node.exe + vite.js + 本应用目录）
再扫一遍，把残留进程一并结束。只匹配本应用路径，其他项目的 node 程序不受影响。
"""
import ctypes
import os
import re
import sys
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(HERE, '.todolist-server.pid')
PORT_FILE = os.path.join(HERE, '.todolist-server.port')
# 与 launch_todolist.py 的 PORT_CANDIDATES 保持一致，避免两边漂移。
PORT_CANDIDATES = [15180, 5180, 18180, 51800, 15800, 16180]
EXPECTED_IMAGE = 'node.exe'

# 按命令行特征找本应用的 vite 进程。匹配三要素：node.exe + vite.js + todolist-gui 路径。
PS_LIST_CMD = (
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' "
    "-and $_.CommandLine -like '*vite.js*' -and $_.CommandLine -like '*todolist-gui*' } | "
    'ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.CommandLine }'
)

# 加 --quiet（或设 TODOLIST_NO_DIALOG=1）时不弹窗，改为写标准输出，便于脚本化验证
QUIET = '--quiet' in sys.argv or os.environ.get('TODOLIST_NO_DIALOG') == '1'


def alert(message, title='待办清单'):
    if QUIET:
        print(message)
        return
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x40)
    except Exception:
        pass


def warn(message, title='待办清单'):
    if QUIET:
        print(message)
        return
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x30)
    except Exception:
        pass


def _remove_pid_file():
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


def _run(argv):
    """跑一个 native exe，返回 (returncode, stdout)。

    本机控制台 exe 的输出是 GBK/OEM 码页，强制按 UTF-8 解码会在读取线程里
    抛 UnicodeDecodeError（进程照样跑完，但会往 stderr 甩一坨堆栈）。
    这里统一用 errors='replace' 容错；我们要解析的字段
    （node.exe / PID / LISTENING）全是 ASCII，不会受影响。
    """
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              encoding='utf-8', errors='replace', check=False)
        return proc.returncode, proc.stdout or ''
    except OSError:
        return -1, ''


def process_image_name(pid):
    _, out = _run(['tasklist', '/FI', 'PID eq %d' % pid, '/FO', 'CSV', '/NH'])
    for line in out.splitlines():
        cells = [c.strip('"') for c in line.split('","')]
        if len(cells) >= 2 and cells[1].isdigit() and int(cells[1]) == pid:
            return cells[0].strip('"').lower()
    return ''


def read_port_file():
    """读启动器写入的端口文件；读不到或格式非法返回 None。"""
    try:
        with open(PORT_FILE, 'r', encoding='utf-8') as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def candidate_ports():
    """要依次反查的端口：端口文件里的首选，其后补上候选表（去重）。"""
    ports = []
    saved = read_port_file()
    if saved is not None:
        ports.append(saved)
    for port in PORT_CANDIDATES:
        if port not in ports:
            ports.append(port)
    return ports


def pid_from_port(port):
    """从 netstat 输出里找出监听该端口的 PID"""
    _, out = _run(['netstat', '-ano'])
    pattern = re.compile(r'[:.]%d\s+.*LISTENING\s+(\d+)' % port)
    for line in out.splitlines():
        match = pattern.search(line)
        if match:
            return int(match.group(1))
    return None


def pid_from_any_port():
    """依次试候选端口，返回 (pid, port)；都没命中则 (None, None)。"""
    for port in candidate_ports():
        pid = pid_from_port(port)
        if pid:
            return pid, port
    return None, None


def pid_from_file():
    try:
        with open(PID_FILE, 'r', encoding='utf-8') as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def resolve_target():
    """返回 (pid, 说明)；找不到则 (None, 原因)"""
    pid = pid_from_file()
    if pid:
        image = process_image_name(pid)
        if image == EXPECTED_IMAGE:
            return pid, 'PID 文件'
        # PID 文件过期（进程已退或被别的进程复用），丢掉重新查
        _remove_pid_file()

    pid, port = pid_from_any_port()
    if pid:
        image = process_image_name(pid)
        if image == EXPECTED_IMAGE:
            return pid, '端口 %d 反查' % port
        return None, 'NO_KILL:%s:%d:%d' % (image, pid, port)

    return None, 'NOT_RUNNING'


def find_orphan_servers(exclude_pids):
    """按命令行找残留的 vite 服务进程，返回 [(pid, cmd)]。

    匹配条件刻意收窄到本应用目录（todolist-gui），其他项目的 node/vite 不受影响。
    PowerShell 不可用或查询失败时返回空表（能力降级，不阻塞主流程）。
    """
    code, out = _run(['powershell', '-NoProfile', '-Command', PS_LIST_CMD])
    if code != 0:
        return []
    found = []
    for line in out.splitlines():
        line = line.strip()
        if '|' not in line:
            continue
        pid_text, cmd = line.split('|', 1)
        if not pid_text.isdigit():
            continue
        pid = int(pid_text)
        if pid in exclude_pids:
            continue
        found.append((pid, cmd.strip()))
    return found


def kill_pid(pid):
    code, _ = _run(['taskkill', '/PID', str(pid), '/T', '/F'])
    return code == 0


def main():
    pid, how = resolve_target()
    killed_primary = None  # (pid, how) 或 None

    if pid is None:
        if how != 'NOT_RUNNING':
            _, image, other_pid, port = how.split(':')
            warn('端口 %s 现在被另一个程序占用：\n%s (PID %s)\n\n'
                 '不是待办清单的服务，已跳过，没有结束它。' % (port, image, other_pid))
            return 1
        # PID 文件和端口都没有目标——但可能有孤儿 vite 残留，扫一遍再下结论
    else:
        if not kill_pid(pid):
            warn('结束进程失败（PID %d）。\n\n可打开任务管理器，手动结束 node.exe。' % pid)
            return 1
        killed_primary = (pid, how)
    _remove_pid_file()

    exclude = {killed_primary[0]} if killed_primary else set()
    orphans = find_orphan_servers(exclude)
    orphan_killed = 0
    for opid, _cmd in orphans:
        if kill_pid(opid):
            orphan_killed += 1

    if killed_primary and orphan_killed:
        alert('已关闭后台服务（PID %d，通过%s找到），\n'
              '并清理了 %d 个残留的服务进程。\n\n'
              '你的任务都存在 todo.txt 里，一条都不会丢。\n'
              '下次双击桌面图标即可重新打开。'
              % (killed_primary[0], killed_primary[1], orphan_killed))
        return 0
    if killed_primary:
        alert('已关闭后台服务（PID %d，通过%s找到）。\n\n'
              '你的任务都存在 todo.txt 里，一条都不会丢。\n'
              '下次双击桌面图标即可重新打开。' % (killed_primary[0], killed_primary[1]))
        return 0
    if orphan_killed:
        alert('PID 文件已丢失，但找到 %d 个残留的后台服务进程，已全部结束。\n\n'
              '你的任务都存在 todo.txt 里，一条都不会丢。' % orphan_killed)
        return 0

    alert('后台服务本来就没在运行，不用关。\n\n（你的任务都在 todo.txt 里，不受影响）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
