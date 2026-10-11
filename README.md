# Worktodolist · 待办清单

以纯文本文件（todo.txt / done.txt）为唯一数据源的本地待办清单工具：浏览器 GUI + 大白话对话式操作 + 可选 AI 兜底，双击图标即用，数据永远在自己电脑上。

## 快速开始

1. 双击根目录的「启动待办清单.cmd」（或桌面图标）：自动选端口 → 后台起服务 → 用 Edge/Chrome 的 app 模式打开界面。
2. 第一次使用：在页面里选择本文件夹（授权浏览器读写 todo.txt），之后授权会被记住。
3. 不用了点「停止待办清单.cmd」。

> 依赖：Node.js（vite preview 服务构建产物）、Edge 或 Chrome（File System Access API）、Python 3（启动器）。
> 克隆到新机器后先在 `todolist-gui/` 执行 `npm install`；首次启动会自动执行 `vite build`。

## 功能

- **列表页**：今天/全部视图、逾期置顶、搜索（`/`）、快录（`n`）、拖拽排序、点选式优先级/截止日、完成撤销（Ctrl+Z）、外部修改检测（与 topydo/编辑器双轨互通）。
- **对话页**：用大白话指挥——「加一条 明天 交周报」「完成 回测报告」「把 回测报告 延到下周三」。本地规则引擎优先，绝不联网；听不懂时可选 AI 兜底（默认关闭，需自行配置）。
- **数据安全**：todo.txt 纯文本可随时用记事本/topydo 救援；每日自动备份到 `backup/`（保留 30 份）；页面转后台/关闭前即时刷盘；每次启动自动 git 提交数据变更（`auto:` 前缀），误操作有历史可回溯。

## 目录结构

```
├── 启动待办清单.cmd / 停止待办清单.cmd   入口
├── launch_todolist.py    启动器：端口探测、preview/dev 服务、身份探针、自动提交
├── stop_todolist.py      停止器：pid 文件 + 端口反查 + 孤儿进程清扫
├── todo.txt / done.txt   数据（唯一真源）
├── backup/               每日自动备份（保留 30 份）
├── scripts/              工具脚本（自动提交、每日提醒、安装辅助）
└── todolist-gui/         React + Vite 前端（src/lib 纯函数 / src/hooks 状态 / src/components 展示）
```

## 每日提醒（可选）

把「今天到期/逾期」的任务在每天 09:00 弹窗告知（应用没打开也会提醒）：

```
python scripts/register_reminder_task.py
```

删除：`schtasks /Delete /TN "Worktodolist每日提醒" /F`

## AI 兜底（可选，默认关闭）

对话页右上「AI 兜底」里配置 baseUrl / 模型 / API Key。仅当本地规则引擎没听懂时，那一句话才会发往你配置的服务（界面上会明示发往哪个域）。

- **配置完点「测试连接」**：端到端自检真实链路（配置 → 本地代理 → 认证 → 模型 → JSON 解析），分档报告问题所在——未配置 / 代理拒绝 / Key 失效 / 模型名错误 / 超时 / 返回格式异常 / 正常。
- 不想配真实 Key、只想验证本机转发层：`npm run test:ai`（在 `todolist-gui/` 下，自动起 mock 上游 + 生产 preview，六项断言）。
- API Key 只存本机 localStorage。
- 本地转发代理会**拒绝回环/内网网段目标**（防跳板）。若要用本地大模型（如 Ollama），启动前设环境变量：`TODOLIST_AI_ALLOW_HOSTS=localhost,127.0.0.1`（逗号分隔，精确匹配主机名）。

## 开发

```
cd todolist-gui
npm install
npm run dev          # dev 模式（HMR）；日常启动器默认走 vite preview 服务 dist/
npm test             # vitest 单元/回归测试
npm run build        # 生产构建（launch_todolist.py 缺 dist 时也会自动执行）
```

启动器加 `--dev` 可强制 dev 模式；`--show-window`（或用 .cmd 启动）可看到服务日志。

## 打包与发布

```
python scripts/build_exe.py        # 打包：release/Worktodolist-v<ver>-win-x64/ 与同名 .zip
python scripts/verify_release.py   # 验包：十项（校验值 / CRC / 内容对账 / 冷启动 / HTTP / 内置 Node 与 Python）
python scripts/release_github.py   # 发布：打包 → 验包 → 打本地 tag → 建 Release → 上传 → 对账 → 最后推 tag
```

日常发版直接双击根目录的「发布新版本.cmd」即可。规则与要点：

- **版本号取自 `todolist-gui/package.json`**（改版本号 = 改这一处 + `package-lock.json` 同步），tag 形如 `v1.0.1`。
- **产物形态**：`Worktodolist-v<ver>-win-x64.zip`（内置 Node 与预构建前端，目标机解压双击即用，不需要装 Node/Python）+ `SHA256SUMS.txt`。
- **幂等**：tag 已存在则复用、Release 已存在则更新、同名附件先删后传；网络中断后直接重跑。
- **凭据**：优先读 `GH_TOKEN` / `GITHUB_TOKEN` 环境变量，没有才回落 Windows 凭据管理器（`git credential fill`），令牌不落盘。
- **推 tag 是最后一步**，别改这个顺序：推 tag 会唤醒 CI 的 push 护栏，而护栏靠「该 tag 的 Release 有没有附件」决定跳不跳过构建。推早了 CI 会重建一遍，并把你刚传上去的附件覆盖成 CI 产物（两条链路的产物**不逐字节一致**，见下条）。
- **CI 双轨**：推 `v*` 标签会触发 `.github/workflows/release.yml`，在 `windows-latest` 上重建并发布（实测 90–120 秒）；若该 tag 的 Release 已有附件，CI 会早退、不做重复构建。
- **两份产物不一样是正常的**：本机链用 WorkBuddy 随附的 Python，CI 用 `setup-python` 的 3.13，两侧运行时不同，`SOURCE_DATE_EPOCH` 只能保证同一环境内可重复。**同一次发布只由一条链路定稿。**

## 已知边界

- 浏览器限定 Edge/Chrome（File System Access API）；换浏览器需重新授权目录。
- 撤销栈只在内存，重启后撤销历史清零（git 历史可兜底找回数据）。
- `schtasks` 提醒在受限/沙箱环境可能被拦截，需在真实桌面环境注册验证。
