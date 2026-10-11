# topydo 本地安装与配置指南

> **版本基准**：topydo **0.16**（PyPI 发布 2026-02-12，GPL-3.0，仓库 topydo/topydo）
> **实测环境**：Windows 10 + Python 3.13.14，2026-09-28 全流程实测通过（含 pip 安装、源码构建、三种 UI 启动、配置生效验证）
> 本文所有"实测输出"均为本机真实执行结果，非文档摘抄。

---

## 1. 系统与依赖要求

| 项目 | 要求 | 说明 |
|---|---|---|
| 操作系统 | Linux / macOS / Windows | CLI 完整可用；column UI 官方文档称不支持 Windows，但 urwid ≥ 2.4 实测可用（见 §7.4） |
| Python | **≥ 3.9** | 官方 CI 矩阵 3.9 / 3.10 / 3.11 / 3.12 / 3.13 / 3.14；本机 3.13.14 实测通过。**不支持 Python 2**（0.10 起为 Python 3 only） |
| 硬依赖（必装） | `arrow >= 0.7.0` | 实测装上 arrow 1.4.0，连带 `python-dateutil` / `six` / `tzdata` |
| Windows 专有依赖 | `colorama >= 0.2.5` | 环境标记 `sys_platform == "win32"`，**pip 自动安装**，实测装上 colorama 0.4.6 |
| 可选依赖 `prompt` | `prompt_toolkit >= 0.53`、`watchdog >= 0.8.3` | prompt 交互模式用；实测 3.0.53 + 6.0.0 |
| 可选依赖 `columns` | `urwid >= 1.3.0`、`watchdog >= 0.8.3` | 列式 TUI 用；实测 urwid 4.1.7 |
| 可选依赖 `ical` | `icalendar` | 导出 iCalendar 用 |
| 编译需求 | **无** | 纯 Python，发布物是 `topydo-0.16-py3-none-any.whl`（约 149 KB），无 C 扩展、无需 MSVC/Build Tools |
| 磁盘占用 | 包体 ~1.5 MB + 依赖 ~10 MB | 单 venv 约 25 MB |
| 权限 | **不需要管理员** | 装进 venv 或 `pip install --user` 均可 |

**topydo 是什么**：基于 todo.txt 纯文本格式的任务管理器，提供三种界面 —— CLI（`topydo ls/add/do...`）、prompt 交互模式（`topydo prompt`）、columns 列式 TUI（`topydo columns`）。

---

## 2. 安装方式对比：选哪条路

| 方式 | 命令要点 | 适用场景 | 评价 |
|---|---|---|---|
| **① venv + pip**（推荐） | `python -m venv .venv && .venv/Scripts/pip install "topydo[prompt]"` | 想固定版本、不污染系统 Python | 最可控，本文主线 |
| ② pipx | `pipx install "topydo[prompt]"` | 想要一个全局可用的 `topydo` 命令且与项目隔离 | 体验最好，但本机**未预装 pipx**，需先装 |
| ③ 源码安装 | `git clone` 后 `pip install ".[prompt]"` | 要改代码 / 跟 master / 用 -e 开发 | 需要 git；实测 PEP 517 构建通过 |
| ④ 系统包管理器 | macOS `brew`、Arch `AUR` 等第三方配方 | 桌面平台图省事 | 版本可能落后，**Windows 无官方安装包**（issue #187 "standalone binary" 未实现） |
| ❌ 直接 `pip install topydo` 进系统 Python | — | — | 会污染系统环境、易触发版本冲突，不建议 |

---

## 3. 推荐路线：venv + pip 完整步骤（Windows）

### 步骤 1 · 确认 Python 版本

```bash
python -V                 # 需要 >= 3.9，本机实测 Python 3.13.14
py -0p                    # Windows：列出本机所有已安装的 Python 版本（可选）
where python              # 确认当前解析到哪个解释器
```

若 `python` 指向 Microsoft Store 的占位程序，请改用 `py -3.13 -m venv ...` 形式。

### 步骤 2 · 建独立虚拟环境

```bash
cd C:/Users/王佐成/WorkBuddy/todolist
python -m venv .venv-topydo
.venv-topydo/Scripts/python.exe -V        # 确认环境可用
```

> 用绝对路径的 Windows 程序时，Git Bash 下把 `\` 写 `/` 即可，例如 `.venv-topydo/Scripts/python.exe`。

### 步骤 3 · 升级 pip 并安装 topydo

```bash
# 3.1 升级 pip（避免旧 pip 解析 extras 出错）
.venv-topydo/Scripts/python.exe -m pip install --upgrade pip

# 3.2 只要 CLI（最省依赖）
.venv-topydo/Scripts/python.exe -m pip install topydo

# 3.3 CLI + prompt 交互模式（推荐）
.venv-topydo/Scripts/python.exe -m pip install "topydo[prompt]"

# 3.4 全套：CLI + prompt + 列式 TUI + iCal 导出
.venv-topydo/Scripts/python.exe -m pip install "topydo[prompt,columns,ical]"
```

**⚠️ 中括号必须加引号**：`topydo[prompt]` 里的 `[]` 在 zsh 下是通配符，不加引号会报 `zsh: no matches found: topydo[prompt]`（对应官方 issue #296）。bash/PowerShell 通常没事，但统一加引号最保险。

**实测输出（本机 pypi.org 源）**：

```
Successfully installed arrow-1.4.0 colorama-0.4.6 prompt_toolkit-3.0.53
  python-dateutil-2.9.0.post0 six-1.17.0 topydo-0.16 tzdata-2026.4
  watchdog-6.0.0 wcwidth-0.9.1
```

### 步骤 4 · 让 `topydo` 命令可用

任选其一：

```bash
# A. 直接用绝对路径（最稳，本文后续示例用这种）
C:/Users/王佐成/WorkBuddy/todolist/.venv-topydo/Scripts/topydo.exe -v

# B. 临时加入当前会话 PATH
export PATH="$PWD/.venv-topydo/Scripts:$PATH"

# C. 永久加入用户 PATH（PowerShell）
# [Environment]::SetEnvironmentVariable("Path",
#   [Environment]::GetEnvironmentVariable("Path","User") + ";C:\Users\王佐成\WorkBuddy\todolist\.venv-topydo\Scripts",
#   "User")
```

> 注意：本机有强沙箱，`setx` / `reg` / `cmd` 类命令可能被拦截，优先用 B 方案或直接在脚本里写绝对路径。

### 步骤 5 · 冒烟验证

```bash
.venv-topydo/Scripts/topydo.exe -v      # 期望输出 topydo 0.16
```

也可以走模块方式（**实测同样可用**）：

```bash
.venv-topydo/Scripts/python.exe -m topydo -v
```

---

## 4. 备选路线

### 4.1 pipx（想要一个干净的全局命令）

```bash
python -m pip install --user pipx
python -m pipx ensurepath
pipx install "topydo[prompt]"          # 或 "topydo[prompt,columns]"
pipx upgrade topydo                    # 升级
pipx uninstall topydo                  # 卸载（连同隔离环境一起删掉）
```

本机实测：`python -m pipx --version` → `No module named pipx`，即**需要先装 pipx**。

### 4.2 源码安装（跟 master / 改代码）

```bash
git clone https://github.com/topydo/topydo.git
cd topydo
python -m pip install ".[prompt]"       # 常规安装
python -m pip install -e ".[prompt]"    # 可编辑模式，方便调试
```

实测：用 PyPI 上的 sdist（`topydo-0.16.tar.gz`，128 KB）走 `pyproject.toml` → setuptools 的 PEP 517 构建，输出：

```
Building wheel for topydo (pyproject.toml): finished with status 'done'
Created wheel for topydo: filename=topydo-0.16-py3-none-any.whl
Successfully installed ... topydo-0.16
```

构建依赖仅 `setuptools` + `wheel`，pip 会自动放进构建隔离环境，无需手动装。

### 4.3 国内镜像的坑（本机实测）

- 清华镜像页面**确实收录了** `topydo-0.16-py3-none-any.whl`（`https://pypi.tuna.tsinghua.edu.cn/simple/topydo/` 返回 200 且含 0.16）；
- 但在本机（带 HTTP 代理）的环境里执行默认源安装时，pip 报：

```
Looking in indexes: https://pypi.tuna.tsinghua.edu.cn/simple
ERROR: Could not find a version that satisfies the requirement topydo[prompt] (from versions: none)
ERROR: No matching distribution found for topydo[prompt]
```

**解决**：显式指定官方源（或换阿里云源）：

```bash
python -m pip install -i https://pypi.org/simple \
  --trusted-host pypi.org --trusted-host files.pythonhosted.org \
  "topydo[prompt]"
```

或一次性改配置：

```bash
python -m pip config set global.index-url https://pypi.org/simple
python -m pip config list          # 查看当前源
```

---

## 5. 配置

### 5.1 配置文件查找顺序（**后者覆盖前者**）

```
1. /etc/topydo.conf
2. ~/.config/topydo/config
3. ~/.topydo
4. ./.topydo
5. ./topydo.conf
6. ./topydo.ini
```

Windows 下 `~` 展开为 `C:\Users\王佐成`（实测 `os.path.expanduser('~/.topydo')` → `C:\Users\王佐成/.topydo`），所以**个人配置文件就是 `C:\Users\王佐成\.topydo`**。

> 常见"配置不生效"来源：当前目录里存在 `topydo.conf` / `topydo.ini`，
> 它比你的 `~/.topydo` 优先级更高，把配置盖掉了。用 `-c` 显式指定可排除干扰。

**优先级（高 → 低）**：命令行参数 `-c/-t/-d/-C` → 环境变量 `TOPYDO_EDITOR` → 配置文件 → 内置默认值

### 5.2 todo.txt 放在哪

默认 `filename = todo.txt`（相对路径 → **相对当前工作目录**），归档文件 `done.txt`。

要固定位置就用绝对路径（反斜杠 / 正斜杠**实测都可用**，`%` 无需转义）：

```ini
[topydo]
filename = C:/todo/todo.txt
archive_filename = C:/todo/done.txt
```

启动时临时换文件：

```bash
topydo -t other.txt ls          # 用另一个 todo 文件（实测生效）
topydo -d other-done.txt do 1   # 用另一个归档文件
topydo -c my.conf ls            # 用指定配置文件（实测生效）
```

### 5.3 可直接使用的 `~/.topydo` 样例（Windows 版）

```ini
[topydo]
default_command        = ls
filename               = C:/todo/todo.txt
archive_filename       = C:/todo/done.txt
colors                 = auto          ; 0 关闭 / 1 / 16 / 256 / auto
identifiers            = linenumber    ; 或 text（文本型 ID，更稳定）
identifier_alphabet    = 0123456789abcdefghijklmnopqrstuvwxyz
backup_count           = 5
auto_delete_whitespace = 1

[add]
auto_creation_date     = 1

[ls]
hide_tags              = id,p,ical
hidden_item_tags       = h,hide
indent                 = 0
list_limit             = -1
list_format            = |%I| %x %{(}p{)} %c %s %k %{due:}d %{t:}t

[tags]
tag_start              = t
tag_due                = due
tag_star               = star

[sort]
keep_sorted            = 0
sort_string            = desc:completed,desc:importance,due,desc:priority
ignore_weekends        = 1

[edit]
editor                 = code -w        ; Windows 必改，见 §5.5

[colorscheme]
project_color          = red
context_color          = magenta
metadata_color         = green
link_color             = cyan
priority_colors        = A:cyan,B:yellow,C:blue
focus_background_color = gray
marked_background_color = blue

[aliases]
showall                = ls -x
next                   = ls -n 1
```

### 5.4 全量默认值（来自 0.16 源码 `topydo/lib/Config.py`）

| 段 | 选项 | 默认值 |
|---|---|---|
| `[topydo]` | `default_command` | `ls` |
| | `colors` | `auto` |
| | `force_colors` | `0` |
| | `filename` | `todo.txt` |
| | `archive_filename` | `done.txt` |
| | `identifiers` | `linenumber` |
| | `identifier_alphabet` | `0123456789abcdefghijklmnopqrstuvwxyz` |
| | `backup_count` | `5` |
| | `auto_delete_whitespace` | `1` |
| `[add]` | `auto_creation_date` | `1` |
| `[ls]` | `hide_tags` | `id,p,ical` |
| | `hidden_item_tags` | `h,hide` |
| | `indent` | `0` |
| | `list_limit` | `-1` |
| | `list_format` | `\|%I\| %x %{(}p{)} %c %s %k %{due:}d %{t:}t` |
| `[tags]` | `tag_start` / `tag_due` / `tag_star` | `t` / `due` / `star` |
| `[sort]` | `keep_sorted` | `0` |
| | `sort_string` | `desc:completed,desc:importance,due,desc:priority` |
| | `group_string` | （空） |
| | `ignore_weekends` | `1` |
| `[dep]` | `append_parent_projects` / `append_parent_contexts` | `0` / `0` |
| `[colorscheme]` | `project_color` / `context_color` / `metadata_color` / `link_color` | `red` / `magenta` / `green` / `cyan` |
| | `priority_colors` | `A:cyan,B:yellow,C:blue` |
| | `focus_background_color` / `marked_background_color` | `gray` / `blue` |
| `[aliases]` | `lsproj`/`listprj`/`listproj`/`listproject`/`listprojects` | 均指向 `lsprj` |
| | `listcon`/`listcontext`/`listcontexts` | 均指向 `lscon` |
| `[columns]` | `column_width` | `40` |

> ⚠️ **实测发现**：`default_command` 只能填**裸命令名**，带参数会失效。
> `default_command = ls` → 裸执行 `topydo` 正常列出任务；写成 `default_command = ls -x` → 裸执行 `topydo` 变成打印 usage。

### 5.5 编辑器设置（Windows 上必改）

默认编辑器是 `vi`，Windows 上不存在，`topydo edit` 会直接失败（官方 issue #120 至今 open）。

解析顺序：`TOPYDO_EDITOR` 环境变量 → `[edit] editor` 配置 → `EDITOR` 环境变量 → `vi`

```ini
[edit]
editor = code -w            ; VS Code（-w 表示等待文件关闭）
; editor = notepad++ -multiInst -nosession
; editor = notepad          ; 能开，但不识别 LF 换行，慎用
```

临时覆盖：

```bash
topydo edit -E "notepad++" 1
export TOPYDO_EDITOR="code -w"    # 环境变量优先级最高
```

### 5.6 备份与回滚

每次写操作前 topydo 会做一份备份，命名规则为**`.原文件名.bak`**（实测：`todo.txt` → `.todo.bak`；`sub-tasks.txt` → `.sub-tasks.bak`），数量由 `backup_count` 控制（默认 5）。

```bash
topydo revert ls        # 列出备份（实测输出形如：1| 2026-09-28 15:16:40 | do 1）
topydo revert 2         # 回滚到第 2 号备份
```

---

## 6. 安装后验证（4 步 checklist）

```bash
# 1) 版本与许可证信息
topydo -v
# 期望：topydo 0.16 + Copyright (C) 2014-2017 Bram Schoenmakers + GPLv3

# 2) 帮助文本（含全部子命令）
topydo -h
# 期望：Synopsis 行 + add/append/del/dep/depri/do/edit/ls/listcon/listprojects/
#       modify/postpone/pri/revert/sort/tag

# 3) 在专用目录里做增删改查（避免污染你的正式 todo.txt）
mkdir -p /tmp/topydo-check && cd /tmp/topydo-check
topydo add "(B) 写第 10 周回测报告 due:2026-10-05"
topydo add "(A) 校验主力吸筹信号"
topydo ls
# 实测输出：
# |  1| (B) 2026-09-28 写第 10 周回测报告 due:2026-10-05
# |  2| (A) 2026-09-28 校验主力吸筹信号

# 4) 完成一项 → 自动归档到 done.txt
topydo do 1
topydo ls -x
cat todo.txt done.txt
```

**期望的文件副作用**（实测）：目录中生成 `todo.txt`、`done.txt`（完成项被追加进来）、`.todo.bak`（备份）。

**额外验证三种 UI 是否可用**：

```bash
topydo prompt      # 交互模式（需真实终端，见 §7.3）
topydo columns     # 列式 TUI（Windows 见 §7.4）
topydo ls 2>/dev/null | head    # 非 TTY 时自动剥离 ANSI 颜色
```

`-v` 输出版本号即视为安装成功；`add`/`ls`/`do` 三步跑通即视为功能正常。

---

## 7. 常见问题与解决

### 7.1 `pip install topydo` 报 `No matching distribution found ... (from versions: none)`

- **原因**：当前 pip 源（实测为清华源 + 本机代理组合）没有把该包/该版本喂给 pip；不是包名写错。
- **排查**：`python -m pip config list` 看当前 index-url。
- **解决**：`-i https://pypi.org/simple --trusted-host pypi.org --trusted-host files.pythonhosted.org`，或 `pip config set global.index-url https://pypi.org/simple`。

### 7.2 `zsh: no matches found: topydo[prompt]`

- **原因**：zsh / 部分 shell 把 `[]` 当通配符（issue #296）。
- **解决**：加引号 —— `pip install "topydo[prompt]"`。

### 7.3 `topydo prompt` 报 `NoConsoleScreenBufferError: No Windows console found. Are you running cmd.exe?`

完整报错（本机实测，管道/重定向场景）：

```
File "...\prompt_toolkit\output\win32.py", line 220, in get_win32_screen_buffer_info
    raise NoConsoleScreenBufferError
prompt_toolkit.output.win32.NoConsoleScreenBufferError: No Windows console found. Are you running cmd.exe?
```

- **原因**：prompt 模式依赖 prompt_toolkit 的 Win32 控制台输出层，要求进程挂在**真实的 Windows 控制台**上。Git Bash / mintty / MSYS2 终端、管道重定向（`| tee`、`> log`）、被 IDE 捕获输出的终端都不满足。
- **解决**：
  1. 在 **Windows Terminal / cmd.exe / PowerShell** 里跑 `topydo prompt`；
  2. 不要重定向 stdout；
  3. 只要在 Git Bash 里用，就改用 CLI 模式（`topydo add/ls/...` 在 Git Bash 下**实测完全正常**），别用 prompt 模式。

### 7.4 `topydo columns` 相关

- **老说法**：官方文档写"Windows 原生不支持 column mode，请用 Cygwin"，老 urwid 上报 `No module named 'fcntl'`，`UILoader` 里也有 `error("Column mode is not supported on Windows.")` 分支。
- **实测结论（2026-09）**：urwid 从 **2.4.0** 起加入了 Windows RAW/Curses 显示支持（issue #328 报告者在 urwid 2.6.16 上跑通）。本机实测装 `urwid` 4.1.7 后：
  - `import topydo.ui.columns.Main` → OK；
  - `topydo columns` 启动后持续运行、未崩溃（15 秒计时上限到达才结束）。
- **仍可能踩的坑**：中文/宽字符错位 → 在终端先执行 `chcp 65001`（Windows Terminal 可设为系统级 UTF-8），并使用等宽 UTF-8 字体（如 DejaVu Sans Mono / Cascadia Mono）；
- 若坚持稳定性优先，可 `pip install urwid==2.6.16` 复现官方 issue 的可用组合。
- 实在不行就退回 CLI + prompt，功能完整度不受影响。

### 7.5 `topydo ls` 输出为空，但 todo.txt 里明明有任务

- **原因**：topydo 有"相关性"过滤。带 `t:`（开始日期）且日期未到的任务、带 `h:`/`hide` 标记的任务默认不显示。
- **实测**：任务 `(A) 2026-09-28 校验主力吸筹信号 t:2026-09-29`（今天 09-28）→ `topydo ls` 空，`topydo ls -x` 显示。
- **解决**：`topydo ls -x` 看全部；或调 `[ls] hidden_item_tags`。

### 7.6 中文任务乱码 / 输出夹杂奇怪符号

- **原因**：Windows 控制台默认代码页不是 UTF-8。
- **解决**：`chcp 65001`（或在 Windows Terminal 里把默认编码设为 UTF-8），并设置 `export PYTHONIOENCODING=utf-8`；使用支持 UTF-8 的等宽字体。

### 7.7 `topydo edit` 报找不到编辑器 / 打开了乱码文件

- 默认 `vi` 在 Windows 不存在 → 配 `[edit] editor`（§5.5）；`notepad` 不认 LF 换行，优先用 VS Code / Notepad++。
- 保证编辑器命令能阻塞等待：VS Code 用 `code -w`。

### 7.8 命令找不到：`topydo: command not found`

- **原因**：venv 的 `Scripts` 目录没进 PATH。
- **解决**：用绝对路径 `...\.venv-topydo\Scripts\topydo.exe`，或按 §3 步骤 4 加入 PATH；也可用 `python -m topydo`（实测可用）。

### 7.9 提示 "Some additional dependencies for prompt mode were not installed"

- **原因**：只装了基础包，缺 `prompt_toolkit` / `watchdog`。
- **解决**：`pip install "topydo[prompt]"`；columns 同理用 `"topydo[columns]"`。

### 7.10 改完配置没生效

- **原因**：同目录的 `topydo.conf` / `topydo.ini` / `./.topydo` 优先级高于 `~/.topydo`；或同时用了 `-c`（`-c` 会**只**读该文件，忽略其它配置源）。
- **解决**：`topydo -c 你的绝对路径/.topydo ls` 自证；用 `python -m pip show topydo` 无关，重点是清理目录内同名配置。

---

## 8. 升级与卸载

```bash
# 升级
.venv-topydo/Scripts/python.exe -m pip install --upgrade "topydo[prompt]"
pipx upgrade topydo                       # pipx 安装的

# 查看装了哪些依赖/版本
.venv-topydo/Scripts/python.exe -m pip show topydo
.venv-topydo/Scripts/python.exe -m pip list

# 卸载（venv 方案：直接删目录更干净）
rm -rf .venv-topydo

# pipx 方案
pipx uninstall topydo
```

> 卸载**不会**删除 `~/.topydo` 和你的 `todo.txt` / `done.txt` / `.todo.bak`，数据是纯文本，随时可迁走或交给其它 todo.txt 工具处理。

---

## 9. 附：本文实测环境与关键结论速查

| 项 | 值 |
|---|---|
| 系统 / Python | Windows 10 · Python 3.13.14 |
| topydo | 0.16（wheel 149 KB / sdist 128 KB） |
| 依赖实测版本 | arrow 1.4.0、colorama 0.4.6、prompt_toolkit 3.0.53、python-dateutil 2.9.0.post0、six 1.17.0、tzdata 2026.4、watchdog 6.0.0、wcwidth 0.9.1、urwid 4.1.7（单独装） |
| 已验证 OK | pip 装 wheel、从 sdist 走 PEP 517 构建、`-v`、`-h`、`add/ls/do`、`-t`、`-c`、`revert ls`、`python -m topydo`、目录内 `topydo.conf` 生效、`~/.topydo` 路径展开、反斜杠/正斜杠绝对路径、`columns` 启动不崩 |
| 已验证受限 | `prompt` 模式需真实 Windows 控制台（Git Bash / 重定向会抛 `NoConsoleScreenBufferError`）；`default_command` 不能带参数 |
| 官方资源 | 仓库 github.com/topydo/topydo · 文档 topydo.org（TiddlyWiki）· PyPI pypi.org/project/topydo |

---

## 10. 本机实际安装记录（2026-09-30 已完成）

本节记录**本机真实落地**的安装结果，与上面的通用步骤对应。

| 项目 | 实际位置 / 值 |
|---|---|
| 虚拟环境 | `C:\Users\王佐成\WorkBuddy\todolist\.venv-topydo`（Python 3.13.14） |
| 安装内容 | topydo 0.16 + `prompt` + `columns` extras |
| 依赖版本 | arrow 1.4.0 · colorama 0.4.6 · prompt_toolkit 3.0.53 · urwid 4.2.2 · watchdog 6.0.0 · python-dateutil 2.9.0.post0 · six 1.17.0 · tzdata 2026.4 · wcwidth 0.9.1 · typing_extensions 4.16.0 |
| 全局命令 | `C:\Users\王佐成\bin\topydo.cmd`（cmd / PowerShell）、`C:\Users\王佐成\bin\topydo`（Git Bash） |
| 配置文件 | `C:\Users\王佐成\.topydo` |
| 数据文件 | `C:\Users\王佐成\WorkBuddy\todolist\todo.txt`、`done.txt`（配置里写的是绝对路径，因此在任意目录执行都指向同一份清单） |
| 编辑器 | VS Code：`"C:/Users/王佐成/AppData/Local/Programs/Microsoft VS Code/Code.exe" -w` |

**关于全局命令**：在 `C:\Users\王佐成\bin` 放了两个转发脚本指向 venv 里的 `topydo.exe`，并把该目录**追加**到了用户级 PATH（`HKCU\Environment\Path`，原值已备份到 `scripts/path_backup.txt`）。

> ⚠️ **踩坑记录**：起初以为 `C:\Users\王佐成\bin` 已在 PATH 中（当前会话的 PATH 里确实有它），但读注册表发现那只是会话级注入 —— **持久化的用户 PATH 里并没有这一条**，自己新开终端会报"不是内部或外部命令"。已追加补齐，写入时保留了原有的 `REG_EXPAND_SZ` 类型，确保 `%USERPROFILE%` 之类的变量仍能正常展开。

两个 shim 内容全部是纯 ASCII（用 `%USERPROFILE%` / `$HOME` 展开真实 exe 路径），避免 cmd.exe 按 OEM 代码页读取含中文路径的 `.cmd` 时乱码。

**PATH 生效时机**：环境变量修改对**已打开**的终端无效，需要新开一个终端窗口（或重启终端程序）。

**验证过的方式**（模拟新终端，用注册表里的机器级 + 用户级 PATH 重新解析）：

```
shutil.which('topydo')  →  C:\Users\王佐成\bin\topydo.CMD
执行 topydo -v          →  topydo 0.16
```

**已验证通过的项目**：`topydo -v` / `-h` / `add` / `ls` / `del`（含中文任务文本）、从非工作区目录执行（`which topydo` → `/c/Users/王佐成/bin/topydo`）、`topydo.cmd` 通道、配置文件解析（`config().editor()` 正确返回 VS Code 命令）、三种 UI 模块（CLI / prompt / columns）全部可导入。

**日常用法**：

```bash
topydo add "(A) 写第 10 周回测报告 due:2026-10-05"   # 加任务，due: 截止日期
topydo add "校验主力吸筹信号 t:2026-10-01"           # t: 开始日期（未到日期前 ls 不显示，用 ls -x 看全部）
topydo ls                 # 看清单（默认格式：|ID| 完成标记 (优先级) 创建日期 内容 标签）
topydo ls -x              # 看全部，含未到开始日期 / 被隐藏标记的条目
topydo do 1               # 完成第 1 条 → 自动归档进 done.txt
topydo pri 2 A            # 把第 2 条设为 A 优先级
topydo dep 2 before 1     # 设置依赖关系
topydo postpone 1 3       # 顺延 3 天
topydo edit 1             # 用 VS Code 打开该条编辑
topydo revert ls / revert 3   # 查看备份 / 回滚到第 3 号备份
topydo prompt             # 交互模式（必须在 Windows Terminal / cmd / PowerShell 里跑）
topydo columns            # 列式 TUI（同上，建议先 chcp 65001）
topydo help <子命令>      # 查看某子命令用法
```

**卸载（完全还原，共 7 处）**：

```bash
rm -rf "C:/Users/王佐成/WorkBuddy/todolist/.venv-topydo"
rm -f  "C:/Users/王佐成/bin/topydo" "C:/Users/王佐成/bin/topydo.cmd"
rm -f  "C:/Users/王佐成/.topydo" "C:/Users/王佐成/.topydo_columns"
rm -f  "C:/Users/王佐成/Desktop/topydo 启动器.bat"
# 从用户 PATH 中移除 C:\Users\王佐成\bin（原值见 scripts/path_backup.txt）
#   PowerShell: [Environment]::SetEnvironmentVariable("Path", "<path_backup.txt 里的原始值>", "User")
# todo.txt / done.txt 是你的数据，按需保留或删除：
# rm -f "C:/Users/王佐成/WorkBuddy/todolist/todo.txt" "C:/Users/王佐成/WorkBuddy/todolist/done.txt"
```

---

## 11. 桌面一键启动器

`C:\Users\王佐成\Desktop\topydo 启动器.bat`（1.3 KB，双击即用）

双击后显示菜单，输入序号回车：

```
  ==============================================
    topydo 0.16  -  todo.txt 任务清单
  ==============================================

    [1] 交互模式 prompt   (推荐: 连续敲命令, 输入 exit 退出)
    [2] 查看清单 ls
    [3] 列式界面 columns  (vim 式按键, :q 退出)
    [4] 退出

  请输入序号后回车 [默认 1]:
```

**实现要点**（自己改的话别踩这些坑）：

| 做法 | 原因 |
|---|---|
| 开头 `chcp 65001 >nul 2>&1` | 保证中文提示 / 中文任务文本不乱码 |
| 路径一律用 `%USERPROFILE%` 展开 | 批处理内容保持纯 ASCII，不担心 cmd 按 OEM 代码页读文件 |
| 先 `if not exist` 检测再执行 | 卸载后双击不会一闪而过，而是给出明确提示 |
| 退出后 `pause >nul` | 双击运行时窗口不会瞬间关闭 |
| 用 `goto` 分支而非 `if(...)` 块 | 避开括号块内 `(` `)` 与中文标点的转义问题 |
| 调外部命令统一用 `call` | 否则执行完 `topydo.cmd` 后不回到本脚本 |

**已验证**：`[2]` 能正确列出任务（含中文与 `due:` 标签）；`[3]` 能拉起列式 TUI 并保持运行；`[4]` 与无效输入均正常退出、无报错。

> 注：直接双击是唯一可靠的运行方式 —— 若从 Git Bash 里 `cat`/管道方式调它，输出会被 cmd 的管道处理干扰（可能看到 `The syntax of the command is incorrect.`），那是调用方式的问题，不是脚本问题。

**想改成"双击直接进 prompt 模式、不显示菜单"**：把 `set /p` 那几行和 `if "%choice%"...` 判断删掉，只留 `:prompt` 段即可；重新生成可跑 `scripts/make_desktop_launcher.py`（改脚本里的 `LINES` 后重跑）。

---

## 12. 三种界面：到底哪种算"交互界面"

topydo **没有图形界面（GUI）**，它提供的三种界面都在终端里，但 `columns` 是货真价实的交互式界面 —— 不是"敲一条看一条"。

| 界面 | 启动 | 交互方式 | 终端要求 |
|---|---|---|---|
| CLI | `topydo ls/add/do…` | 一行一条命令，执行完就返回 | 任何终端（含 Git Bash） |
| prompt | `topydo prompt` | `topydo>` 提示符下连续敲命令 + Tab 补全 | 需真实 Windows 控制台 |
| **columns** | `topydo columns` | **分栏浏览、方向键/hjkl 移动、单键操作（x 完成 / e 编辑 / m 标记）、鼠标滚轮与点选、`:` 进入命令行、`:q` 退出** | 需真实 Windows 控制台 |

### 12.1 columns 分栏配置（本机已配好）

关键点：`topydo columns` **默认没有任何分栏**（启动后是空界面），必须自己写分栏配置。本机已生成 `C:\Users\王佐成\.topydo_columns`：

```ini
[all]
title      = 全部任务
filterexpr =
groupexpr  = due          ; 按截止日期分组

[today]
title      = 今天到期
filterexpr = due:tod

[overdue]
title      = 逾期
filterexpr = due:<tod
sortexpr   = desc:due

[starred]
title      = 星标
filterexpr = star:1
```

分栏配置文件查找顺序：`topydo_columns.ini` → `topydo_columns.conf` → `./.topydo_columns` → `~/.topydo_columns` → `~/.config/topydo/columns` → `/etc/topydo_columns.conf`

每段字段：`title`（列标题）、`filterexpr`（过滤表达式）、`sortexpr`（排序）、`groupexpr`（分组）、`show_all`（等同 `ls -x`）。

### 12.2 过滤表达式（全部实测过的写法）

| 表达式 | 含义 | 实测结果 |
|---|---|---|
| `due:tod` | 今天到期 | ✅ 只命中今天到期项 |
| `due:<tod` | 逾期 | ✅ 只命中逾期项 |
| `due:>tod` | 未来到期 | ✅ |
| `star:1` | 星标任务 | ✅ |
| `+项目名` | 含某项目标签 | ✅ 如 `+回测` |

> ⚠️ 相对日期写法 `due:<tod+7d` 实测**无效**（返回空），别照抄网上例子。

### 12.3 试玩用的示例清单

`scripts/示例任务-试玩用.txt`（6 条覆盖逾期/今天/项目/星标/未开始/普通），不动你的正式清单即可试各种过滤：

```bash
topydo -t "scripts/示例任务-试玩用.txt" ls        # 相关性过滤后
topydo -t "scripts/示例任务-试玩用.txt" ls -x     # 全部
topydo -t "scripts/示例任务-试玩用.txt" ls "star:1"
```

### 12.4 想要真正的窗口（GUI）

topydo 官方不提供，但有同格式的第三方客户端 —— **todo.txt 是纯文本，同一份文件可以换着用**，数据不吃亏。以下维护状态为 2026-09-30 实测查询 GitHub API 的结果：

| 客户端 | 平台 | Star | 最近提交 | 说明 |
|---|---|---|---|---|
| **sleek** | Win/macOS/Linux | 2039 | 2026-09-15 | Electron，当前最活跃，功能最全（暗色模式、循环任务、过滤侧栏、归档） |
| todotxt.net | Windows | 529 | 2025-10-15 | C#/.NET，单文件极小、全键盘操作，但基本处于维护状态 |
| QTodoTxt2 | Win/Linux | 186 | 2025-10-18 | Qt/QML + Python，仍在更新 |
| Todour | Win/macOS | 144 | 2025-12-14 | Qt，简洁 |

对应仓库：`ransome1/sleek`、`benrhughes/todotxt.net`、`QTodoTxt/QTodoTxt2`、`SverrirValgeirsson/Todour`。

**使用注意**：GUI 客户端要让它的 todo.txt 指向 `C:\Users\王佐成\WorkBuddy\todolist\todo.txt`（或把清单搬到你更习惯的目录，然后同步改 `~/.topydo` 与 GUI 设置）。topydo 特有的 `t:`（开始日期）、`dep`（依赖）等标签，部分客户端不识别但会原样保留，不会损坏数据。
