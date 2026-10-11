r"""待办清单 · Tauri 版启动器

双击桌面「待办清单-Tauri」图标走的就是这个（由 pythonw.exe 静默运行，无黑窗口）。

它做三件事：
  1. 找到 Tauri 版的构建产物并启动它；
  2. 找不到时弹窗说清「还没构建」以及构建命令 —— 不再回落去开任何别的版本；
  3. `--stop` 结束 Tauri 版进程。

定位顺序（本脚本所在目录为基准，--app-root 可覆盖）：
  1. todolist-gui/src-tauri/target/release/Worktodolist.exe   ← 正式产物
  2. todolist-gui/src-tauri/target/debug/Worktodolist.exe     ← dev 构建产物

注意：Tauri 版是自包含的原生 exe（前端已内嵌进 exe，没有 Node 服务、没有端口），
所以本脚本**不需要**任何运行时依赖；它只是「找文件 + 拉起进程 + 出错时告诉你」。
想绕过它也可以，直接双击上面那个 exe 即可。

用法：
  pythonw.exe launch_todolist_tauri.py                # 双击图标做的就是这个
  python.exe  launch_todolist_tauri.py --status       # 只诊断，不启动任何东西
  python.exe  launch_todolist_tauri.py --show-window  # 显示控制台，看得到输出
  python.exe  launch_todolist_tauri.py --quiet        # 不弹窗，只打印（脚本化验证用）
  python.exe  launch_todolist_tauri.py --app-root D:\some\repo
  python.exe  launch_todolist_tauri.py --stop         # 结束 Tauri 版进程

未知参数一律忽略（本脚本只认上面这几个）。
"""
import ctypes
import glob
import os
import subprocess
import sys
import time

# 冻结（PyInstaller）后 __file__ 指向解包临时目录，必须以 exe 自身所在目录为根。
if getattr(sys, 'frozen', False):
    HERE = os.path.dirname(os.path.abspath(sys.executable))
else:
    HERE = os.path.dirname(os.path.abspath(__file__))

HOME = os.path.expanduser('~')
EXE_NAME = 'Worktodolist.exe'
GUI_DIR = os.path.join(HERE, 'todolist-gui')

PID_FILE = os.path.join(HERE, '.todolist-tauri.pid')
LOG_FILE = os.path.join(HERE, '.todolist-tauri-launch.log')

# 构建前置条件的探测路径（glob 的 * 不跨路径分隔符，可以安全地当通配层级用）。
# 只在 --status / 缺失提示里用，运行期不需要它们。
VS_ROOTS = [
    r'C:\Program Files\Microsoft Visual Studio',
    r'C:\Program Files (x86)\Microsoft Visual Studio',
]
LINK_GLOBS = [os.path.join(r, '*', '*', 'VC', 'Tools', 'MSVC', '*', 'bin', 'Hostx64', 'x64', 'link.exe')
              for r in VS_ROOTS]
RC_GLOBS = [
    r'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\rc.exe',
    r'C:\Program Files\Windows Kits\10\bin\*\x64\rc.exe',
]
NODE_GLOBS = [
    os.path.join(HOME, '.workbuddy', 'binaries', 'node', 'versions', '*', 'node.exe'),
    r'C:\Program Files\nodejs\node.exe',
    r'C:\Program Files (x86)\nodejs\node.exe',
]
WEBVIEW_DIRS = [
    r'C:\Program Files (x86)\Microsoft\EdgeWebView\Application',
    r'C:\Program Files\Microsoft\EdgeWebView\Application',
]

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_BREAKAWAY_FROM_JOB = 0x01000000

# 加 --quiet（或设 TODOLIST_NO_DIALOG=1）时不弹窗，改为写标准输出，便于脚本化验证。
# MessageBox 是模态阻塞的，脚本化验证时弹窗会让流程挂死 —— 这个开关是必需的。
QUIET = '--quiet' in sys.argv or os.environ.get('TODOLIST_NO_DIALOG') == '1'


def out(line=''):
    """打印一行，规避控制台码页与管道编码不一致时抛 UnicodeEncodeError。"""
    try:
        print(line)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((line + '\n').encode('utf-8', 'replace'))


def log(message):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as fh:
            fh.write('[%s] %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), message))
    except OSError:
        pass


def alert(message, title='待办清单 · Tauri 版', flags=0x10):
    """提示用户。无控制台环境下 MessageBoxW 是唯一可见的通道。"""
    log('ALERT: %s' % message.replace('\n', ' | '))
    if QUIET:
        out('ALERT: %s' % message)
        return
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, flags)
    except Exception:  # noqa: BLE001
        out('ALERT: %s' % message)


def first_glob(patterns):
    """按给定次序找第一个存在的路径；同一模式多命中时取名字最大的（通常是最高版本）。"""
    for pattern in patterns:
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    return None


# ---------------------------------------------------------------- 定位构建产物

def exe_candidates(root):
    target = os.path.join(root, 'todolist-gui', 'src-tauri', 'target')
    return [
        ('release 构建', os.path.join(target, 'release', EXE_NAME)),
        ('debug 构建', os.path.join(target, 'debug', EXE_NAME)),
    ]


def find_exe(root):
    """返回 (kind, path) 或 (None, None)。"""
    for kind, path in exe_candidates(root):
        if os.path.isfile(path):
            return kind, path
    return None, None


# ---------------------------------------------------------------- 前置条件探测

def probe_prereqs(root):
    """探测构建 Tauri 版所需的前置条件，返回 [(名称, 是否就绪, 详情)]。

    这些都是**构建期**依赖；构建出来的 exe 自包含，运行期只需要 WebView2。
    """
    checks = []

    cargo = os.path.join(HOME, '.cargo', 'bin', 'cargo.exe')
    checks.append(('cargo（Rust 工具链）', os.path.isfile(cargo), cargo if os.path.isfile(cargo) else ''))

    link = first_glob(LINK_GLOBS)
    checks.append(('link.exe（MSVC 链接器 · VS Build Tools）', bool(link), link or ''))

    rc = first_glob(RC_GLOBS)
    checks.append(('rc.exe（Windows SDK 资源编译器）', bool(rc), rc or ''))

    node = first_glob(NODE_GLOBS)
    checks.append(('node.exe（前端构建用）', bool(node), node or ''))

    cli = os.path.join(GUI_DIR, 'node_modules', '@tauri-apps', 'cli', 'package.json')
    checks.append(('@tauri-apps/cli（前端依赖）', os.path.isfile(cli), cli if os.path.isfile(cli) else ''))

    webview = next((d for d in WEBVIEW_DIRS if os.path.isdir(d)), None)
    checks.append(('WebView2 运行时（运行期需要）', bool(webview), webview or ''))

    return checks


def print_status(root):
    kind, exe = find_exe(root)

    out('应用根目录    : %s' % root)
    out('Tauri 构建产物: %s' % ('已找到（%s）\n                 %s' % (kind, exe) if exe
                              else '未找到 —— 还没有构建过'))
    for label, path in exe_candidates(root):
        out('   %-11s: %s  [%s]' % (label, path, '存在' if os.path.isfile(path) else '缺失'))
    out('构建前置条件  :')
    for name, ok, detail in probe_prereqs(root):
        out('   [%s] %s' % ('就绪' if ok else '缺失', name))
        if detail:
            out('          %s' % detail)
    out('')
    out('停止方式      : python launch_todolist_tauri.py --stop')
    return 0


def missing_text(root):
    """把缺失的前置条件组织成一段人能照着做的说明。

    这里**不再**提「先打开旧版本」—— 旧启动链路已从本分支移除，
    回落目标不存在了，承诺会把用户引到死路。
    """
    missing = [name for name, ok, _ in probe_prereqs(root) if not ok
               and 'WebView2' not in name]  # WebView2 只影响运行，不影响构建，不在这里报
    if not missing:
        return ('构建前置条件看起来都齐了，但没找到 %s。\n\n'
                '可能只是还没构建过。在 todolist-gui 目录执行：\n'
                '    npm run tauri:build\n\n'
                '构建好之后双击本图标就会直接启动。\n\n'
                '构建产物预期位置：\n%s' % (EXE_NAME, '\n'.join('    %s' % p for _, p in exe_candidates(root))))

    lines = ['Tauri 版还没有构建，请先构建它。', '',
             '要构建它，还缺这些前置条件：']
    for name in missing:
        lines.append('  · %s' % name)
    lines += [
        '',
        '装法（会弹一次 UAC 授权，点「是」即可）：',
        '  "C:\\rtc-test\\vs_BuildTools.exe" --quiet --wait --norestart --nocache',
        '      --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended',
        '',
        '装完后在 todolist-gui 目录执行：',
        '    npm run tauri:build',
        '',
        '之后双击本图标就会直接启动。',
    ]
    return '\n'.join(lines)


# ---------------------------------------------------------------- 进程操作

def popen_detached(argv, cwd, show_window=False):
    """后台拉起子进程，尽量保证父进程退出后它仍存活。

    某些外壳会把子进程放进 Job Object 并设为「父退即杀」，
    CREATE_BREAKAWAY_FROM_JOB 是唯一的逃逸手段；若该作业不允许 breakaway，
    CreateProcess 会直接拒绝，所以失败时回退到不带该标志的方式。

    show_window=True 时不加任何 creationflags：DETACHED_PROCESS 的含义正是
    「子进程不继承父控制台」，加上它就看不到任何输出了，而这个入口的唯一
    用途就是排查看报错。
    """
    base = {'cwd': cwd, 'stdin': subprocess.DEVNULL}
    if show_window:
        base['stdout'] = None
        base['stderr'] = None
    else:
        base['stdout'] = subprocess.DEVNULL
        base['stderr'] = subprocess.DEVNULL

    if os.name != 'nt':
        attempts = [0]
    elif show_window:
        attempts = [0]
    else:
        attempts = [DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB, DETACHED_PROCESS]

    last_exc = None
    for flags in attempts:
        kwargs = dict(base)
        if flags:
            kwargs['creationflags'] = flags
        try:
            return subprocess.Popen(argv, **kwargs)
        except OSError as exc:  # noqa: BLE001
            last_exc = exc
            log('Popen flags=0x%X failed: %s' % (flags, exc))
    raise last_exc if last_exc else RuntimeError('Popen failed')


def launch_exe(exe, show_window=False):
    """启动 Tauri 版 exe。返回 True/False。

    启动后短暂观察一下进程是否立刻退出：进程瞬间死掉通常意味着运行期依赖缺失
    （典型是没装 WebView2），这时给出提示比让你对着什么都没发生的桌面强。
    """
    try:
        proc = popen_detached([exe], cwd=os.path.dirname(exe), show_window=show_window)
    except Exception as exc:  # noqa: BLE001
        alert('启动失败：\n%s\n\n文件：\n%s\n\n详细日志见：\n%s' % (exc, exe, LOG_FILE))
        return False

    log('launched pid=%d exe=%s' % (proc.pid, exe))
    try:
        with open(PID_FILE, 'w', encoding='utf-8') as fh:
            fh.write(str(proc.pid))
    except OSError:
        pass

    if show_window:
        return True
    time.sleep(1.0)
    code = proc.poll()
    if code is not None:
        alert('启动后立刻退出了（退出码 %s）。\n\n'
              '最常见的原因是缺少 WebView2 运行时。\n'
              '手动双击这个文件试一次会更直观：\n%s\n\n日志：\n%s' % (code, exe, LOG_FILE))
        return False
    return True


def tasklist_pids(image):
    """按映像名查进程 PID。native exe 输出是 GBK/OEM 码页，统一 errors='replace'。"""
    try:
        proc = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq %s' % image, '/FO', 'CSV', '/NH'],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              encoding='utf-8', errors='replace', timeout=20,
                              creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired) as exc:
        log('tasklist failed: %s' % exc)
        return []
    pids = []
    for line in (proc.stdout or '').splitlines():
        cells = [c.strip().strip('"') for c in line.split('","')]
        if len(cells) >= 2 and cells[0].strip('"').lower() == image.lower() and cells[1].strip('"').isdigit():
            pids.append(int(cells[1].strip('"')))
    return pids


def image_of(pid):
    """查某个 PID 的映像名；查不到返回空串。用于「杀之前先确认是谁」。"""
    try:
        proc = subprocess.run(['tasklist', '/FI', 'PID eq %d' % pid, '/FO', 'CSV', '/NH'],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              encoding='utf-8', errors='replace', timeout=20,
                              creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return ''
    for line in (proc.stdout or '').splitlines():
        cells = [c.strip().strip('"') for c in line.split('","')]
        if cells and cells[0] and cells[0].lower() != 'info:':
            return cells[0].split('\\')[-1]
    return ''


def kill_pid(pid):
    try:
        proc = subprocess.run(['taskkill', '/F', '/PID', str(pid)],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              encoding='utf-8', errors='replace', timeout=20,
                              creationflags=CREATE_NO_WINDOW)
        return proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired) as exc:
        log('taskkill %d failed: %s' % (pid, exc))
        return False


def do_stop():
    """结束 Tauri 版进程。

    两条入口都做：先信 PID 文件（但要核对映像名，防误杀），
    再用映像名兜底扫一遍（进程可能是别的方式起的，PID 文件可能被删）。
    """
    killed = []

    # 1) PID 文件优先，但必须核对映像名 —— PID 会被复用，直接杀是危险的。
    try:
        with open(PID_FILE, 'r', encoding='utf-8') as fh:
            pid = int(fh.read().strip())
    except (OSError, ValueError):
        pid = None
    if pid:
        name = image_of(pid)
        if name.lower() == EXE_NAME.lower():
            if kill_pid(pid):
                killed.append(pid)
        else:
            log('pid file stale: %d is %r, not %s' % (pid, name, EXE_NAME))

    # 2) 映像名兜底
    for pid in tasklist_pids(EXE_NAME):
        if pid not in killed and kill_pid(pid):
            killed.append(pid)

    if killed:
        out('已结束 %s：%s' % (EXE_NAME, ', '.join('PID %d' % p for p in killed)))
    else:
        out('没有在运行的 %s。' % EXE_NAME)

    try:
        os.remove(PID_FILE)
    except OSError:
        pass
    return 0


def main():
    args = sys.argv[1:]

    root = HERE
    if '--app-root' in args:
        idx = args.index('--app-root')
        if idx + 1 < len(args):
            root = os.path.abspath(args[idx + 1])

    if '--stop' in args:
        return do_stop()
    if '--status' in args:
        return print_status(root)

    show_window = '--show-window' in args

    kind, exe = find_exe(root)
    if exe:
        log('found %s at %s' % (kind, exe))
        return 0 if launch_exe(exe, show_window) else 1

    log('no tauri build found under %s' % root)
    alert(missing_text(root))  # 0x10 = 错误图标：这是真缺东西，需要你动手构建
    return 1


if __name__ == '__main__':
    sys.exit(main())
