r"""待办清单 · Tauri 版启动器

双击桌面「待办清单-Tauri」图标走的就是这个（由 pythonw.exe 静默运行，无黑窗口）。

它做四件事：
  1. 找到 Tauri 版的构建产物，**并判断它是否比源码旧**；
  2. 过期（或缺失）就先停掉正在运行的旧实例、重新构建，再启动 —— 保证双击图标
     拿到的永远是当前代码的版本（前端在构建时被内嵌进 exe，改完不重建看到的就是旧版）；
  3. 找不到且没构建条件时弹窗说清缺什么 —— 不回落去开任何别的版本；
  4. `--stop` 结束 Tauri 版进程。

定位顺序（本脚本所在目录为基准，--app-root 可覆盖）：
  1. todolist-gui/src-tauri/target/release/Worktodolist.exe   ← 正式产物
  2. todolist-gui/src-tauri/target/debug/Worktodolist.exe     ← dev 构建产物

关于「自动重建」：
  只要 todolist-gui 下被内嵌进 exe 的文件（src/、src-tauri/src/、tauri.conf.json …）里有
  任何一个比 exe 新，就判定过期。重建前**必须先停掉正在运行的实例** —— 那个进程锁着
  exe，不停就没法覆盖（这正是「明明重建了却还是老版本」的根因之一）。
  重建会弹出一个可见的构建窗口（关掉它 = 中断构建）。构建脚本每次运行都往
  .todolist-build.log 写面包屑（开始时间 / 工作目录 / 解析到的 npm / 退出码）；万一窗口
  一闪就退出，失败弹窗会把退出码、耗时与日志末尾一并摊开。想跳过重建直接开旧版：--no-build。

注意：构建出来的 exe 是自包含的原生 exe（没有 Node 服务、没有端口），运行期不需要任何
依赖；构建**期**才需要 Rust 工具链 + Node（见 --status 的探测）。

用法：
  pythonw.exe launch_todolist_tauri.py                # 双击图标做的就是这个（会自动重建）
  python.exe  launch_todolist_tauri.py --status       # 只诊断：产物位置 / 是否过期 / 前置条件
  python.exe  launch_todolist_tauri.py --rebuild      # 强制重建后再启动
  python.exe  launch_todolist_tauri.py --no-build     # 跳过重建，直接启动现有产物
  python.exe  launch_todolist_tauri.py --show-window  # 显示控制台，看得到输出
  python.exe  launch_todolist_tauri.py --quiet        # 不弹窗，只打印（脚本化验证用）
  python.exe  launch_todolist_tauri.py --app-root D:\some\repo
  python.exe  launch_todolist_tauri.py --stop         # 结束 Tauri 版进程

未知参数一律忽略（本脚本只认上面这几个）。
"""
import ctypes
import glob
import os
import re
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
BUILD_LOG = os.path.join(HERE, '.todolist-build.log')
BUILD_CMD = os.path.join(HERE, 'build_todolist_tauri.cmd')

# 会被内嵌进 exe 的源码：改其中任何一个，产物即视为过期。
# 刻意不扫 dist/（它是构建产物）、node_modules/、target/（缓存）。
SOURCE_DIRS = [
    'src',
    'public',
    os.path.join('src-tauri', 'src'),
    os.path.join('src-tauri', 'icons'),
    os.path.join('src-tauri', 'capabilities'),
]
SOURCE_FILES = [
    'index.html',
    'package.json',
    'vite.config.js',
    os.path.join('src-tauri', 'Cargo.toml'),
    os.path.join('src-tauri', 'tauri.conf.json'),
    os.path.join('src-tauri', 'build.rs'),
]
SKIP_DIRS = {'node_modules', 'target', '.git', 'dist', '.tmp'}

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
CREATE_NEW_CONSOLE = 0x00000010
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


# ---------------------------------------------------------------- 产物新鲜度

def newest_source_mtime(root):
    """被内嵌进 exe 的源码里最新的一个修改时间（0 表示一个都没扫到）。"""
    gui = os.path.join(root, 'todolist-gui')
    newest = [0.0]

    def bump(path):
        try:
            m = os.path.getmtime(path)
        except OSError:
            return
        if m > newest[0]:
            newest[0] = m

    for rel in SOURCE_DIRS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(gui, rel)):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                bump(os.path.join(dirpath, fn))
    for rel in SOURCE_FILES:
        bump(os.path.join(gui, rel))
    return newest[0]


def is_stale(root, exe):
    """产物是否落后于源码。exe 不存在也算「需要构建」。

    留 1 秒容差：构建会同时刷新 exe 与部分源文件的 mtime，边界上不该判定为过期。
    """
    try:
        exe_m = os.path.getmtime(exe)
    except OSError:
        return True
    return newest_source_mtime(root) > exe_m + 1.0


# ---------------------------------------------------------------- 构建

def build_app(root):
    """调用 build_todolist_tauri.cmd 重建产物。返回 (是否成功, 退出码, 耗时秒)。

    默认弹一个可见的构建控制台（否则 pythonw 下全程静默，用户会以为卡死）；
    QUIET（脚本化验证）时不弹窗，输出追加到 BUILD_LOG。

    子进程额外带一份「Node 目录优先」的 PATH：桌面图标走的是 Explorer 缓存下来的
    环境，可能早于 Node 的安装，届时 build_todolist_tauri.cmd 里的兜底也够不着 ——
    这里先把本机找到的 node 目录插到最前面，构建窗口便不再依赖用户 PATH 是否最新。
    """
    if not os.path.isfile(BUILD_CMD):
        alert('找不到构建脚本：\n%s\n\n请确认这个文件还在 todolist 文件夹里。' % BUILD_CMD)
        return False, None, 0.0

    log('building: %s' % BUILD_CMD)
    comspec = os.environ.get('ComSpec') or 'cmd.exe'
    argv = [comspec, '/c', BUILD_CMD]
    env = dict(os.environ)
    node = first_glob(NODE_GLOBS)
    if node:
        env['PATH'] = os.path.dirname(node) + os.pathsep + env.get('PATH', '')
    kwargs = {'cwd': root, 'env': env}
    handle = None
    if QUIET:
        kwargs['creationflags'] = CREATE_NO_WINDOW
        kwargs['stdin'] = subprocess.DEVNULL
        try:
            handle = open(BUILD_LOG, 'a', encoding='utf-8')
            handle.write('\n==== build %s ====\n' % time.strftime('%Y-%m-%d %H:%M:%S'))
            kwargs['stdout'] = handle
            kwargs['stderr'] = subprocess.STDOUT
        except OSError:
            handle = None
    else:
        # 可见构建窗口：**任何标准句柄都不要重定向**。桌面图标走的是 pythonw（没有
        # 控制台），只要指定了 stdin / stdout / stderr 中的一个，Windows 就要求把三个
        # 句柄全部显式传下去 —— 而 pythonw 自己的 stdout/stderr 是无效句柄，于是
        # cmd.exe 在第一次输出时就当场退出（rc=1、窗口一闪就没，正是「双击图标还是
        # 老版本」的真凶）。什么都不传，子进程才会拿到新建控制台自己的句柄。
        kwargs['creationflags'] = CREATE_NEW_CONSOLE

    started = time.time()
    try:
        proc = subprocess.Popen(argv, **kwargs)
    except OSError as exc:  # noqa: BLE001
        log('build spawn failed: %s' % exc)
        if handle:
            handle.close()
        alert('无法启动构建进程：\n%s\n\n日志：\n%s' % (exc, LOG_FILE))
        return False, None, 0.0

    code = proc.wait()
    seconds = time.time() - started
    if handle:
        handle.close()
    log('build finished rc=%s after %.1fs' % (code, seconds))
    return code == 0, code, seconds


def build_log_tail(count):
    """取构建日志末尾若干行，去掉 vite/cargo 的 ANSI 颜色，失败时用来指认原因。"""
    try:
        with open(BUILD_LOG, 'r', encoding='utf-8', errors='replace') as fh:
            rows = [ln.strip() for ln in fh.read().splitlines() if ln.strip()]
    except OSError:
        return ''
    cleaned = [re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', ln) for ln in rows[-count:]]
    return '\n'.join(cleaned)


def build_failed_text(code, seconds):
    """构建失败对话框的文案：把「多快失败的」和「日志末尾」摊开，别只留一句 rc=1。"""
    lines = []
    if code is not None and seconds is not None:
        if seconds < 5:
            lines.append('构建窗口刚出现（%.1f 秒）就以退出码 %s 结束了 —— 多半是窗口被'
                         '立刻关闭，或 npm 没能启动。' % (seconds, code))
        else:
            lines.append('构建以退出码 %s 结束，耗时 %.0f 秒。' % (code, seconds))
    tail = build_log_tail(4)
    if tail:
        lines.append('\n.todolist-build.log 末尾：\n' + tail)
    lines.append('\n重试：再双击一次图标，或在本文件夹执行\n'
                 'python launch_todolist_tauri.py --rebuild')
    return ('重建新版本失败，当前仍是旧版本。\n\n' + '\n'.join(lines) +
            '\n\n是否仍然启动现有版本？')


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
    if exe:
        out('产物新鲜度    : %s' % ('源码比产物新，下次启动会自动重建' if is_stale(root, exe) else '与源码同步'))
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

    启动后短暂观察一下进程是否立刻退出，分三种情况处理：
      * 进程仍在跑        → 它就是主实例，成功；
      * 秒退、退出码 0    → 单实例插件判定已有实例在跑，把它唤到前台后自行退出。
                            托盘版「关窗不退出」会让这种情况很常见，这是**成功**，
                            绝不能弹「缺少 WebView2」去误导用户；
      * 秒退、退出码非 0  → 才是真的启动失败（典型是没装 WebView2），才提示。
    """
    try:
        proc = popen_detached([exe], cwd=os.path.dirname(exe), show_window=show_window)
    except Exception as exc:  # noqa: BLE001
        alert('启动失败：\n%s\n\n文件：\n%s\n\n详细日志见：\n%s' % (exc, exe, LOG_FILE))
        return False

    log('launched pid=%d exe=%s' % (proc.pid, exe))

    if show_window:
        return True

    time.sleep(1.0)
    code = proc.poll()
    if code is None:
        # 仍在跑 = 主实例：记下 PID 供 --stop 使用（只记活着的，避免 PID 文件指向已退进程）
        try:
            with open(PID_FILE, 'w', encoding='utf-8') as fh:
                fh.write(str(proc.pid))
        except OSError:
            pass
        return True

    if code == 0:
        log('exit 0 right after launch: another instance already running, window focused')
        return True

    alert('启动后立刻退出了（退出码 %s）。\n\n'
          '最常见的原因是缺少 WebView2 运行时。\n'
          '手动双击这个文件试一次会更直观：\n%s\n\n日志：\n%s' % (code, exe, LOG_FILE))
    return False


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


def stop_running(quiet=False):
    """结束 Tauri 版进程，返回被杀掉的 PID 列表。

    两条入口都做：先信 PID 文件（但要核对映像名，防误杀），
    再用映像名兜底扫一遍（进程可能是别的方式起的，PID 文件可能被删）。
    重建前必须先调用它 —— 否则 exe 被运行中的进程锁着，覆盖会失败。
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

    try:
        os.remove(PID_FILE)
    except OSError:
        pass

    if not quiet:
        if killed:
            out('已结束 %s：%s' % (EXE_NAME, ', '.join('PID %d' % p for p in killed)))
        else:
            out('没有在运行的 %s。' % EXE_NAME)
    return killed


def do_stop():
    stop_running(quiet=False)
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
    force = '--rebuild' in args
    no_build = '--no-build' in args

    kind, exe = find_exe(root)

    if force:
        must_build, reason = True, '强制重建（--rebuild）'
    elif exe is None:
        must_build, reason = (not no_build), '产物缺失'
    elif is_stale(root, exe) and not no_build:
        must_build, reason = True, '源码比产物新'
    else:
        must_build, reason = False, ''

    if must_build:
        log('%s -> rebuild' % reason)
        if not QUIET:
            out('检测到需要重建（%s），正在构建…' % reason)
        # 运行中的实例锁着 exe，必须先停掉才能覆盖 —— 否则「重建」是假动作。
        stop_running(quiet=True)
        built, build_rc, build_seconds = build_app(root)
        kind, exe = find_exe(root)
        if not built or exe is None:
            log('build failed or exe still missing (built=%s exe=%s)' % (built, exe))
            if exe is None:
                alert(missing_text(root))
                return 1
            # 还有旧产物可用：征询是否照旧启动（脚本化验证时直接失败，不弹窗）
            if QUIET:
                return 1
            answer = ctypes.windll.user32.MessageBoxW(
                None,
                build_failed_text(build_rc, build_seconds),
                '待办清单 · 构建失败', 0x04 | 0x30)  # MB_YESNO | MB_ICONWARNING
            if answer != 6:  # IDYES
                return 1

    if exe is None:
        # 走到这里说明：产物缺失且 --no-build（不构建），或构建后仍然找不到。
        log('no tauri build found under %s' % root)
        alert(missing_text(root))
        return 1

    log('found %s at %s' % (kind, exe))
    return 0 if launch_exe(exe, show_window) else 1


if __name__ == '__main__':
    sys.exit(main())
