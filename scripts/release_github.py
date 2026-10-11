"""把发行包发布到 GitHub Releases（幂等，可重复执行）。

一条链走完：读版本 → 打包 → 验包 → 打本地 tag → 建 Release（GitHub 顺带建远端 tag）
→ 上传附件 → 服务端对账 → **最后才推 tag**。

最后一步推 tag 是刻意的，不是随手排的：推 tag 会触发 .github/workflows/release.yml
的 push 护栏，护栏靠「这个 tag 的 Release 有没有附件」决定跳不跳过构建。推早了 CI
看到的还是「没发布」，它会自己重建一遍，十几分钟后把本机刚传上去的产物覆盖掉。

用法（在项目根目录）：
  python scripts/release_github.py                     # 完整链路（日常发版走这条）
  python scripts/release_github.py --skip-build        # 复用 release/ 下已有的产物，只验包+发布
  python scripts/release_github.py --skip-verify       # 跳过验包（不推荐，仅排障用）
  python scripts/release_github.py --no-push           # 只本地打 tag，不推远端
  python scripts/release_github.py --skip-tag          # 完全不动 tag（GitHub Actions 里用）
  python scripts/release_github.py --draft             # 建草稿 Release（不对外展示）
  python scripts/release_github.py --dry-run           # 只打印将要做什么
  python scripts/release_github.py --precheck          # 只查 Release 是否已存在，打印 STATE=...
  python scripts/release_github.py --version 1.0.2     # 覆盖版本号（tag = v1.0.2）

设计约束（为什么这么写）：
  * **幂等。** 每个写操作都先查再写：tag 已存在就复用、Release 已存在就更新、同名附件先删后传。
    本机网络会在写操作中途被 TLS 掐断，所以「跑失败就重跑」必须是无害的。
  * **不信退出码，只信读回。** 推完 tag 用 `git ls-remote` 读回、传完附件用服务端 `digest`
    复核。本机多次出现「命令回显成功但实际没生效」。
  * **令牌不落盘、不打印。** 优先读 GH_TOKEN / GITHUB_TOKEN 环境变量（CI 用），
    没有才回落 git 凭据管理器（本机用）。
  * **网络层不复用 urllib 的代理环境变量。** 本机 shell 里可能残留指向错误端口的代理，
    会让 api.github.com 返回 502；这里显式清空代理，直连。
  * **上传必须走 Python 的 TLS 栈。** Windows 的 curl 走 schannel 做吊销检查，取不到 CRL
    就中止握手（CRYPT_E_REVOCATION_OFFLINE），传不上去；Python 的 OpenSSL 栈不做吊销检查。

环境变量：
  GH_TOKEN / GITHUB_TOKEN   令牌（没有则回落 Windows 凭据管理器）
  TODOLIST_GIT_PROXY        推 tag 用的代理：不设＝不干预；none/off/- ＝强制直连；其它＝该代理
"""
import argparse
import base64
import hashlib
import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'scripts')
GUI = os.path.join(ROOT, 'todolist-gui')
RELEASE = os.path.join(ROOT, 'release')
APP_NAME = 'Worktodolist'

API_HOST = 'api.github.com'
UPLOAD_HOST = 'uploads.github.com'
UA = 'worktodolist-release'

# 非交互环境不许 git 挂住等输入
os.environ.setdefault('GIT_TERMINAL_PROMPT', '0')

# git 网络参数：本机 github.com 的写操作会被 TLS 半途掐断，schannel + HTTP/1.1 最耐受
GIT_NET = ['-c', 'http.sslBackend=schannel', '-c', 'http.version=HTTP/1.1',
           '-c', 'http.postBuffer=524288000']

# 代理不写死。本机没有稳定的 github 通路：直连、环境变量里的代理、本地代理端口，
# 谁通谁不通每次都不同（同一次会话里也会变）。用 TODOLIST_GIT_PROXY 控制：
#   未设置            → 不干预，用 git 自己的配置 / http_proxy 环境变量
#   none / off / -    → 强制直连（-c http.proxy=）
#   其它（http://…）  → 走该代理
_GIT_PROXY = os.environ.get('TODOLIST_GIT_PROXY', '').strip()


def git_net_args():
    args = list(GIT_NET)
    if not _GIT_PROXY:
        return args
    proxy = '' if _GIT_PROXY.lower() in ('none', 'off', '-') else _GIT_PROXY
    return args + ['-c', 'http.proxy=%s' % proxy, '-c', 'https.proxy=%s' % proxy]


def git_auth_args(user, token):
    """git 网络认证：用令牌拼一次性 Basic 头，绕开凭据管理器。

    本机全局配的 helper 是 git-credential-manager；github.com 通路一断，它会
    卡住不返回（实测 push 静默挂死 150s 以上，且不留任何输出，极易误判成"网络
    慢"）。这里直接用已经取到的令牌，并把 helper 列表清空，彻底不碰 GCM。
    """
    if not token:
        return []
    basic = base64.b64encode(('%s:%s' % (user, token)).encode('utf-8')).decode('ascii')
    return ['-c', 'credential.helper=',
            '-c', 'http.extraheader=Authorization: Basic %s' % basic]


def say(msg):
    print('[release] %s' % msg, flush=True)


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------
def run(argv, cwd=None):
    """跑一条外部命令；失败直接抛，绝不把半成品当成功。"""
    say('run: %s' % ' '.join('"%s"' % a if ' ' in a else a for a in argv))
    proc = subprocess.run(argv, cwd=cwd or ROOT, check=False)
    if proc.returncode != 0:
        raise SystemExit('命令失败（exit %d）：%s' % (proc.returncode, argv[0]))


def git(*args):
    """跑 git，返回 (rc, stdout, stderr)。不抛异常，交给调用方判断。"""
    proc = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True,
                          encoding='utf-8', errors='replace', check=False)
    return proc.returncode, (proc.stdout or '').strip(), (proc.stderr or '').strip()


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def human(size):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return ('%.1f %s' % (size, unit)) if unit != 'B' else ('%d B' % size)
        size /= 1024.0


def read_version(override=None):
    if override:
        return override.strip().lstrip('vV')
    with open(os.path.join(GUI, 'package.json'), 'r', encoding='utf-8') as fh:
        return json.load(fh)['version']


def resolve_repo(override=None):
    if override:
        return override
    _, out, _ = git('remote', 'get-url', 'origin')
    match = re.search(r'github\.com[:/]+([^/]+)/([^/]+?)(?:\.git)?/?$', out)
    if not match:
        raise SystemExit('无法从 origin 解析 owner/repo（当前 origin：%r），请用 --repo 指定。' % out)
    return '%s/%s' % (match.group(1), match.group(2))


def changelog_section(version):
    """从 CHANGELOG.md 里抠出该版本的章节，作为 Release 说明的正文。"""
    path = os.path.join(ROOT, 'CHANGELOG.md')
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            lines = fh.read().splitlines()
    except OSError:
        return None
    heads = [i for i, line in enumerate(lines) if line.startswith('## ')]
    for idx, start in enumerate(heads):
        title = lines[start][3:].strip()
        # 形如 "## v1.0.1 · 2026-10-11"
        if title.split('·')[0].strip().lstrip('vV') == version:
            end = heads[idx + 1] if idx + 1 < len(heads) else len(lines)
            return '\n'.join(lines[start:end]).strip()
    return None


# --------------------------------------------------------------------------
# 凭据
# --------------------------------------------------------------------------
def get_credentials():
    """返回 (用户名, 令牌)。优先环境变量（CI 用），否则回落 git 凭据管理器。

    取 username 是为了拼 git 的 Basic 头；拿不到就用 x-access-token ——
    GitHub 用令牌做 Basic 认证时不校验用户名。
    """
    for name in ('GH_TOKEN', 'GITHUB_TOKEN'):
        value = (os.environ.get(name) or '').strip()
        if value:
            say('使用环境变量 %s 里的令牌' % name)
            return os.environ.get('GH_USER', 'x-access-token').strip() or 'x-access-token', value
    say('环境变量里没有令牌，回落 git 凭据管理器（wincred）')
    proc = subprocess.run(
        ['git', '-c', 'credential.helper=', '-c', 'credential.helper=wincred',
         'credential', 'fill'],
        input='protocol=https\nhost=github.com\n\n', cwd=ROOT,
        capture_output=True, text=True, encoding='utf-8', errors='replace', check=False)
    user, token = '', ''
    for line in (proc.stdout or '').splitlines():
        if line.startswith('username='):
            user = line.split('=', 1)[1].strip()
        elif line.startswith('password='):
            token = line.split('=', 1)[1].strip()
    if not token:
        raise SystemExit('取不到 GitHub 令牌。请设 GH_TOKEN 环境变量，'
                         '或确认 Windows 凭据管理器里有 github.com 的凭据。')
    return (user or 'x-access-token'), token


def get_token():
    return get_credentials()[1]


# --------------------------------------------------------------------------
# GitHub REST API（只走直连，显式清空代理）
# --------------------------------------------------------------------------
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _maybe_json(text):
    try:
        return json.loads(text)
    except Exception:
        return text


def api(method, path, token, payload=None, tries=8):
    """打 api.github.com。返回 (status, body)。status==0 表示网络层失败。

    本机 Python 的 DNS 会间歇性抽风（getaddrinfo failed 11001），
    所以所有失败（含 status==0）都走指数退避重试 —— 重跑一遍就好了。
    """
    url = 'https://%s%s' % (API_HOST, path)
    headers = {'Authorization': 'Bearer %s' % token,
               'Accept': 'application/vnd.github+json',
               'User-Agent': UA}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    status, text = 0, ''
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            with _OPENER.open(request, timeout=45) as resp:
                text = resp.read().decode('utf-8', 'replace')
                status = resp.status
        except urllib.error.HTTPError as exc:
            text = exc.read().decode('utf-8', 'replace')
            status = exc.code
        except Exception as exc:                       # 网络抖动 / DNS 抽风
            text = '%s: %s' % (type(exc).__name__, exc)
            status = 0
        if status and status != 429 and status < 500:
            return status, _maybe_json(text)
        say('  %s %s 暂未成功（status=%s %s），第 %d/%d 次重试'
            % (method, path, status, str(text)[:100], attempt + 1, tries))
        time.sleep(min(2 ** attempt * 0.5, 8))
    return status, _maybe_json(text)


def upload_asset(repo, release_id, path, token, tries=6):
    """把文件传给 uploads.github.com，返回 (status, body)。

    三个必须遵守的细节：
      1. 端点严格是 uploads.github.com（打 api.github.com 的同名路径不会上传）
      2. **必须显式 Content-Length**，否则 http.client 走 chunked，GitHub 拒收
      3. body 传文件对象，别整个读进内存（分发包 59 MB）
    """
    name = os.path.basename(path)
    size = os.path.getsize(path)
    target = '/repos/%s/releases/%d/assets?%s' % (
        repo, release_id, urllib.parse.urlencode({'name': name}))

    status, text = 0, ''
    for attempt in range(tries):
        try:
            conn = http.client.HTTPSConnection(
                UPLOAD_HOST, timeout=1800, context=ssl.create_default_context())
            with open(path, 'rb') as fh:
                conn.request('POST', target, body=fh, headers={
                    'Authorization': 'Bearer %s' % token,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': str(size),
                    'User-Agent': UA})
            resp = conn.getresponse()
            text = resp.read().decode('utf-8', 'replace')
            status = resp.status
            conn.close()
        except Exception as exc:
            text = '%s: %s' % (type(exc).__name__, exc)
            status = 0
        if status == 201:
            return status, _maybe_json(text)
        say('  上传 %s 未成功（status=%s %s），第 %d/%d 次重试'
            % (name, status, str(text)[:100], attempt + 1, tries))
        time.sleep(min(2 ** attempt * 0.5, 8))
    return status, _maybe_json(text)


# --------------------------------------------------------------------------
# 各步骤
# --------------------------------------------------------------------------
def get_release_by_tag(repo, tag, token):
    status, body = api('GET', '/repos/%s/releases/tags/%s' % (repo, urllib.parse.quote(tag)), token)
    if status == 200 and isinstance(body, dict):
        return body
    if status == 404:
        return None
    raise SystemExit('查询 Release 失败：status=%s body=%s' % (status, str(body)[:200]))


def _peel_commit(out):
    """从 `git ls-remote refs/tags/x` 的输出里取出**提交** sha。

    注释 tag 会返回两行：tag 对象本身 + `<sha>^{}`（解引用后的提交）；轻量 tag
    只有一行，那行就是提交。要提交是为了和本地 tag 比对——本地是注释 tag、远端
    可能是 GitHub 自动建的轻量 tag，直接比对象 sha 会永远不相等。
    """
    fallback = ''
    for line in (out or '').splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        if parts[1].endswith('^{}'):
            return parts[0]
        fallback = fallback or parts[0]
    return fallback


def ensure_local_tag(tag, version, dry_run=False):
    """只在本地打注释 tag（已存在则复用），返回它指向的提交 sha。

    **不推远端**：推送挪到 push_tag()，必须是整个发布流程的最后一步。
    """
    code, out, _ = git('rev-parse', '--verify', 'refs/tags/%s^{commit}' % tag)
    if code == 0:
        say('本地已有 tag %s（%s），复用' % (tag, out[:12]))
        return out.strip()
    if dry_run:
        say('[dry-run] 将执行：git tag -a %s -m "..."' % tag)
    else:
        run(['git', 'tag', '-a', tag, '-m', '%s: %s' % (tag, version)])
    code, out, _ = git('rev-parse', '--verify', 'refs/tags/%s^{commit}' % tag)
    if code == 0:
        return out.strip()
    code, out, _ = git('rev-parse', 'HEAD')       # dry-run 下 tag 还没建
    return out.strip() if code == 0 else ''


def push_tag(tag, auth, dry_run=False):
    """把 tag 推到远端。**必须最后一步调用**，这是有原因的。

    推 tag 会触发 .github/workflows/release.yml 的 push 护栏，而护栏是靠「这个
    tag 的 Release 有没有附件」判断要不要跳过构建。所以只能在附件传完之后推：
    否则 CI 看到的还是「没发布」，会重建一遍，十几分钟后把本机刚传上去的产物
    覆盖成另一份（2026-10-11 实测到过这个覆盖，两条链路的产物并不逐字节一致）。

    另外，创建 Release 时 GitHub 会用 tag_name 自动建一个指向 target_commitish
    的轻量 tag，所以走到这里远端通常已经有同名 tag 了。只要它指向同一个提交，
    就直接跳过——不推也就不会触发 CI，连重复构建的机会都没有。
    """
    ref = 'refs/tags/%s' % tag
    net = git_net_args() + list(auth)
    code, out, _ = git('rev-parse', '--verify', '%s^{commit}' % ref)
    local_commit = out.strip() if code == 0 else ''

    for attempt in range(8):
        code, out, _ = git(*net, 'ls-remote', 'origin', ref)
        remote_commit = _peel_commit(out)
        if remote_commit:
            if local_commit and remote_commit == local_commit:
                say('远端 %s 已指向同一提交 %s（Release 创建时自动生成），不必再推'
                    % (ref, remote_commit[:12]))
                return remote_commit
            raise SystemExit(
                '远端 %s 指向 %s，本地指向 %s，两者不一致。'
                '先人工确认哪一份是对的（`git ls-remote origin %s`），脚本不擅自改写远端 tag。'
                % (ref, remote_commit[:12], (local_commit or '?')[:12], ref))
        if dry_run:
            say('[dry-run] 将执行：git push origin %s' % ref)
            return None
        code, out, err = git(*net, 'push', '--no-thin', 'origin', ref)
        if code == 0:
            say('已推送 %s' % ref)
        else:
            say('  推 tag 未成功（%s），第 %d/8 次重试' % (err[:120], attempt + 1))
        time.sleep(1)
    # 判定成功只看远端读回，不看 push 的退出码或回显——本机多次出现「回显成功但远端没变」
    code, out, _ = git(*net, 'ls-remote', 'origin', ref)
    if _peel_commit(out):
        return _peel_commit(out)
    raise SystemExit('标签 %s 没能推上远端。脚本是幂等的，检查网络后直接重跑。' % tag)


def build_release_body(version, assets, trigger):
    section = changelog_section(version)
    rows = '\n'.join('| `%s` | %s | `%s` |'
                     % (os.path.basename(p), human(os.path.getsize(p)), sha256(p))
                     for p in assets)
    tail = ('\n---\n\n'
            '**Windows x64 免安装版**：下载下面的 zip，解压后双击「启动待办清单.cmd」即可使用 —— '
            '包内已含 Node 与前端依赖，目标机不需要装 Node，也不需要装 Python。\n\n'
            '| 附件 | 大小 | sha256 |\n|---|---|---|\n%s\n\n'
            '> 发布方式：%s ｜ 版本源：`todolist-gui/package.json`\n' % (rows, trigger))
    return ((section + '\n') if section else '') + tail


def ensure_release(repo, tag, version, assets, token, args, trigger, commit=''):
    release = get_release_by_tag(repo, tag, token)
    payload = {
        'tag_name': tag,
        'name': '%s %s' % (APP_NAME, tag),
        'body': build_release_body(version, assets, trigger),
        'draft': bool(args.draft),
        'prerelease': bool(args.prerelease),
        'make_latest': 'false' if args.no_latest else 'true',
    }
    # 显式钉住 tag 落点。不传的话 GitHub 会拿**默认分支的当前 HEAD** 建 tag ——
    # 发布一个不是最新提交的版本时就会张冠李戴。tag 已存在时该字段被忽略，无害。
    if commit:
        payload['target_commitish'] = commit
    if release:
        say('Release %s 已存在（id=%s），更新说明并复用' % (tag, release['id']))
        if args.dry_run:
            return release
        status, body = api('PATCH', '/repos/%s/releases/%s' % (repo, release['id']), token, payload)
        if status not in (200, 201):
            raise SystemExit('更新 Release 失败：status=%s body=%s' % (status, str(body)[:300]))
        return body
    say('创建 Release %s（draft=%s）' % (tag, payload['draft']))
    if args.dry_run:
        return None
    status, body = api('POST', '/repos/%s/releases' % repo, token, payload)
    if status not in (200, 201):
        raise SystemExit('创建 Release 失败：status=%s body=%s' % (status, str(body)[:300]))
    return body


def publish_assets(repo, release, assets, token, dry_run=False):
    """同名附件先删后传 —— 保证重跑不会因为 GitHub 拒绝重名而失败。"""
    existing = {a['name']: a for a in (release.get('assets') or [])}
    uploaded = []
    for path in assets:
        name = os.path.basename(path)
        old = existing.get(name)
        if old:
            say('  附件 %s 已存在（id=%s），先删除' % (name, old['id']))
            if not dry_run:
                status, body = api('DELETE', '/repos/%s/releases/assets/%s' % (repo, old['id']), token)
                if status not in (204, 404):
                    raise SystemExit('删除旧附件失败：status=%s body=%s' % (status, str(body)[:200]))
        say('  上传 %s（%s）' % (name, human(os.path.getsize(path))))
        if dry_run:
            continue
        status, body = upload_asset(repo, release['id'], path, token)
        if status != 201:
            raise SystemExit('上传 %s 失败：status=%s body=%s' % (name, status, str(body)[:300]))
        uploaded.append(body)
    return uploaded


def verify_assets(repo, tag, assets, token):
    """服务端对账：用 GitHub 自己算的 size + digest，证明远端持有的正是本地这份文件。"""
    release = get_release_by_tag(repo, tag, token)
    if not release:
        raise SystemExit('对账失败：读不到 Release %s' % tag)
    remote = {a['name']: a for a in (release.get('assets') or [])}
    ok = True
    for path in assets:
        name = os.path.basename(path)
        local_sha = sha256(path)
        local_size = os.path.getsize(path)
        asset = remote.get(name)
        if not asset:
            say('  [FAIL] %s 不在 Release 里' % name)
            ok = False
            continue
        digest = (asset.get('digest') or '').replace('sha256:', '')
        size_ok = asset['size'] == local_size
        digest_ok = (digest == local_sha) if digest else None
        state_ok = asset.get('state') == 'uploaded'
        mark = 'PASS' if (size_ok and state_ok and digest_ok is not False) else 'FAIL'
        if mark == 'FAIL':
            ok = False
        say('  [%s] %-34s size=%s(%s) digest=%s state=%s'
            % (mark, name, asset['size'], 'ok' if size_ok else '不一致',
               (digest[:12] + '…') if digest else '（服务端未返回）', asset.get('state')))
        if digest_ok is None:
            say('       注意：GitHub 未返回 digest，仅用 size+state 判定')
    return ok


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='发布到 GitHub Releases（幂等）')
    parser.add_argument('--version', default=None, help='覆盖版本号（默认读 todolist-gui/package.json）')
    parser.add_argument('--tag', default=None, help='覆盖 tag 名（默认 v<version>）')
    parser.add_argument('--repo', default=None, help='owner/repo（默认从 origin 解析）')
    parser.add_argument('--asset', action='append', default=None,
                        help='要上传的文件，可重复；默认自动取 release/ 下的 zip 与 SHA256SUMS.txt')
    parser.add_argument('--notes', default=None, help='Release 说明里的额外前置文本')
    parser.add_argument('--skip-build', action='store_true', help='不重新打包')
    parser.add_argument('--skip-verify', action='store_true', help='不验包')
    parser.add_argument('--skip-tag', action='store_true', help='不打也不推 tag（CI 里用）')
    parser.add_argument('--no-push', action='store_true', help='只本地打 tag，不推远端')
    parser.add_argument('--draft', action='store_true', help='建草稿 Release')
    parser.add_argument('--prerelease', action='store_true', help='标记为预发布')
    parser.add_argument('--no-latest', action='store_true', help='不要设为 latest')
    parser.add_argument('--dry-run', action='store_true', help='只打印计划，不做任何写操作')
    parser.add_argument('--precheck', action='store_true',
                        help='只检查该 tag 的 Release 是否已存在，打印 STATE=published|missing')
    args = parser.parse_args()

    version = read_version(args.version)
    tag = args.tag or ('v%s' % version)
    repo = resolve_repo(args.repo)
    started = time.time()

    zip_name = '%s-v%s-win-x64.zip' % (APP_NAME, version)
    default_assets = [os.path.join(RELEASE, zip_name),
                      os.path.join(RELEASE, 'SHA256SUMS.txt')]
    assets = [os.path.abspath(p) for p in (args.asset or default_assets)]

    say('仓库：%s ｜ 版本：%s ｜ 标签：%s' % (repo, version, tag))

    if args.precheck:
        token = get_token()
        release = get_release_by_tag(repo, tag, token)
        names = sorted(a['name'] for a in (release or {}).get('assets') or [])
        if release and names:
            say('Release %s 已存在，附件：%s' % (tag, ', '.join(names)))
            print('STATE=published')
        else:
            say('Release %s 不存在或还没有附件' % tag)
            print('STATE=missing')
        return 0

    # 1) 打包
    if args.skip_build or args.dry_run:
        say('跳过打包（%s）' % ('--dry-run' if args.dry_run else '--skip-build'))
    else:
        run([sys.executable, os.path.join(SCRIPTS, 'build_exe.py')])

    missing = [p for p in assets if not os.path.isfile(p)]
    if missing:
        raise SystemExit('找不到产物：%s\n先跑一次 python scripts/build_exe.py。'
                         % '、'.join(missing))
    say('待发布附件：')
    for path in assets:
        say('  %-36s %10s  sha256=%s' % (os.path.basename(path), human(os.path.getsize(path)),
                                         sha256(path)[:16]))

    # 2) 验包
    if args.skip_verify:
        say('跳过验包（--skip-verify）')
    else:
        run([sys.executable, os.path.join(SCRIPTS, 'verify_release.py'),
             '--zip', os.path.join(RELEASE, zip_name)])

    user, token = get_credentials()

    # 3) tag —— 这里只是**本地**打 tag。推远端挪到第 7 步，顺序是这个脚本的关键，
    #    理由见 push_tag() 的注释（推早了会触发 CI 重建并覆盖本机产物）。
    auth = git_auth_args(user, token)
    commit = ''
    if args.skip_tag:
        say('跳过 tag（--skip-tag），假定远端已有 %s' % tag)
    else:
        commit = ensure_local_tag(tag, version, dry_run=args.dry_run)

    # 4) Release（可先建空 Release 再传附件）
    trigger = 'GitHub Actions' if os.environ.get('GITHUB_ACTIONS') == 'true' else '本机 scripts/release_github.py'
    release = ensure_release(repo, tag, version, assets, token, args, trigger, commit)

    # 5) 上传
    if args.dry_run:
        say('[dry-run] 将上传：%s' % '、'.join(os.path.basename(p) for p in assets))
        if args.skip_tag:
            say('[dry-run] 跳过 tag 推送')
        elif args.no_push:
            say('[dry-run] --no-push：不推 tag')
        else:
            say('[dry-run] 最后一步将执行：git push origin refs/tags/%s' % tag)
        return 0
    if release is None:
        raise SystemExit('Release 未能创建，中止。')
    say('上传附件到 Release id=%s' % release['id'])
    publish_assets(repo, release, assets, token, dry_run=False)

    # 6) 服务端对账
    say('服务端对账（用 GitHub 自己算的 size / digest）')
    if not verify_assets(repo, tag, assets, token):
        raise SystemExit('对账未通过：服务端持有的文件与本地不一致，请重跑（脚本幂等）。')

    # 7) 推 tag —— 必须是最后一步。推 tag 会唤醒 CI 的 push 护栏，而护栏靠
    #    「Release 里有没有附件」判断跳不跳过构建；到这一步附件已经就位且对过账，
    #    CI 才会正确地早退。详见 push_tag()。
    if args.skip_tag:
        say('--skip-tag：不推 tag')
    elif args.no_push:
        say('--no-push：不推 tag')
    else:
        pushed = push_tag(tag, auth, dry_run=args.dry_run)
        if pushed:
            say('远端 tag：%s' % pushed[:12])

    say('')
    say('==== 发布完成（%.1fs）====' % (time.time() - started))
    # 下载直链指向 zip（拿 --asset 覆盖附件时不能再写死默认名）
    link_name = next((os.path.basename(p) for p in assets if p.lower().endswith('.zip')),
                     os.path.basename(assets[0]) if assets else zip_name)
    say('Release 页面：https://github.com/%s/releases/tag/%s' % (repo, tag))
    say('下载直链　：https://github.com/%s/releases/download/%s/%s' % (repo, tag, link_name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
