# 分支推送说明：`workbuddy/main-d29003f7` → GitHub `tauri-v1.0.1`

- 日期：2026-10-11
- 仓库：<https://github.com/Woodeline/Worktodolist>（public，默认分支 `main`，未改动）
- 源：本地分支 `workbuddy/main-d29003f7`
- 目标：远端**新建**分支 `tauri-v1.0.1`
- 结果：✅ 已创建，远端 sha 与本地**完全一致**

## 一、执行结果（实测回读）

| 项 | 值 |
|---|---|
| 远端 ref | `refs/heads/tauri-v1.0.1` |
| 顶端提交 sha | `83d95afbc5beabba415ae016d8b656ab04f4b674` |
| 本地源分支 sha | `83d95afbc5beabba415ae016d8b656ab04f4b674`（与上相同） |
| 顶端提交信息 | `v0.1.6: 打包 Windows 免安装分发包（PyInstaller + 内置 Node）`，2026-10-09T13:25:13Z |
| 分支保护 | `protected: false`（GitHub 未自动加保护） |
| 推送通路 | 直连 github.com，**首次即成功**（未启用代理） |
| 传输量 | 0 个对象 —— 该提交已存在于远端 `main`，本次只是**建引用** |
| 网页入口 | <https://github.com/Woodeline/Worktodolist/tree/tauri-v1.0.1> |

推送回显：

```text
remote: Create a pull request for 'tauri-v1.0.1' on GitHub by visiting:
remote:      https://github.com/Woodeline/Worktodolist/pull/new/tauri-v1.0.1
To https://github.com/Woodeline/Worktodolist.git
 * [new branch]      workbuddy/main-d29003f7 -> tauri-v1.0.1
```

API 读回的分支清单：

```text
 - main         83d95afbc5be  protected=False
 - tauri-v1.0.1 83d95afbc5be  protected=False
```

## 二、分支命名规则

### 2.1 本项目的规则

```text
tauri-v<MAJOR>.<MINOR>.<PATCH>     例：tauri-v1.0.1
└─┬──┘ └────────┬──────────┘
  │             └─ 三段式语义化版本，取自 Tauri 应用的 src-tauri/tauri.conf.json > version
  └─ 前缀：标识「Tauri 桌面壳版本线」，与仓库现有的 Web/打包发行线（tag v0.1.x）区分开
```

四条硬要求：

1. **扁平名，禁止斜杠** —— 用连字符代替层级。`tauri/v1.0.1` 一律不要（原因见 2.2）。
2. **版本段用 Tauri 的 `version`**，不要在分支名里塞日期、人名、环境后缀。
3. **带 `tauri-` 前缀**，避免与裸版本号 `v1.0.1` 同名产生的歧义（见 2.3）。
4. 名称必须能通过 `git check-ref-format`（本名已验证）：

```bash
git check-ref-format --branch tauri-v1.0.1   # 退出码 0 = 合法
```

> 本仓库当前还没有 `src-tauri/` 目录，`1.0.1` 是按你指定的版本号取的；将来接入 Tauri 后，分支名应与 `tauri.conf.json` 的 `version` 保持同步。

### 2.2 为什么不能用斜杠（本机是重点坑）

| 现象 | 说明 |
|---|---|
| 本地建带斜杠的 ref | `git branch tauri/v1.0.1` 会**静默假成功**：回显 rc=0，ref 却没落盘，HEAD 悬空 |
| 远端已存在带斜杠的 ref | 本地每次 `fetch` 都**静默写不进** `refs/remotes/**`，导致 `git branch -vv` 永久显示陈旧的 ahead/behind |

所以不要跟这个坑对抗，命名一律扁平：

| ❌ 不要用 | ✅ 改用 |
|---|---|
| `tauri/v1.0.1` | `tauri-v1.0.1` |
| `feature/tauri-shell` | `feature-tauri-shell` |

### 2.3 禁用清单

| 形式 | 问题 |
|---|---|
| `tauri/v1.0.1` | 斜杠，见 2.2 |
| `v1.0.1`（裸版本号） | 与将来的发布 tag 同名 → `refname 'v1.0.1' is ambiguous`；也看不出「分支=版本线 / tag=发布点」的分工 |
| 含空格 `~ ^ : ? * [ \` | git 直接拒绝 |
| 以 `.` 结尾 / 含 `..` / 以 `.lock` 结尾 | git 直接拒绝 |
| `release-2026-10-11-tauri` | 分支名带日期，版本线会越积越乱（日期属于 CHANGELOG，不属于 ref 名） |

**同名 tag 怎么办**：若日后要为 Tauri 版打同名 tag（`git tag tauri-v1.0.1`），它会与分支同名，此时所有命令请写**全名**区分：

```bash
git push origin refs/tags/tauri-v1.0.1     # 推标签
git push origin refs/heads/tauri-v1.0.1    # 推分支
```

或干脆给 tag 换名（如 `tauri-v1.0.1-rel`）——**推荐这一条**，分支留作版本线、tag 留作发布点，两者永不同名。

## 三、操作步骤（可复现）

```bash
cd "C:/Users/王佐成/WorkBuddy/todolist"

# 步骤 0：先问远端现状，避免覆盖别人的提交、也避免非快进被拒
git ls-remote origin

# 步骤 1：跨名推送 —— 本地分支 → 远端新分支
git push --no-thin origin \
  refs/heads/workbuddy/main-d29003f7:refs/heads/tauri-v1.0.1

# 步骤 2：以远端读回为准做验证（见第四节）
git ls-remote origin refs/heads/tauri-v1.0.1
```

逐条说明：

- `refs/heads/A:refs/heads/B` 是**跨名 refspec**：本地叫 `workbuddy/main-d29003f7`，远端叫 `tauri-v1.0.1`。
  这样**不需要先 `git switch` 到目标名**，从而避开本机「切分支后工作区只重写有差异的文件、其余显示为 deleted」那个坑。
- `--no-thin`：不做服务端组包，本机网络写操作更容易一次通过。
- 本机抗抖动附加参数（写操作会被 TLS 中途掐断，读取通常没事）：
  `-c http.sslBackend=schannel -c http.version=HTTP/1.1 -c credential.helper=wincred -c http.postBuffer=524288000`
- 非交互环境必须 `GIT_TERMINAL_PROMPT=0`，否则会挂住等输入。
- **永远不要**只跑一条裸 `push` 就宣布失败——间歇性中断重试即通。

本轮实际使用的带重试脚本：

```bash
PXD="-c http.proxy= -c https.proxy="                     # 直连
PXP="-c http.proxy=http://127.0.0.1:13784 -c https.proxy=http://127.0.0.1:13784"
COMMON="-c http.sslBackend=schannel -c http.version=HTTP/1.1 \
        -c credential.helper=wincred -c http.postBuffer=524288000"
SRC=refs/heads/workbuddy/main-d29003f7
DST=refs/heads/tauri-v1.0.1
for i in 1 2 3 4 5 6 7 8; do
  cur=$(GIT_TERMINAL_PROMPT=0 timeout 60 git $PXD $COMMON ls-remote origin "$DST" 2>/dev/null | awk 'NR==1{print $1}')
  [ -n "$cur" ] && { echo "远端已存在 $DST = $cur"; break; }
  if [ $((i % 2)) -eq 1 ]; then PX="$PXD"; else PX="$PXP"; fi   # 直连/代理交替
  GIT_TERMINAL_PROMPT=0 timeout 240 git $PX $COMMON push --no-thin origin "$SRC:$DST" 2>&1 | tail -5
  sleep 1
done
```

## 四、推送后如何验证分支已成功创建

**核心口径：以远端读回为准，不接受「push 没报错」作为证据。** 三层验证，任一层通过才继续：

### L1 — 本地源分支的 sha

```bash
git rev-parse workbuddy/main-d29003f7
# 83d95afbc5beabba415ae016d8b656ab04f4b674
```

### L2 — git 直问远端（判定写入是否真的成功的**唯一依据**）

```bash
git ls-remote origin refs/heads/tauri-v1.0.1
```

判读：输出形如 `<sha>\trefs/heads/tauri-v1.0.1`。

- **有行且 sha == L1 的 sha** → 分支已创建且指向正确提交 ✅
- 输出为空但退出码 0 → 视为**抖动/未达成**，重跑（本机常见），别当成「远端没有」
- 只有 `fatal:` 行 → 才是真的失败

本轮实测：

```text
83d95afbc5beabba415ae016d8b656ab04f4b674	refs/heads/tauri-v1.0.1
```

### L3 — GitHub 平台侧（独立第二路，证明不只是本地缓存）

```bash
T=$(printf 'protocol=https\nhost=github.com\n\n' \
    | git -c http.proxy= -c https.proxy= -c credential.helper=wincred credential fill \
    | sed -n 's/^password=//p')

env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  curl -s -m 30 -H "Authorization: Bearer $T" -H "User-Agent: wb" \
  https://api.github.com/repos/Woodeline/Worktodolist/branches/tauri-v1.0.1
```

判读：**HTTP 200** + `"name":"tauri-v1.0.1"` + `commit.sha` 与 L1 一致 + `"protected":false`。
顺手看清单：`GET /repos/Woodeline/Worktodolist/branches` 应同时列出 `main` 与 `tauri-v1.0.1`。

### L4 — 人眼最终确认（30 秒）

打开 <https://github.com/Woodeline/Worktodolist/tree/tauri-v1.0.1>：能看到代码树，且仓库首页分支下拉里出现 `tauri-v1.0.1`、`main` 仍是默认分支。

## 五、如需回滚

```bash
git push origin --delete tauri-v1.0.1
```

或走 API（幂等，204=成功）：

```text
DELETE /repos/Woodeline/Worktodolist/git/refs/heads/tauri-v1.0.1
```

删远端分支**不影响**本地 `workbuddy/main-d29003f7`、`main` 及任何 tag。

## 六、备注

- 本轮**未改动** `main`、未新建/移动任何 tag、未改动工作区文件内容（`todo.txt` 的 ` M` 状态与本操作无关）。
- 本地分支名 `workbuddy/main-d29003f7` 含斜杠，是 WorkBuddy 生成的本地工作分支；按第 2.2 条，这个带斜杠的名字**不上远端**。
- 可选：让本地分支跟踪远端新分支（两者名字不同，需显式指定）

  ```bash
  git branch --set-upstream-to=origin/tauri-v1.0.1 workbuddy/main-d29003f7
  ```

  设完请用 `git ls-remote` 复核——本机对 `refs/remotes/**` 的写入存在静默失败的先例。
