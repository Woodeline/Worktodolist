# Worktodolist · 待办清单

以纯文本文件（todo.txt / done.txt）为唯一数据源的本地待办清单工具。**Tauri 2 原生桌面应用**：
前端与 Rust 壳打包成单一 exe，双击图标即用，运行期只依赖系统自带的 WebView2，数据永远在自己电脑上。

## 快速开始

1. 双击桌面「待办清单-Tauri」图标（或根目录的「启动待办清单-Tauri.cmd」）。
2. 第一次使用：在页面里选择本文件夹（授权读写 todo.txt），之后授权会被记住。
3. 不用了点「停止待办清单-Tauri.cmd」，或执行 `python launch_todolist_tauri.py --stop`。

> 运行期依赖：Windows 10/11 + WebView2 运行时（Windows 11 与较新的 Windows 10 已内置）。
> **不需要装 Node，也不需要装 Python** —— 那两个只在**构建**这个 exe 时才用到。

## 构建（仅首次、或改过代码后）

```
cd todolist-gui
npm install
npm run tauri:build
```

产物：

| 文件 | 说明 |
|---|---|
| `src-tauri/target/release/Worktodolist.exe` | 绿色单文件，约 4.2 MB，可直接双击运行 |
| `src-tauri/target/release/bundle/nsis/Worktodolist_<版本>_x64-setup.exe` | NSIS 安装包，约 3.3 MB |

想绕过启动器直接用，双击上面那个 exe 即可 —— `launch_todolist_tauri.py` 只负责
「定位产物 + 拉起进程 + 没构建过时说清怎么构建」。

## 功能

- **列表页**：今天/全部视图、逾期置顶、搜索（`/`）、快录（`n`）、拖拽排序、点选式优先级/截止日、完成撤销（Ctrl+Z）、外部修改检测（与 topydo/编辑器双轨互通）。
- **对话页**：用大白话指挥——「加一条 明天 交周报」「完成 回测报告」「把 回测报告 延到下周三」。本地规则引擎优先，绝不联网；听不懂时可选 AI 兜底（默认关闭，需自行配置）。
- **数据安全**：todo.txt 纯文本可随时用记事本/topydo 救援；每日自动备份到 `backup/`（保留 30 份）；关窗握手保证最后一次改动落盘；每次启动自动 git 提交数据变更（`auto:` 前缀），误操作有历史可回溯。

## 目录结构

```
├── README.md / CHANGELOG.md        仓库门面与版本历史（根目录仅此两个文档）
├── docs/                           全部说明文档（索引见 docs/README.md）
│   ├── guide/                      使用与安装
│   ├── design/                     视觉 / 交互 / 结构设计
│   ├── delivery/                   阶段性交付与实施记录
│   └── plan/                       方案与规划
├── 启动待办清单-Tauri.cmd / .vbs   启动入口（薄壳，仅调下面的启动器）
├── 停止待办清单-Tauri.cmd          停止入口
├── launch_todolist_tauri.py        纯 Tauri 启动器：定位产物 / 启动 / --status / --stop
├── todo.txt / done.txt             数据（唯一真源）
├── backup/                         每日自动备份（保留 30 份）
├── scripts/                        工具脚本（每日提醒、提醒任务注册、环境辅助）
└── todolist-gui/
    ├── src/                        React 前端（src/lib 纯函数 / src/hooks 状态 / src/components 展示）
    └── src-tauri/                  Tauri 2 桌面壳（Rust）
        ├── src/                    workspace / git / reminder / ai_proxy / lib
        ├── icons/                  Tauri 版专属图标（橙色）
        └── target/release/         构建产物（git 忽略）
```

## 文档

说明类文档统一收在 [`docs/`](docs/README.md)，**不与代码混放**。按用途分四类：

| 目录 | 内容 |
|---|---|
| [`docs/guide/`](docs/guide) | 使用说明、topydo 安装配置 |
| [`docs/design/`](docs/design) | UI 重定调设计方案、工具集路线图 |
| [`docs/delivery/`](docs/delivery) | 工具集 P1–P3 交付与实施说明 |
| [`docs/plan/`](docs/plan) | 产品优化方案、工具集扩展规划 |

命名规范、新增文档的放置规则、以及已移除文档的清单，都写在 [`docs/README.md`](docs/README.md) 里。

前端保留「浏览器双模式」（`isTauri()` 为假时走 File System Access + 本地代理），
理由只有一个：`npm run dev` 与 vitest 需要一个浏览器环境。仓库**不**再分发浏览器版。

## 每日提醒（可选）

把「今天到期/逾期」的任务在每天 09:00 弹窗告知（应用没打开也会提醒）：

```
python scripts/register_reminder_task.py
```

删除：`schtasks /Delete /TN "Worktodolist每日提醒" /F`

> 应用**正在运行**时，提醒由壳自己弹（`src-tauri/src/reminder.rs`），不需要计划任务；
> 计划任务这条只为「应用没打开」的场景兜底。

## AI 兜底（可选，默认关闭）

对话页右上「AI 兜底」里配置 baseUrl / 模型 / API Key。仅当本地规则引擎没听懂时，那一句话才会发往你配置的服务（界面上会明示发往哪个域）。

- **配置完点「测试连接」**：端到端自检真实链路（配置 → 转发层 → 认证 → 模型 → JSON 解析），分档报告问题所在——未配置 / 转发层拒绝 / Key 失效 / 模型名错误 / 超时 / 返回格式异常 / 正常。
- 桌面版里这段转发由壳内的 `src-tauri/src/ai_proxy.rs` 承担；浏览器里走 vite 的本地转发。
- 不想配真实 Key、只想验证转发层：`npm run test:ai`（在 `todolist-gui/` 下，自动起 mock 上游 + 生产 preview，六项断言）。
- API Key 只存本机。
- 转发层会**拒绝回环/内网网段目标**（防跳板）。若要用本地大模型（如 Ollama），启动前设环境变量：`TODOLIST_AI_ALLOW_HOSTS=localhost,127.0.0.1`（逗号分隔，精确匹配主机名）。

## 开发

```
cd todolist-gui
npm install
npm run dev          # 浏览器 dev 模式（HMR），用于改前端时快速看效果
npm test             # vitest 单元/回归测试
npm run tauri:dev    # Tauri dev：Rust 壳 + 前端 HMR（改 Rust 侧时用这个）
npm run build        # 只构建前端（产物 dist/，会被 tauri build 内嵌进 exe）
```

根目录的启动器（适合排查启动问题）：

```
python launch_todolist_tauri.py --status    # 只诊断：产物在哪、构建前置条件齐不齐
python launch_todolist_tauri.py --stop      # 结束桌面版进程
```

## 已知边界

- 运行期只依赖 WebView2；**构建期**需要 Rust 工具链、MSVC 链接器与 Windows SDK（`rust-toolchain.toml` 钉在 `stable-x86_64-pc-windows-msvc`）。
- 撤销栈只在内存，重启后撤销历史清零（git 历史可兜底找回数据）。
- 桌面版暂无「打开所在文件夹」「自动更新」等外围功能。
- `schtasks` 提醒在受限/沙箱环境可能被拦截，需在真实桌面环境注册验证。
