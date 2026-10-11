"""验证发行包产物可用（可重复执行）。

做六件事，任何一项不过就以非零码退出：

  1. **校验值**：zip 的 sha256 与 `release/SHA256SUMS.txt` 里记录的一致
  2. **压缩包完整性**：逐条目 CRC 自检（`zipfile.testzip`）
  3. **包内容对账**：zip 里的文件清单与发行目录里的实际文件逐个对得上
  4. **冷启动**：把 zip 解压到独立目录，跑包内 `Worktodolist.exe --no-browser --port <空闲端口>`
  5. **服务可用**：HTTP 200 且页面标题含应用标记「待办清单」
  6. **自包含**：启动日志里记录的 node 路径落在**解压目录内**（即用的是包内 Node），
     且包内含 Python 运行时（不需要目标机装 Python）；最后 `--stop` 能把服务收掉

用法：
  python scripts/verify_release.py                  # 验当前 package.json 版本对应的包
  python scripts/verify_release.py --zip <路径>     # 指定 zip
  python scripts/verify_release.py --no-extract     # 只做 1–3 项静态校验

说明：解压目录默认在 `release/_verify/`。脚本**不删除任何东西**（本机沙箱的
safe-delete 会在单轮删除过多文件时回滚整个工作区），重复运行会就地覆盖。
"""
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUI = os.path.join(ROOT, 'todolist-gui')
RELEASE = os.path.join(ROOT, 'release')
APP_NAME = 'Worktodolist'
MARKER = '待办清单'

RESULTS = []


def record(name, ok, detail=''):
    RESULTS.append((name, bool(ok), detail))
    print('  [%s] %-14s %s' % ('PASS' if ok else 'FAIL', name, detail), flush=True)
    return ok


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_sums():
    """读 SHA256SUMS.txt -> {文件名: sha256}"""
    out = {}
    path = os.path.join(RELEASE, 'SHA256SUMS.txt')
    if not os.path.isfile(path):
        return out
    with open(path, 'r', encoding='utf-8') as fh:
        for line in fh:
            parts = line.strip().split('  ', 1)
            if len(parts) == 2:
                out[parts[1]] = parts[0]
    return out


def free_port():
    """找一个 IPv4/IPv6 回环都能绑的端口（启动器两种栈都会试）。"""
    for _ in range(60):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        try:
            with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as probe6:
                probe6.bind(('::1', port))
        except OSError:
            continue
        return port
    raise SystemExit('找不到可用端口')


def port_open(port, timeout=0.5):
    for host, family in (('127.0.0.1', socket.AF_INET), ('::1', socket.AF_INET6)):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                sock.connect((host, port))
                return True
        except OSError:
            continue
    return False


def http_marker(port, timeout=2.0):
    """GET / 并判断是不是本应用。返回 (状态码, 是否命中标记)。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for host in ('localhost', '127.0.0.1'):
        try:
            with opener.open('http://%s:%d/' % (host, port), timeout=timeout) as resp:
                body = resp.read(65536).decode('utf-8', 'replace')
            return resp.status, MARKER in body
        except urllib.error.HTTPError as exc:
            return exc.code, False
        except Exception:
            continue
    return 0, False


def run_exe(exe, args, timeout=180):
    env = dict(os.environ)
    env['TODOLIST_NO_DIALOG'] = '1'   # 出错也只写日志/标准输出，不弹窗卡住脚本
    try:
        proc = subprocess.run([exe, *args], capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=timeout,
                              env=env)
        return proc.returncode, (proc.stdout or '') + (proc.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT'


def static_checks(zip_path, bundle):
    ok = True
    sums = read_sums()
    name = os.path.basename(zip_path)
    expect = sums.get(name)
    actual = sha256(zip_path)
    ok &= record('sha256', expect == actual,
                 ('%s == %s' % (actual[:16], (expect or '(缺失)')[:16])))

    with zipfile.ZipFile(zip_path) as zf:
        bad = zf.testzip()
        ok &= record('zip 完整性', bad is None, 'CRC 全部通过' if bad is None
                     else '损坏条目：%s' % bad)

        names = sorted(i.filename for i in zf.infolist() if not i.is_dir())
    disk = []
    for root, dirs, files in os.walk(bundle):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in files:
            full = os.path.join(root, f)
            disk.append(os.path.relpath(full, os.path.dirname(bundle)).replace(os.sep, '/'))
    disk.sort()
    same = names == disk
    detail = '%d 个条目一致' % len(names) if same else (
        'zip 独有 %d / 目录独有 %d' % (
            len(set(names) - set(disk)), len(set(disk) - set(names))))
    ok &= record('内容对账', same, detail)

    exe_in_zip = '%s/%s.exe' % (os.path.basename(bundle), APP_NAME)
    ok &= record('zip 含 exe', exe_in_zip in names)
    return ok


def extract(zip_path, target):
    """解压（就地覆盖，不删除）。返回解压后的包根目录。"""
    os.makedirs(target, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(target)
    entries = [d for d in os.listdir(target)
               if os.path.isdir(os.path.join(target, d))]
    if len(entries) != 1:
        raise SystemExit('%s 下应当恰好有一个顶层目录，实际：%s' % (target, entries))
    return os.path.join(target, entries[0])


def read_logged_node(bundle):
    """从启动日志里取启动器实际使用的 node 路径（这是"用了内置 node"的直接证据）。"""
    log = os.path.join(bundle, '.todolist-launch.log')
    if not os.path.isfile(log):
        return None
    with open(log, 'r', encoding='utf-8', errors='replace') as fh:
        for line in reversed(fh.readlines()):
            if ' node=' in line:
                tail = line.split(' node=', 1)[1]
                return tail.split(' port=', 1)[0].strip()
    return None


def launch_log_tail(bundle, lines=12):
    """取 .todolist-launch.log 的尾部若干行。

    冻结版的辅助脚本（stop_todolist.py 等）是**同进程**执行的，异常只会被
    启动器的 run_script 捕获后写进这个日志——不吐出来就没法定位。
    """
    log = os.path.join(bundle, '.todolist-launch.log')
    if not os.path.isfile(log):
        return ''
    try:
        with open(log, 'r', encoding='utf-8', errors='replace') as fh:
            return '\n'.join(line.rstrip() for line in fh.readlines()[-lines:])
    except OSError:
        return ''


def functional_checks(bundle, skip_stop=False):
    ok = True
    exe = os.path.join(bundle, APP_NAME + '.exe')
    if not os.path.isfile(exe):
        return record('exe 存在', False, exe)

    internal = os.path.join(bundle, '_internal')
    pydll = []
    if os.path.isdir(internal):
        pydll = [f for f in os.listdir(internal) if f.lower().startswith('python')]
    ok &= record('内置 Python', bool(pydll), ','.join(sorted(pydll)) or '未找到 python*.dll')
    ok &= record('内置 Node', os.path.isfile(os.path.join(bundle, 'node', 'node.exe')))

    port = free_port()
    code, out = run_exe(exe, ['--no-browser', '--port', str(port)])
    ok &= record('冷启动退出码', code == 0,
                 'rc=%d %s' % (code, (out.strip().splitlines() or [''])[-1][:70]))

    status, hit = 0, False
    deadline = time.time() + 20
    while time.time() < deadline:
        status, hit = http_marker(port)
        if hit:
            break
        time.sleep(0.5)
    ok &= record('HTTP 服务', status == 200 and hit,
                 'status=%s marker=%s port=%d' % (status, hit, port))

    node_used = read_logged_node(bundle)
    inside = bool(node_used) and os.path.abspath(node_used).lower().startswith(
        os.path.abspath(bundle).lower())
    ok &= record('用的是包内 Node', inside, node_used or '(日志里没找到)')

    if skip_stop:
        record('--stop 收尾', True, '已跳过（--skip-stop）')
        return ok

    code, out = run_exe(exe, ['--stop'])
    closed = False
    deadline = time.time() + 15
    while time.time() < deadline:
        if not port_open(port):
            closed = True
            break
        time.sleep(0.5)
    detail = 'rc=%d 端口已关=%s' % (code, closed)
    if code != 0 or not closed:
        # 失败时把子进程输出与启动器日志一起吐出来，否则只有一句 rc=1 无从下手
        tail = (out or '').strip()
        if tail:
            detail += '\n      子进程输出：' + tail[-500:].replace('\n', '\n        ')
        log_tail = launch_log_tail(bundle)
        if log_tail:
            detail += '\n      启动器日志尾部：\n        ' + log_tail.replace('\n', '\n        ')
    ok &= record('--stop 收尾', code == 0 and closed, detail)
    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', default=None, help='指定分发包路径')
    parser.add_argument('--no-extract', action='store_true', help='只做静态校验')
    parser.add_argument('--skip-stop', action='store_true',
                        help='跳过 --stop 收尾校验（不想动任何运行中的服务时用）')
    args = parser.parse_args()

    if args.zip:
        zip_path = os.path.abspath(args.zip)
    else:
        with open(os.path.join(GUI, 'package.json'), 'r', encoding='utf-8') as fh:
            version = json.load(fh)['version']
        zip_path = os.path.join(
            RELEASE, '%s-v%s-win-x64.zip' % (APP_NAME, version))
    if not os.path.isfile(zip_path):
        raise SystemExit('找不到分发包：%s' % zip_path)

    bundle = zip_path[:-len('.zip')]
    print('分发包：%s' % zip_path)
    print('发行目录：%s' % bundle)
    print('')
    print('静态校验')
    ok = static_checks(zip_path, bundle)

    if not args.no_extract:
        print('')
        print('功能校验（解压到独立目录后运行）')
        target = os.path.join(RELEASE, '_verify')
        root = extract(zip_path, target)
        print('  解压目录：%s' % root)
        ok &= functional_checks(root, skip_stop=args.skip_stop)

    print('')
    failed = [n for n, good, _ in RESULTS if not good]
    if ok and not failed:
        print('==== 全部通过（%d 项）====' % len(RESULTS))
        return 0
    print('==== 失败 %d 项：%s ====' % (len(failed), ', '.join(failed)))
    return 1


if __name__ == '__main__':
    sys.exit(main())
