# Trae UI 结构解析（2026-10-18）

对 **Trae 1.107.1**（VS Code fork · Electron 39 / Chrome 142）运行时界面的结构取证与解析。
产出是**结构解析报告**，不含 React 复刻代码，不复制 Trae 的任何 CSS / 字体 / 图标资产。

## 从这里开始

| 文件 | 是什么 |
|---|---|
| **[`report.html`](./report.html)** | 主报告（14 节）。**唯一需要读的就是它** |
| [`notes/`](./notes/) | 工作底稿，按步骤记录发现、踩坑与事故（不是结论汇编） |
| [`tools/`](./tools/) | 取证脚本（零依赖，Node v26.7.0 + PowerShell 5.1） |
| `evidence/` | 取证素材（16 帧 PNG + 每帧 DOM / tokens 快照），**整体只在本机保留、不入库** —— 单份 JSON 50KB+，PNG 亦可由「复现」一节命令重新生成 |
| `extracted/` | 明文 CSS 挖掘结果、令牌分族、3 份结构树 |

## 主报告结构

- §1 目标 / 非目标 / 约束 / **采样偏差声明**（探针 profile：未登录、禁扩展、fixture 工作区）
- §2 结论速览 15 条 ｜ §3 取证环境与方法 ｜ §4 运行时架构（4 个渲染目标）
- §5 工作台 ｜ §6 SOLO / Agent 窗口 ｜ §7 首次引导页 ｜ §8 悬浮球（**空章，零证据**）
- §9 令牌体系：三层 · **双通道（机制已静态坐实）** · **多份拷贝漂移** ｜ §10 覆盖度 ｜ §11 **可迁移性评估 + A11 对账列**
- §12 风险 / 坑 / 工程约定（含一次真实例退出事故记录）｜ §13 待补证据与验证动作 ｜ §14 复现

**当前状态（v0.2）**：离线可做的工作**已清零**（像素测距 / A9 令牌机制 / A11 自家对账 / 深蓝取值静态获取）。
§13 剩下的 A0–A8 与新增的 A12 **全部需要探针窗口**，A10 需用户同意并自己挑时机。

## 证据分级（报告里每条结论都挂了标签）

`实测·DOM`（CDP 取到的真实节点尺寸）· `实测·像素`（对已存 PNG 做众数色分层测距）·
`静态`（反查明文 CSS/JS）· `推测`（外推未验证）· `待补`（缺证据，附了取数命令）。
**冲突时以截图与 DOM 为准**。A9 之后这条口径收紧为：**机制可以静态定，取值必须运行时定**——
静态层既拿不到令牌数量（61 vs 3919），也拿不到可信取值（33.5% 的 `var()` 带兜底字面量，
且同名令牌有 9 个文件 / 2 套值）。见 §9.1 与 §9.2.1。

## 复现

```powershell
cd docs/design/2026-10-18-Trae-UI结构解析

# —— 离线两条：不需要探针窗口，全程只读 ——
$APP = "$env:LOCALAPPDATA/Programs/Trae/resources/app"
node tools/a9-mirror-hunt.mjs $APP --verify evidence/E30-project-trusted.tokens.json   # §9.2 覆盖率 100%
node tools/a9-mirror-hunt.mjs $APP --scan-dirs                                         # 拼接点：0 命中
node tools/a9-mirror-hunt.mjs $APP --copies --bg-bg-base-secondary                     # §9.2.1 9 文件 / 2 套值
node tools/a11-token-audit.mjs ../../../todolist-gui/src/index.css ../../../todolist-gui/src/components
node tools/png-measure.mjs evidence/E34-terminal.png --cuts row:430 --from 40 --win 400 --threshold 4

# —— 需要探针窗口的动作（会产生可见窗口并抢焦点，启动前先打招呼）——
powershell -File tools/trae-cdp.ps1 launch 9333 $env:TEMP\trae-ui-fixture
node tools/cdp-capture.mjs --name E30-project-trusted --match workbench.html --press "Escape|" --max-depth 40 --max-nodes 6000
node tools/cdp-capture.mjs --name E40-agent-solo     --match solo-lite.html   --front
powershell -File tools/trae-cdp.ps1 stop 9333
```

⚠️ `launch` 会在桌面**产生一个可见的探针窗口并抢焦点**。它使用独立 profile（`%TEMP%\trae-cdp-probe`），
`stop` 只按命令行标记 `trae-cdp-probe` 杀进程、绝不按进程名全杀；但窗口本身对使用者是打扰——
**启动前先打招呼**（这条来自 notes/00 §5 的事故记录）。

## 工作约定

- 不重启、不干扰真实 Trae 实例；不碰登录凭据；不动 `todolist-gui/src` 与在途未提交改动。
- `evidence/` 整个目录不进 git（`*.png` 与 `*.dom.json` / `*.tokens.json` / `*.eval.json` 都已写入该目录的 `.gitignore`）：快照体量大，且都能由「复现」一节的命令重新生成；报告与底稿里引用的文件名即取数凭据。
- 采证卫生：**连续多格 PNG 字节数 / DOM 节点数完全相同 ⇒ 该格无效**；进视图前先查模态层。
- 报告里**没有证据的章节只留空位和取数命令，不留数值**。

## 底稿索引

| 文件 | 内容 |
|---|---|
| `notes/00-可行性与取证发现.md` | CDP 可行性门禁、3+1 渲染目标、两套血统分治、探针污染项、真实例退出事故证据链 |
| `notes/01-矩阵采集与输入通路.md` | 16 格证据清单、4 个工具缺陷、VK 码坑、「证据有效性」判定标准、Trae 专有事实 |
| `notes/02-CSS反查与令牌分层.md` | 静态 vs 运行时对账（令牌不可反查）、三层令牌模型、SOLO 是裁剪入口、`.part.*` 骨架、测量错误更正 |
| `notes/03-报告骨架与离线补证.md` | 像素测距工具与校准、像素↔令牌对账、**两处自我更正**（max-depth 根因 / icube 分桶）、双通道镜像发现、每帧 DOM 触顶审计 |
| `notes/04-A9令牌机制与A11令牌对账.md` | A9：102+5=107 / 覆盖率 100% / 拼接 0 命中；**意外产出「9 文件 2 套取值」的多拷贝漂移**；A11：167 条定义对账 12 项（已有 6 · 真缺 1 · 冲突 3 · 删除 1）；自家文件的 **38px vs 42px 文档债**（只报告未改） |

## 工具

| 脚本 | 要不要窗口 | 干什么 |
|---|---|---|
| `tools/a9-mirror-hunt.mjs` | **否**（只读安装目录） | 令牌通道机制：`--verify` 双向差集 / `--scan-dirs` 拼接点 / `--copies` 同名令牌有几份 |
| `tools/a11-token-audit.mjs` | **否**（只读 `src`，无写分支） | 自家令牌清点 + 状态色缺口 + 组件硬写颜色 + 能力缺失 + 行高文档漂移 |
| `tools/png-measure.mjs` | **否**（吃已存 PNG） | 零依赖解码 + 众数色分区测距 |
| `tools/trae-cdp.ps1` · `cdp-capture.mjs` · `css-mine.mjs` · `token-split.mjs` · `probe-input.mjs` | 部分**是** | 见报告 §14.1 |
