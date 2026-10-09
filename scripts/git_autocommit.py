"""任务数据自动提交（git 版本化落地）。

方案文档 v2 的核心决策 D2 把「git 版本化 = 免费备份+历史」列为数据安全支柱，
本脚本让这条承诺真正生效：每次启动应用时在后台跑一次，把 todo.txt / done.txt /
backup/ 的变更提交成一次 commit。同一天内的多次误操作从此有历史可回溯
（每日备份的粒度是「天」，git 的粒度是「每次启动」，两者互补）。

设计约束：
  * 绝不阻塞、绝不弹窗——git 缺失、没有仓库、没有变更、身份没配置，一律静默退出。
  * 只 add 明确的数据路径（todo.txt / done.txt / backup/），不碰代码，
    代码变更由开发者自己提交。

由 launch_todolist.py 在服务就绪后以后台进程方式调用，也可手动运行：
  python scripts/git_autocommit.py
"""
import datetime
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATHS = ['todo.txt', 'done.txt', 'backup']

# 本脚本由 pythonw（无控制台）拉起：不带此标志时，每次 subprocess.run(['git',...])
# 都会让 Windows 给 git.exe 新分配一个控制台 → 用户每次启动都看到 cmd 闪黑窗。
CREATE_NO_WINDOW = 0x08000000 if os.name == 'nt' else 0


def _git(*args):
    """跑一条 git 命令，返回 CompletedProcess；git 不存在时返回 None。"""
    try:
        return subprocess.run(
            ['git', *args], cwd=HERE, capture_output=True, text=True,
            encoding='utf-8', errors='replace', check=False, timeout=30,
            creationflags=CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def main():
    probe = _git('rev-parse', '--is-inside-work-tree')
    if probe is None:
        return 0  # 没装 git：静默放弃，git 化是增强不是依赖
    if probe.stdout.strip() != 'true':
        return 0  # 还不是仓库：静默放弃

    _git('add', '--', *DATA_PATHS)
    # --quiet 模式下 diff --cached 有差异时退出码为 1
    diff = _git('diff', '--cached', '--quiet')
    if diff is None or diff.returncode == 0:
        return 0  # 没有数据变更

    stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    commit = _git('commit', '-m', 'auto: 任务数据更新 %s' % stamp)
    if commit is not None and commit.returncode != 0:
        # 常见原因：git 身份未配置。失败要留痕，但依然不弹窗。
        try:
            with open(os.path.join(HERE, '.todolist-launch.log'), 'a',
                      encoding='utf-8') as fh:
                fh.write('[autocommit] %s\n' % (commit.stderr or '').strip())
        except OSError:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
