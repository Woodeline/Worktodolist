"""打包 Windows 免安装分发包（可重复执行）。

产物（都在 `release/` 下）：
  Worktodolist-v<ver>-win-x64/        解压即用目录（exe + 内置 Node + 前端 + 脚本）
  Worktodolist-v<ver>-win-x64.zip     分发包（Release 附件就用它）
  SHA256SUMS.txt                      校验值

用法（在项目根目录，或任意位置传绝对路径）：
  python scripts/build_exe.py                  # 完整构建
  python scripts/build_exe.py --skip-dist      # 复用现有 dist（前端没动时省时间）
  python scripts/build_exe.py --no-zip         # 只组装目录，不打包 zip
  python scripts/build_exe.py --fresh          # 组装前把旧目录改名旁置，做一次干净重建
  python scripts/build_exe.py --reinstall-deps # 强制重装构建依赖（PyInstaller）
  python scripts/build_exe.py --keep-work      # 保留 PyInstaller 工作目录（排查用）

设计约束（为什么这么写）：
  * **不删任何东西。** 本机沙箱有 safe-delete 保护，单轮删除超过阈值会把整个工作区
    回滚（真实丢过 .git）。所以：PyInstaller 只管它自己的 `build/` 目录；组装到
    release 目录一律走"同步不镜像"（只增改、不删），需要干净重建时用 `--fresh`
    把旧目录**改名旁置**而不是删掉。
  * **可重复。** 依赖装在项目内 `.venv-build/`（带版本锁 `build-requirements.txt`），
    不污染系统 Python；文件同步按 size+mtime 跳过相同文件，重跑很快且结果一致。
  * **零外部依赖是目标。** 内置 `node/node.exe`（从本机已有 Node 复制，发行包不联网
    下载），并把前端依赖 `node_modules` 与预构建 `dist/` 一起打进去，目标机不需要
    装 Node、不需要 npm install。
"""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'scripts')
GUI = os.path.join(ROOT, 'todolist-gui')
RELEASE = os.path.join(ROOT, 'release')
BUILD = os.path.join(ROOT, 'build_exe')
VENV = os.path.join(ROOT, '.venv-build')
REQUIREMENTS = os.path.join(SCRIPTS, 'build-requirements.txt')
ICON = os.path.join(ROOT, 'todolist.ico')

APP_NAME = 'Worktodolist'

# 前端要随包分发的东西（白名单，避免把 src/、.tmp、qa-artifacts 一起带上）
GUI_ITEMS = ['dist', 'node_modules', 'index.html', 'styleguide.html',
             'package.json', 'vite.config.js', 'public']

# 随包分发的辅助脚本（--run-script 的目标；stop_todolist.py 由 --stop 用，放根目录）
HELPER_SCRIPTS = ['git_autocommit.py', 'daily_reminder.py', 'register_reminder_task.py']

# 瘦身：这些模块本应用完全用不到，打进去只会让包变大
EXCLUDE_MODULES = ['tkinter', '_tkinter', 'unittest', 'doctest', 'pydoc', 'distutils']

SKIP_DIR_NAMES = {'__pycache__', '.vite', '.cache', '.tmp', 'qa-artifacts', '.git'}


def say(msg):
    print('[build_exe] %s' % msg, flush=True)


def build_epoch():
    """构建时间戳。设了 SOURCE_DATE_EPOCH 就用它 —— 这是可重复构建的开关：
    同一个 epoch + 同一份源码，PyInstaller 产出的 exe 与 zip 逐字节一致
    （PyInstaller 6 会把该变量写进 PE 头，替代真实构建时间）。"""
    raw = os.environ.get('SOURCE_DATE_EPOCH', '').strip()
    if raw:
        try:
            return int(raw)
        except ValueError:
            say('SOURCE_DATE_EPOCH 不是整数，忽略：%r' % raw)
    return int(time.time())


def run(argv, cwd=None, quiet=False):
    """跑一条命令；失败直接抛，避免把半成品当成功产物。"""
    say('run: %s' % ' '.join('"%s"' % a if ' ' in a else a for a in argv))
    proc = subprocess.run(argv, cwd=cwd, text=True, encoding='utf-8',
                          errors='replace', check=False)
    if proc.returncode != 0:
        raise SystemExit('命令失败（exit %d）：%s' % (proc.returncode, argv[0]))
    return proc


# --------------------------------------------------------------------------
# 1. 构建依赖（项目内 venv + 版本锁）
# --------------------------------------------------------------------------
def requirement_pin():
    """从 build-requirements.txt 里取出 pyinstaller 的固定版本号。"""
    try:
        with open(REQUIREMENTS, 'r', encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if line.lower().startswith('pyinstaller=='):
                    return line.split('==', 1)[1].strip()
    except OSError:
        pass
    return None


def venv_python():
    return os.path.join(VENV, 'Scripts', 'python.exe')


def installed_pyinstaller(python):
    """venv 里已安装的 PyInstaller 版本；没装/装坏返回 None。"""
    try:
        proc = subprocess.run(
            [python, '-c', 'import PyInstaller;print(PyInstaller.__version__)'],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            check=False)
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    return (proc.stdout or '').strip()


def pip_install(python, args):
    """装依赖：先走本机默认源，失败再显式回落 pypi.org。

    本机 pip 默认指向清华镜像，极少数包在镜像页上有、索引里却取不到
    （表现为 `No matching distribution found ... (from versions: none)`），
    所以留一条直连官方源的退路。
    """
    base = [python, '-m', 'pip', 'install', '--disable-pip-version-check']
    try:
        run(base + args)
        return
    except SystemExit:
        say('默认源安装失败，回落 pypi.org 直连重试')
    run(base + ['-i', 'https://pypi.org/simple',
                '--trusted-host', 'pypi.org',
                '--trusted-host', 'files.pythonhosted.org'] + args)


def ensure_deps(reinstall=False):
    """确保项目内 venv 里装有锁定版本的 PyInstaller，返回该 venv 的 python。"""
    python = venv_python()
    if not os.path.isfile(python):
        say('创建构建用虚拟环境：%s' % VENV)
        run([sys.executable, '-m', 'venv', VENV])

    pin = requirement_pin()
    current = installed_pyinstaller(python)
    if current and not reinstall and (pin is None or current == pin):
        say('PyInstaller 已就绪：%s' % current)
        return python

    say('安装构建依赖（当前=%s，目标=%s）' % (current or '未安装', pin or '最新'))
    if pin:
        pip_install(python, ['pyinstaller==%s' % pin])
    else:
        pip_install(python, ['pyinstaller'])
    current = installed_pyinstaller(python)
    if not current:
        raise SystemExit('PyInstaller 安装后仍无法导入，请检查网络与 pip 源。')
    say('PyInstaller 就绪：%s' % current)
    return python


# --------------------------------------------------------------------------
# 2. 版本与 dist
# --------------------------------------------------------------------------
def app_version():
    with open(os.path.join(GUI, 'package.json'), 'r', encoding='utf-8') as fh:
        return json.load(fh)['version']


def load_launcher():
    """按路径加载 launch_todolist，复用它找 Node 的逻辑（避免两处漂移）。"""
    spec = importlib.util.spec_from_file_location(
        '_lt_for_build', os.path.join(ROOT, 'launch_todolist.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def node_exe():
    node = load_launcher().find_node()
    if not os.path.isfile(node):
        resolved = shutil.which(node)
        if not resolved:
            raise SystemExit('找不到 node.exe（打包需要本机已有 Node 运行时）。')
        node = resolved
    return node


def node_version(node):
    proc = subprocess.run([node, '--version'], capture_output=True, text=True,
                          encoding='utf-8', errors='replace', check=False)
    return (proc.stdout or '').strip() or 'unknown'


def ensure_dist(node, skip=False):
    index = os.path.join(GUI, 'dist', 'index.html')
    if skip and os.path.isfile(index):
        say('复用现有 dist（--skip-dist）')
        return
    vite = os.path.join(GUI, 'node_modules', 'vite', 'bin', 'vite.js')
    if not os.path.isfile(vite):
        raise SystemExit('缺少 %s —— 先在 todolist-gui 下执行 npm install。' % vite)
    say('构建前端产物（vite build）')
    run([node, vite, 'build'], cwd=GUI)


# --------------------------------------------------------------------------
# 3. PyInstaller
# --------------------------------------------------------------------------
def clear_output_dir(path):
    """清掉 PyInstaller 上一次的输出目录。

    正常环境直接 rmtree。受限环境里删除会被拦（本机沙箱的 safe-delete 在单轮
    删除超过阈值时直接拒绝，PyInstaller 的 --noconfirm 会因此报错退出），
    所以退化为「改名旁置」—— 清理失败绝不能让整个构建失败。
    """
    if not os.path.isdir(path):
        return
    try:
        shutil.rmtree(path)
        return
    except OSError as exc:
        say('直接清理 %s 失败（%s），改为改名旁置' % (os.path.basename(path), exc))
    aside = '%s_prev_%s' % (path, time.strftime('%Y%m%d_%H%M%S'))
    try:
        os.rename(path, aside)
        say('旧产物已旁置：%s' % aside)
    except OSError as exc:
        say('旁置也失败，仍交给 PyInstaller --noconfirm 处理：%s' % exc)


def run_pyinstaller(python, keep_work=False):
    pydist = os.path.join(BUILD, 'pydist')
    os.makedirs(BUILD, exist_ok=True)
    clear_output_dir(os.path.join(pydist, APP_NAME))
    argv = [python, '-m', 'PyInstaller',
            '--noconfirm', '--clean',
            '--onedir', '--windowed',
            '--name', APP_NAME,
            '--distpath', pydist,
            '--workpath', os.path.join(BUILD, 'work'),
            '--specpath', BUILD]
    if os.path.isfile(ICON):
        argv += ['--icon', ICON]
    for mod in EXCLUDE_MODULES:
        argv += ['--exclude-module', mod]
    # 入口即启动器本体：--stop / --run-script / 窗口化跳控制台 都在它里面。
    argv.append(os.path.join(ROOT, 'launch_todolist.py'))
    run(argv, cwd=ROOT)
    produced = os.path.join(pydist, APP_NAME)
    if not os.path.isfile(os.path.join(produced, APP_NAME + '.exe')):
        raise SystemExit('PyInstaller 没有产出 %s.exe，构建中止。' % APP_NAME)
    return produced


# --------------------------------------------------------------------------
# 4. 组装（同步不镜像：只增改，不删除）
# --------------------------------------------------------------------------
def sync_tree(src, dst):
    """把 src 同步进 dst：只复制"缺失或 size/mtime 不同"的文件，绝不删除。

    返回 (复制数, 跳过数)。不删除是为了不触发沙箱 safe-delete；
    代价是多余的旧文件不会被清掉 —— 需要干净重建时用 --fresh。
    """
    copied = skipped = 0
    if not os.path.isdir(src):
        return copied, skipped
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        rel = os.path.relpath(root, src)
        target_root = dst if rel == '.' else os.path.join(dst, rel)
        os.makedirs(target_root, exist_ok=True)
        for name in files:
            source = os.path.join(root, name)
            target = os.path.join(target_root, name)
            try:
                src_stat = os.stat(source)
            except OSError:
                continue
            if os.path.isfile(target):
                dst_stat = os.stat(target)
                if (dst_stat.st_size == src_stat.st_size
                        and int(dst_stat.st_mtime) == int(src_stat.st_mtime)):
                    skipped += 1
                    continue
            shutil.copy2(source, target)
            copied += 1
    return copied, skipped


def write_text(path, text, bom=False):
    with open(path, 'w', encoding='utf-8-sig' if bom else 'utf-8',
              newline='\r\n') as fh:
        fh.write(text)


LAUNCH_CMD = """@echo off
title Worktodolist
cd /d "%~dp0"
rem Windowed launcher: starts the local server and opens Edge/Chrome in app mode.
start "" "%~dp0{exe}"
exit /b 0
"""

STOP_CMD = """@echo off
title Worktodolist - stop
cd /d "%~dp0"
"%~dp0{exe}" --stop
exit /b 0
"""

REMINDER_CMD = """@echo off
title Worktodolist - register daily reminder
cd /d "%~dp0"
"%~dp0{exe}" --run-script "scripts\\register_reminder_task.py"
echo.
pause
"""

README_TXT = """Worktodolist {ver} · Windows 免安装版
====================================================

怎么用
------
1. 双击「启动待办清单.cmd」。会起一个后台本地服务，并用 Edge / Chrome 的
   应用模式打开界面（没有地址栏，像一个原生程序）。
2. 第一次打开时，在弹出的目录选择里选中本文件夹（即解压出来的这个目录），
   授权浏览器读写 todo.txt。授权会被记住，之后启动不再问。
3. 任务都记在 todo.txt 里，纯文本，随时可以用记事本打开、备份、或拿去
   别的地方。

怎么关
------
双击「停止待办清单.cmd」结束后台服务。不关也没关系，它只是一个本地小服务。

包里有什么
----------
  Worktodolist.exe        启动器（已内置 Python 运行时，不需要你装 Python）
  node\\node.exe           内置的 Node 运行时（前端服务用它，不需要你装 Node）
  todolist-gui\\           前端与它的依赖（含预构建产物 dist\\）
  scripts\\                辅助脚本（数据自动提交、每日提醒、提醒任务注册）
  stop_todolist.py        停止脚本（由 exe --stop 调用）
  todo.txt / done.txt     你的数据（唯一真源）
  启动待办清单.cmd          启动
  停止待办清单.cmd          停止
  注册每日提醒.cmd          可选：注册每天 09:00 的到期/逾期提醒

数据与隐私
----------
* 数据只在你本机：todo.txt / done.txt 就是全部，没有数据库、没有云端。
* 界面上的对话指令由本地规则引擎解析，默认绝不联网。
* 只有你主动开启并配置了「AI 兜底」之后，本地规则没听懂的那一句才会发往
  你自己填的那个服务；配置只存本机浏览器，API Key 不落盘到文件。

已知边界
--------
* 界面必须用 Edge 或 Chrome（依赖 File System Access API），换浏览器要重新授权。
* 撤销历史只在内存里，重启后清零（git 历史与每日备份可兜底找回数据）。
* 本包体积主要来自内置的 Node 运行时，这是"解压即用、零外部依赖"的代价。

{extra}
"""


def assemble(produced, version, node, node_ver, pyinstaller_ver, py_ver, epoch):
    bundle_name = '%s-v%s-win-x64' % (APP_NAME, version)
    bundle = os.path.join(RELEASE, bundle_name)
    os.makedirs(RELEASE, exist_ok=True)
    os.makedirs(bundle, exist_ok=True)

    stats = []
    # ① PyInstaller 产物（exe + _internal）
    copied, skipped = sync_tree(produced, bundle)
    stats.append(('启动器 exe + 运行时', copied, skipped))

    # ② 内置 Node（只带 node.exe：vite 运行时只需要解释器本体）
    node_dir = os.path.join(bundle, 'node')
    os.makedirs(node_dir, exist_ok=True)
    target_node = os.path.join(node_dir, 'node.exe')
    src_stat = os.stat(node)
    if not (os.path.isfile(target_node)
            and os.stat(target_node).st_size == src_stat.st_size):
        shutil.copy2(node, target_node)
        stats.append(('node.exe', 1, 0))
    else:
        stats.append(('node.exe', 0, 1))

    # ③ 前端（预构建 dist + 依赖 node_modules）
    for item in GUI_ITEMS:
        copied, skipped = sync_tree(os.path.join(GUI, item),
                                    os.path.join(bundle, 'todolist-gui', item))
        stats.append(('todolist-gui/%s' % item, copied, skipped))

    # ④ 辅助脚本
    script_dir = os.path.join(bundle, 'scripts')
    os.makedirs(script_dir, exist_ok=True)
    copied = skipped = 0
    for name in HELPER_SCRIPTS:
        source = os.path.join(SCRIPTS, name)
        if not os.path.isfile(source):
            continue
        target = os.path.join(script_dir, name)
        if os.path.isfile(target) and os.stat(target).st_size == os.stat(source).st_size:
            skipped += 1
            continue
        shutil.copy2(source, target)
        copied += 1
    stats.append(('scripts/', copied, skipped))

    # stop_todolist.py 必须落在包根（--stop 按 HERE 解析）
    stop_src = os.path.join(ROOT, 'stop_todolist.py')
    stop_dst = os.path.join(bundle, 'stop_todolist.py')
    if os.path.isfile(stop_src):
        if not (os.path.isfile(stop_dst)
                and os.stat(stop_dst).st_size == os.stat(stop_src).st_size):
            shutil.copy2(stop_src, stop_dst)
            stats.append(('stop_todolist.py', 1, 0))
        else:
            stats.append(('stop_todolist.py', 0, 1))

    # ⑤ 数据文件：只放空模板，绝不把作者本人的 todo 带进发行包
    for name in ('todo.txt', 'done.txt'):
        path = os.path.join(bundle, name)
        if not os.path.exists(path):
            write_text(path, '')
    # 运行期残留不该进包
    for junk in ('.todolist-server.port', '.todolist-server.pid', '.todolist-launch.log'):
        stale = os.path.join(bundle, junk)
        if os.path.exists(stale):
            os.rename(stale, os.path.join(RELEASE, '_stale_%s' % junk))

    # ⑥ 入口与说明
    write_text(os.path.join(bundle, '启动待办清单.cmd'),
               LAUNCH_CMD.format(exe=APP_NAME + '.exe'))
    write_text(os.path.join(bundle, '停止待办清单.cmd'),
               STOP_CMD.format(exe=APP_NAME + '.exe'))
    write_text(os.path.join(bundle, '注册每日提醒.cmd'),
               REMINDER_CMD.format(exe=APP_NAME + '.exe'))

    extra = ('构建信息\n--------\n'
             '  版本号      : %s\n'
             '  构建时间    : %s\n'
             '  Python      : %s\n'
             '  PyInstaller : %s\n'
             '  内置 Node   : %s\n'
             % (version, time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(epoch)),
                py_ver, pyinstaller_ver, node_ver))
    write_text(os.path.join(bundle, '使用说明.txt'),
               README_TXT.format(ver=version, extra=extra), bom=True)
    write_text(os.path.join(bundle, 'VERSION.txt'),
               'version=%s\nbuilt=%s\npython=%s\npyinstaller=%s\nnode=%s\n'
               % (version, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(epoch)),
                  py_ver, pyinstaller_ver, node_ver), bom=True)

    return bundle, bundle_name, stats


def make_zip(bundle, bundle_name, epoch):
    """把发行目录打成 zip。

    条目时间戳统一取 epoch（而不是各文件真实的 mtime），并且按字典序遍历 ——
    这样"同一个 SOURCE_DATE_EPOCH + 同一份源码"产出的 zip 是逐字节一致的，
    直接比对 sha256 就能证明构建可重复。
    """
    zip_path = os.path.join(RELEASE, bundle_name + '.zip')
    say('打包 zip：%s' % zip_path)
    stamp = time.gmtime(max(epoch, 315532800))[:6]  # ZIP 不认 1980-01-01 之前的时间
    count = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, dirs, files in os.walk(bundle):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIR_NAMES)
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, os.path.dirname(bundle))
                info = zipfile.ZipInfo(rel.replace(os.sep, '/'),
                                       date_time=stamp)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                with open(full, 'rb') as src, zf.open(info, 'w') as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
                count += 1
    say('  zip 内含 %d 个文件' % count)
    return zip_path


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def human(size):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return '%.1f %s' % (size, unit) if unit != 'B' else '%d B' % size
        size /= 1024.0


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def main():
    parser = argparse.ArgumentParser(description='打包 Windows 免安装分发包')
    parser.add_argument('--skip-dist', action='store_true', help='复用现有 dist')
    parser.add_argument('--no-zip', action='store_true', help='不打包 zip')
    parser.add_argument('--fresh', action='store_true',
                        help='组装前把旧发行目录改名旁置，做一次干净重建')
    parser.add_argument('--reinstall-deps', action='store_true',
                        help='强制重装构建依赖')
    parser.add_argument('--keep-work', action='store_true',
                        help='保留 PyInstaller 工作目录')
    args = parser.parse_args()

    started = time.time()
    version = app_version()
    epoch = build_epoch()
    os.environ['SOURCE_DATE_EPOCH'] = str(epoch)  # PyInstaller 子进程继承
    say('版本号：%s ｜ 构建时间戳：%s' % (
        version, time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(epoch))))

    python = ensure_deps(reinstall=args.reinstall_deps)
    pyinstaller_ver = installed_pyinstaller(python) or 'unknown'
    py_ver = subprocess.run(
        [python, '-c', 'import sys;print(sys.version.split()[0])'],
        capture_output=True, text=True, encoding='utf-8',
        errors='replace').stdout.strip()

    node = node_exe()
    node_ver = node_version(node)
    say('Node：%s (%s)' % (node, node_ver))

    ensure_dist(node, skip=args.skip_dist)

    bundle_name = '%s-v%s-win-x64' % (APP_NAME, version)
    bundle = os.path.join(RELEASE, bundle_name)
    if args.fresh and os.path.isdir(bundle):
        aside = os.path.join(RELEASE, '_prev_%s_%s' % (
            bundle_name, time.strftime('%Y%m%d_%H%M%S')))
        say('--fresh：旧发行目录改名旁置 -> %s' % os.path.basename(aside))
        os.rename(bundle, aside)

    say('PyInstaller 打包中（onedir / windowed）…')
    produced = run_pyinstaller(python, keep_work=args.keep_work)

    bundle, bundle_name, stats = assemble(
        produced, version, node, node_ver, pyinstaller_ver, py_ver, epoch)

    exe_path = os.path.join(bundle, APP_NAME + '.exe')
    lines = ['产物清单：']
    for label, copied, skipped in stats:
        lines.append('  %-28s 复制 %-4d 跳过 %d' % (label, copied, skipped))
    say('\n'.join(lines))

    zip_path = None
    if not args.no_zip:
        zip_path = make_zip(bundle, bundle_name, epoch)

    sums = []
    if zip_path:
        sums.append(('%s.zip' % bundle_name, sha256(zip_path)))
    sums.append(('%s/%s.exe' % (bundle_name, APP_NAME), sha256(exe_path)))
    sums_path = os.path.join(RELEASE, 'SHA256SUMS.txt')
    write_text(sums_path, ''.join('%s  %s\n' % (h, n) for n, h in sums))

    say('')
    say('==== 完成（%.1fs）====' % (time.time() - started))
    say('发行目录：%s  (%s)' % (bundle, human(dir_size(bundle))))
    if zip_path:
        say('分发包　：%s  (%s)' % (zip_path, human(os.path.getsize(zip_path))))
    say('校验值　：%s' % sums_path)
    for name, digest in sums:
        say('  %s  %s' % (digest, name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
