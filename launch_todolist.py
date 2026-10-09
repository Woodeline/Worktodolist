"""待办清单 · 静默启动器

双击桌面 TodoList 图标时由 pythonw.exe 运行：
  1) 不显示任何控制台窗口
  2) 后台起本地服务（已被占用则直接复用）
  3) 用 Edge / Chrome 的 --app 模式打开界面（无地址栏，像原生应用）
  4) 顺手跑一次数据自动提交（git 版本化，方案 D2 的落地；失败不影响启动）

之所以锁定 Edge/Chrome：本应用依赖 File System Access API（直接读写 todo.txt），
Firefox 不支持该 API，用默认浏览器打开可能落到 Firefox 上导致整站不可用。

服务模式（P1-1）：默认用 `vite preview` 服务生产构建 dist/（启动更快、内存更低、
不再把开发服务器长驻在用户机器上）；dist 缺失时会先自动构建一次，构建失败回落
dev 模式。传 --dev 可强制 dev 模式（改前端代码时用，HMR + AI 代理调试均可用）。

端口不写死：启动前用真实 bind 探测从 PORT_CANDIDATES 里挑一个能绑的端口。
Windows 上 Hyper-V / WSL2 / Docker 会向系统申请「保留端口块」（位置不固定，
重启或更新后会变），落在其中的端口会在 bind 时直接抛 WSAEACCES —— 这不是
「端口被占用」，所以固定端口号迟早会在某台机器上失效。选定的端口写入
.todolist-server.port，供 stop_todolist.py 与 QA 脚本复用。

身份判定：不再用「进程映像名是否 node.exe」（另一个 node 程序占端口时会被
误判成我们的服务，浏览器会被开到别人的页面上——真实缺陷 B5）。改为 HTTP
内容探针：GET / 并检查响应里是否有本应用的标题标记，正负证据都来自内容本身。

用法：
  pythonw.exe launch_todolist.py                # 正常启动（双击图标走的就是这个）
  python.exe  launch_todolist.py --no-browser   # 只起服务，不开浏览器（排查用）
  python.exe  launch_todolist.py --show-window  # 显示控制台窗口（排查用）
  python.exe  launch_todolist.py --quiet        # 出错也不弹窗，只写日志/标准输出
  python.exe  launch_todolist.py --dev          # 强制 dev 模式（前端开发用）
  python.exe  launch_todolist.py --port 15181   # 只认指定端口（多实例 / QA 用）
  python.exe  launch_todolist.py --stop         # 结束后台服务（打包版没有 Python 时的唯一入口）
  python.exe  launch_todolist.py --run-script scripts/daily_reminder.py
                                                # 用内置解释器跑辅助脚本（打包版用）

打包（PyInstaller 冻结）注意：冻结后 sys.executable 就是本 exe、__file__ 指向解包
临时目录，所以下面两处都做了分支处理；同目录存在 node/node.exe 时优先用它。
"""
import ctypes
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

# 冻结（PyInstaller）后 __file__ 指向解包临时目录，拿它当基准会找不到同目录的
# todolist-gui / node / scripts —— 打包版必须以 exe 自身所在目录为根。源码方式
# 启动时两者等价，行为不变。
if getattr(sys, 'frozen', False):
    HERE = os.path.dirname(os.path.abspath(sys.executable))
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, 'todolist-gui')
VITE_JS = os.path.join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
DIST_INDEX = os.path.join(APP_DIR, 'dist', 'index.html')
PID_FILE = os.path.join(HERE, '.todolist-server.pid')
PORT_FILE = os.path.join(HERE, '.todolist-server.port')
LOG_FILE = os.path.join(HERE, '.todolist-launch.log')

# 候选端口，按优先级排列。都刻意避开 5141–5240 这个常见保留块
# （5180 就落在里面，实测直接 EACCES）。第一个 15180 是主用端口。
PORT_CANDIDATES = [15180, 5180, 18180, 51800, 15800, 16180]

# 当前选定的端口，由 choose_port() 填好后全程复用；选定前为 None。
PORT = None

# --port <n> 指定的端口。给了就只认它（绑不上直接报错，不回落候选表）——
# 这是给 QA / 多实例用的确定性开关，正常双击启动不会传。
FORCED_PORT = None

# HTTP 身份探针的标记：本应用 index.html 的 <title> 一定包含它。
# dev 与 preview 服务的都是这份 index.html，两种模式通用。
APP_MARKER = '待办清单'

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_BREAKAWAY_FROM_JOB = 0x01000000

# 加 --quiet（或设 TODOLIST_NO_DIALOG=1）时不弹窗，改为写标准输出，便于脚本化验证
QUIET = '--quiet' in sys.argv or os.environ.get('TODOLIST_NO_DIALOG') == '1'

BROWSER_CANDIDATES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
]


def make_url():
    """当前选定端口的访问地址。"""
    return 'http://localhost:%d/' % PORT


def log(message):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as fh:
            fh.write('[%s] %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), message))
    except OSError:
        pass


def alert(message, title='待办清单'):
    """无控制台环境下的提示框"""
    log('ALERT: %s' % message)
    if QUIET:
        print('ALERT: %s' % message)
        return
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        pass


def port_alive(port, timeout=0.5):
    """服务是否已在运行（vite 绑定的是 IPv6 回环，两种都试）

    注意：port 必须是第一个参数。此前签名是 (timeout)，
    调用侧写成 port_alive(0.3) 会把 0.3 当成端口号，抛
    TypeError: 'float' object cannot be interpreted as an integer。

    捕获范围必须包含 OverflowError：端口越界（>65535 或负数）时 connect()
    抛的是 OverflowError（ArithmeticError 子类），它**不是** OSError 家族成员，
    只写 except OSError 会让它逃逸出去把主流程打崩（真实缺陷 B4）。
    """
    for host in ('::1', '127.0.0.1'):
        try:
            with socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET,
                               socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                sock.connect((host, port))
                return True
        except (OSError, OverflowError, TypeError, ValueError):
            continue
    return False


def can_bind(port):
    """端口现在能不能真的绑上。
    被 Hyper-V/WSL/Docker 保留的端口在这里抛 OSError(WSAEACCES)，
    被别的程序 LISTENING 的端口抛 WSAEADDRINUSE —— 两种都算不可用。
    关键：故意不设 SO_REUSEADDR，否则 Windows 会把"被保留"这种失败伪装成成功。
    越界端口（>65535/负数）同样要接住：bind() 抛的是 OverflowError 而非 OSError，
    只写 except OSError 会漏掉它（B4 同类洞）。
    """
    for host in ('::1', '127.0.0.1'):
        try:
            fam = socket.AF_INET6 if ':' in host else socket.AF_INET
            with socket.socket(fam, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                s.bind((host, port))
        except (OSError, OverflowError, TypeError, ValueError):
            return False
    return True


def http_marker(port, timeout=1.5):
    """GET http://<port>/ 并检查是否本应用的页面。

    返回三值：True（内容含标记）、False（有 HTTP 响应但不是我们的）、
    None（证据不足，如超时）。False 是正面反证——B5 盲区（端口被另一个
    node 程序占着）就此关闭，不再依赖「映像名恰好是 node.exe」这种弱证据。

    两个坑（实测踩过）：
      * 必须禁用系统代理：urllib 默认读 Windows/环境变量代理设置，本机开着
        Clash 等代理时，探测 localhost 会被代理劫持，拿到错误结论。
      * IPv6 主机必须加方括号，http://::1:80/ 是非法 URL。
    """
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for host in ('127.0.0.1', '::1'):
        if ':' in host:
            host = '[%s]' % host
        try:
            with opener.open('http://%s:%d/' % (host, port), timeout=timeout) as resp:
                body = resp.read(8192).decode('utf-8', 'replace')
            return APP_MARKER in body
        except urllib.error.HTTPError:
            return False
        except urllib.error.URLError:
            # 连接拒绝/DNS 等栈级失败：换栈再试
            continue
        except OSError:
            continue
        except Exception:
            return None
    return None


def is_our_server(port):
    """端口上跑的是不是本应用（证据全部来自 HTTP 内容，不再看进程）。

    fail-open 是刻意保留的：探针拿不到证据（超时等）时宁可复用也不另起第二个
    实例去 --strictPort 撞死——打不开应用比「多问一次」更糟。
    端口实际被别人占着的情况由 choose_port 里随后的 can_bind() 兜住：
    is_our_server 返回 False 或 can_bind 失败都会让该端口出局。
    """
    if not port_alive(port):
        return False
    verdict = http_marker(port)
    if verdict is None:
        log('port %d: marker probe inconclusive, assuming ours (fail-open)' % port)
        return True
    if not verdict:
        log('port %d: HTTP content is not our app, skipping' % port)
    return verdict


def _read_port_file():
    """读启动器上次写入的端口文件；读不到、格式非法或越界都返回 None。

    这里就把不在 1–65535 的值挡掉（B4）：否则非法端口会一路传到
    socket.connect()/bind()，抛 OverflowError 把整个启动流程打崩。
    挡掉后自动回落到候选表。
    """
    try:
        with open(PORT_FILE, 'r', encoding='utf-8') as fh:
            port = int(fh.read().strip())
    except (OSError, ValueError):
        return None
    if 1 <= port <= 65535:
        return port
    return None


def _write_port_file(port):
    """把选定端口写进 PORT_FILE（只写端口数字）。写不进去不影响启动。"""
    try:
        with open(PORT_FILE, 'w', encoding='utf-8') as fh:
            fh.write(str(port))
    except OSError:
        pass


def choose_port():
    """挑一个可用端口，返回 (port, already_running)。

    顺序：
      1) 端口文件里记的端口是我们的服务 → 直接复用（它可能就是这个启动器上次选的）。
      2) 候选表里某个端口是我们的服务 → 复用（服务可能是别的方式起的、端口文件丢了）。
      3) 候选表里第一个现在能真绑上的端口。
      4) 一个都绑不上 → (None, False)。
    """
    if FORCED_PORT is not None:
        # 指定端口就只认它：已在跑则复用，能绑则新建，绑不上直接失败。
        # 刻意不回落候选表 —— 否则"指定端口"在 QA 里就不是确定的了。
        if is_our_server(FORCED_PORT):
            return FORCED_PORT, True
        if can_bind(FORCED_PORT):
            return FORCED_PORT, False
        return None, False

    saved = _read_port_file()
    if saved is not None and is_our_server(saved):
        return saved, True

    for candidate in PORT_CANDIDATES:
        if is_our_server(candidate):
            return candidate, True

    for candidate in PORT_CANDIDATES:
        if can_bind(candidate):
            return candidate, False

    return None, False


def find_node():
    """定位 node.exe。

    优先扫 WorkBuddy 托管的 node，按目录名开头的 x.y.z 版本号从高到低取最新
    （目录名形如 22.22.2-6）；抓不到版本号的目录（例如 current 这类别名）排最后。
    没有托管版本时再回落系统安装路径，最后交给 PATH 解析。这样不再写死版本号，
    托管 node 升级后无需改代码。
    """
    # 打包版优先用随包分发的 node，目标是「解压即用、零外部依赖」。
    bundled = os.path.join(HERE, 'node', 'node.exe')
    if os.path.isfile(bundled):
        return bundled

    managed_root = os.path.expandvars(r'%USERPROFILE%\.workbuddy\binaries\node\versions')

    def version_key(name):
        match = re.match(r'(\d+)\.(\d+)\.(\d+)', name)
        return tuple(int(x) for x in match.groups()) if match else (0, 0, 0)

    try:
        dirs = [d for d in os.listdir(managed_root)
                if os.path.isdir(os.path.join(managed_root, d))]
    except OSError:
        dirs = []
    # 版本号高的排前面；版本号相同再按名字，保证顺序稳定。
    dirs.sort(key=lambda d: (version_key(d), d), reverse=True)
    for d in dirs:
        exe = os.path.join(managed_root, d, 'node.exe')
        if os.path.isfile(exe):
            return exe

    for path in (r'C:\Program Files\nodejs\node.exe',
                 r'C:\Program Files (x86)\nodejs\node.exe'):
        if os.path.isfile(path):
            return path
    return 'node'  # 交给 PATH 解析


def find_browser():
    for path in BROWSER_CANDIDATES:
        if os.path.isfile(path):
            return path
    return None


def popen_detached(argv, cwd, show_window=False):
    """后台拉起子进程，尽量保证父进程退出后它仍存活。

    某些环境（打包器、自动化外壳）会把子进程放进 Job Object，
    且设为「父进程一退就全杀」。CREATE_BREAKAWAY_FROM_JOB 可脱离这种作业；
    但若该作业不允许 breakaway，CreateProcess 会直接拒绝，
    所以失败时回退到不带该标志的方式。

    show_window=True 时**不加任何 creationflags**。DETACHED_PROCESS(0x8) 的含义
    正是「子进程不继承父控制台」，加上它会让 --show-window 一条 vite 输出都看不到；
    而这个入口的唯一用途就是「排查看报错」，必须让子进程继承当前控制台。
    """
    base = {'cwd': cwd, 'stdin': subprocess.DEVNULL}
    if show_window:
        base['stdout'] = None
        base['stderr'] = None
    else:
        base['stdout'] = subprocess.DEVNULL
        base['stderr'] = subprocess.DEVNULL

    attempts = []
    if os.name == 'nt':
        if show_window:
            attempts.append(0)  # 继承父控制台，vite 输出直接落在当前窗口
        else:
            attempts.append(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB)
            attempts.append(CREATE_NO_WINDOW | DETACHED_PROCESS)
    else:
        attempts.append(0)

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


def ensure_dist():
    """确保 dist/index.html 存在；缺失时用 vite 构建一次（最多等 5 分钟）。

    返回 True=可用；False=构建失败（调用方回落 dev 模式，功能仍全）。
    """
    if os.path.isfile(DIST_INDEX):
        return True
    if not os.path.isfile(VITE_JS):
        return False
    log('dist/ missing, running vite build...')
    node = find_node()
    try:
        proc = subprocess.run(
            [node, VITE_JS, 'build'], cwd=APP_DIR,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=300,
            creationflags=CREATE_NO_WINDOW,  # 同 autocommit：pythonw 下起 node 不闪控制台
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        log('vite build failed: %s' % exc)
        return False
    ok = proc.returncode == 0 and os.path.isfile(DIST_INDEX)
    log('vite build %s' % ('ok' if ok else 'failed rc=%s' % proc.returncode))
    return ok


def _alert_start_failure(port):
    """服务进程退出后的失败诊断（P2-1：占用/保留/其他，三种文案分开）。

    只看 can_bind() 会把「刚好被别的程序抢了端口」误诊成「被系统保留」，
    把排查方向带偏——所以先探测监听方是谁，再下结论。
    """
    if port_alive(port):
        if http_marker(port) is False:
            alert('端口 %d 被其他程序占用了（正在监听但不是本应用）。\n'
                  '可稍后重试，或改用其他端口（PORT_CANDIDATES）。' % port)
        else:
            alert('服务状态异常但端口 %d 在监听。\n'
                  '请尝试访问 http://localhost:%d/ ；若仍打不开，看日志：\n%s'
                  % (port, port, LOG_FILE))
        return
    if not can_bind(port):
        alert('端口 %d 被系统保留（Hyper-V / WSL2 / Docker 常见），无法绑定。\n\n'
              '想看被保留的端口段，在 cmd 里执行：\n'
              '    netsh int ipv4 show excludedportrange protocol=tcp\n\n'
              '详细日志见：\n%s' % (port, LOG_FILE))
        return
    alert('本地服务启动失败（进程已退出）。\n详细日志见：\n%s' % LOG_FILE)


def start_server(port, show_window=False, dev_mode=False):
    """启动本地服务（dev 模式跑 vite dev，否则跑 vite preview 服务 dist/）。
    阻塞到端口可用。返回 True/False。
    """
    node = find_node()
    if node != 'node' and not os.path.isfile(node):
        alert('找不到 Node.js 运行环境。\n请确认已安装 Node.js，且 todolist-gui 文件夹完整。')
        return False

    if dev_mode:
        argv = [node, VITE_JS, '--port', str(port), '--strictPort']
    else:
        argv = [node, VITE_JS, 'preview', '--port', str(port), '--strictPort']

    try:
        proc = popen_detached(argv, cwd=APP_DIR, show_window=show_window)
    except Exception as exc:  # noqa: BLE001
        alert('启动本地服务失败：\n%s\n\n详细日志见：\n%s' % (exc, LOG_FILE))
        return False

    log('server started pid=%d node=%s port=%d mode=%s'
        % (proc.pid, node, port, 'dev' if dev_mode else 'preview'))
    try:
        with open(PID_FILE, 'w', encoding='utf-8') as fh:
            fh.write(str(proc.pid))
    except OSError:
        pass

    for _ in range(48):  # 最多等约 12 秒
        if port_alive(port, 0.3):
            return True
        if proc.poll() is not None:  # 进程自己退了，说明起不来
            _alert_start_failure(port)
            return False
        time.sleep(0.25)
    alert('服务启动超时。\n可改用「启动待办清单.cmd」查看报错信息。')
    return False


def helper_argv(script):
    """构造「用当前解释器执行某个辅助脚本」的命令行。

    冻结后 sys.executable 是本 exe —— 直接 [exe, script] 会被当成"把脚本路径
    当参数再启一次启动器"，辅助脚本永远不会执行。所以冻结环境改走 --run-script
    子命令，由 exe 自己 import 后执行。
    """
    if getattr(sys, 'frozen', False):
        return [sys.executable, '--run-script', script]
    return [sys.executable, script]


def run_script(path):
    """在当前进程内按 __main__ 执行一个辅助脚本（等价于 `python <path>`）。

    用 runpy 而不是另起进程：冻结环境没有独立解释器可复用，而辅助脚本本来就是
    "启动器的一部分"，同进程执行语义一致。脚本里的 SystemExit(n) 翻译成返回码。
    """
    import runpy
    if not path or not os.path.isfile(path):
        log('run-script: file not found: %s' % path)
        return 1
    try:
        runpy.run_path(path, run_name='__main__')
        return 0
    except SystemExit as exc:
        code = exc.code
        return code if isinstance(code, int) else (0 if code is None else 1)
    except Exception as exc:  # noqa: BLE001
        log('run-script %s failed: %r' % (path, exc))
        return 1


def spawn_autocommit():
    """后台跑一次数据自动提交（git 版本化）。git 不存在 / 没有仓库 / 无变更时
    静默结束，任何失败都不影响启动。"""
    script = os.path.join(HERE, 'scripts', 'git_autocommit.py')
    if not os.path.isfile(script):
        return
    try:
        popen_detached(helper_argv(script), cwd=HERE)
        log('autocommit spawned')
    except Exception as exc:  # noqa: BLE001
        log('autocommit spawn failed: %s' % exc)


def open_ui():
    """优先用 Edge/Chrome 的 --app 模式打开（无地址栏，像原生应用）"""
    browser = find_browser()
    if browser:
        try:
            popen_detached([browser, '--app=%s' % make_url()], cwd=HERE)
            log('browser opened via --app: %s' % browser)
            return True
        except Exception as exc:  # noqa: BLE001
            log('browser --app failed: %s' % exc)
    try:
        webbrowser.open(make_url())
        log('browser opened via default handler')
        return True
    except Exception as exc:  # noqa: BLE001
        log('browser open failed: %s' % exc)
        return False


def main():
    global PORT, FORCED_PORT
    args = sys.argv[1:]

    # 子命令先于一切环境检查：--stop 不需要 todolist-gui / node 在场。
    if '--stop' in args:
        return run_script(os.path.join(HERE, 'stop_todolist.py'))
    if '--run-script' in args:
        idx = args.index('--run-script')
        target = args[idx + 1] if idx + 1 < len(args) else ''
        if target and not os.path.isabs(target):
            target = os.path.join(HERE, target)
        return run_script(target)

    no_browser = '--no-browser' in args
    show_window = '--show-window' in args
    dev_mode = '--dev' in args

    if '--port' in args:
        idx = args.index('--port')
        try:
            value = int(args[idx + 1])
        except (IndexError, ValueError):
            value = 0
        if not 1 <= value <= 65535:
            alert('--port 需要一个 1–65535 之间的端口号。')
            return 1
        FORCED_PORT = value

    if not os.path.isfile(VITE_JS):
        alert('找不到应用文件：\n%s\n\n请确认 todolist-gui 文件夹还在，且已执行过 npm install。' % VITE_JS)
        return 1

    if not dev_mode and not ensure_dist():
        log('dist unavailable, falling back to dev mode')
        dev_mode = True

    port, already_running = choose_port()
    if port is None:
        if FORCED_PORT is not None:
            alert('指定端口 %d 不可用（被占用，或被 Hyper-V / WSL2 / Docker 保留）。\n'
                  '换一个端口再试，或去掉 --port 让启动器自己挑。' % FORCED_PORT)
            return 1
        alert('没有可用端口：候选端口都被系统保留或被占用了。\n'
              '这通常是 Hyper-V / WSL2 / Docker 预留了端口段导致的。\n'
              '想看被保留的端口段，在 cmd 里执行：\n'
              '    netsh int ipv4 show excludedportrange protocol=tcp\n'
              '可稍后重试，或修改 launch_todolist.py 里的 PORT_CANDIDATES。')
        return 1

    PORT = port
    _write_port_file(PORT)

    # P2-1：选端口与真正绑定之间有竞态窗口，--strictPort 失败后换下一个候选端口
    # 重试（最多 2 次），而不是直接把失败甩给用户。
    ok = already_running
    if not ok:
        ok = start_server(PORT, show_window, dev_mode)
    tried = {PORT}
    retries = 0
    # 指定端口时不换端口重试：用户点名的端口没起来就该如实报错。
    while not ok and retries < 2 and FORCED_PORT is None:
        retries += 1
        nxt = next((c for c in PORT_CANDIDATES if c not in tried and can_bind(c)), None)
        if nxt is None:
            break
        tried.add(nxt)
        log('start failed on port %d, retrying with %d' % (PORT, nxt))
        PORT = nxt
        _write_port_file(PORT)
        ok = start_server(PORT, show_window, dev_mode)
    if not ok:
        return 1

    spawn_autocommit()

    if no_browser:
        log('--no-browser: server ready at %s' % make_url())
        print('server ready: %s' % make_url())
        return 0

    if not open_ui():
        alert('服务已在后台运行，但自动打开浏览器失败。\n请手动访问：\n%s' % make_url())
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
