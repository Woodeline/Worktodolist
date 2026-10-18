# Step 3：CSS 反查与令牌分层对账

日期：2026-10-18 ｜ 输入：3 份明文 CSS（1.26 / 1.18 / 0.88 MB）+ 2 份运行时变量快照（E30 工作台 / E40 SOLO）
工具：`tools/css-mine.mjs`、`tools/token-split.mjs`，产出在 `extracted/`。

## 1. 最重要的一条：**令牌表不可能从 CSS 反查得到**

| 来源 | 工作台 | SOLO |
|---|---|---|
| 静态 CSS 里定义的自定义属性 | **61** 个名字 | **47** 个名字 |
| 运行时 `:root` 上的变量 | **3919** | **4388** |
| 两边都有 | 27 | 24 |
| 仅运行时（静态里根本找不到） | **3892** | **4364** |

结论：`--vscode-*` 这套令牌**不是写在 CSS 里的，是主题服务在运行时按当前主题生成后写到 `:root` 上的**。所以原计划里「从 CSS 反查令牌、再和截图对账」这条路，**只对结构类名成立，对令牌完全不成立**——令牌必须以运行时快照为唯一来源。这条如果不先验证，报告里 95% 的令牌表会是凭空推断。

## 2. 令牌是三层，不是两层

```
3919 (工作台)  =  VS Code 血统 3818（186 个语义组）  +  Trae 自研 101
4388 (SOLO)    =  VS Code 血统 3787（188 个语义组）  +  Trae 自研 601
```

**Trae 自研令牌族**（SOLO 侧实测）：

| 族 | 数量 | 样例（真实取值） |
|---|---|---|
| `brand-*` | 93 | `brand-blue-700=#3792e6`、`brand-blue-grey-900=#404a4f`、`brand-yellow-200=#ffeccc` |
| `bg-*` | 47 | 表面色 |
| `Radius-*` / `radius-*` | 32 | `2 / 4 / 8 / 10 / 20 / full=9999px` |
| `z-*` | 32 | `z-dropdown=1000`、`z-above-2=2`、**`z-gtm-modal=2147483647`**（int32 上限） |
| `status-*` | 30 | `status-primary-default=#2f74ff`、`status-alert-default=#fea900`、`status-success-surface-l2`、`status-warning-surface-l1` |
| `body-*` | 28 | `body-body-xs=10px/1.5 'SF Pro Text'`（**复合：字号+行高+字体**） |
| `heading-*` | 27 | `heading-lg-lineHeight=30px`、`heading-2xl-fontSize=28px` |
| `code-*` | 21 | JetBrains Mono 相关 |
| `font-*` | 15 | 字体栈 |
| `shadow-*` | 15 | 投影层级 |
| `Spacer-*` / `spacer-*` | 13 | `4 / 12 / 16 / 20 / 24 / 28px` |
| `border-*` | 12 | 描边 |

要点：
- **状态色带「表面分层」概念**（`surface-l1` / `surface-l2`），不只是一个 warning/danger 色——这是比 VS Code 原生更成体系的语义层。
- **字体只有两个**：`SF Pro Text`（UI）+ `JetBrains Mono`（代码）。
- **自研令牌在 SOLO 侧用了 601 条、工作台侧只有 101 条，差 6 倍** → AI 界面是建在 Trae 自己的令牌系统上的，编辑器外壳仍是 VS Code 那套。这决定了「哪些令牌值得借鉴」。
- **命名有两代并存**：`--Spacers-spacer-28` 与 `--spacer-12`、`--Radius-radius-8` 与 `--radius-4` 同时存在（大写族名 vs 裸名）。这不是我归类出错，是 Trae 自己处在令牌系统迁移中途。报告要如实标注，不要替它「整理统一」。
- 还有个 `--unset---vscode-panel-border-color` 这种「用 unset 覆盖上游」的手法，说明它是在 VS Code 变量之上做覆盖层。

## 3. SOLO 窗口不是独立前端，是同一套 workbench 的裁剪入口

三份 CSS 的布局类计数几乎一致（`editor×627 / titlebar×206 / auxiliarybar×80 / statusbar×79 / sidebar×61 / panel×41`），差异只在裁剪量：

| 包 | 体积 | 规则块 | 类名 | `icube-*` | 独有前缀 |
|---|---|---|---|---|---|
| `workbench.desktop.main.css` | 1.26MB | 9978 | 4657 | **423 名/1937 次** | `cue=51`、`setting=55`、`profile=43` |
| `...solo-lite.css` | 1.18MB | 9379 | 4348 | 252 名/1553 次 | `inline=41` |
| `...solo-lite-slim.css` | 0.88MB | 7143 | 3449 | 198 名/1101 次 | `quick=40`、`xterm=29` |

→ 「Agent 是独立窗口」指的是**独立渲染进程/独立 BrowserWindow**，不是独立设计体系。外壳同源，差异在 body class（`solo-lite`）与内容层。

## 4. 结构骨架（`.part.*` 实测计数，报告分区直接用这个）

`editor×627`、`titlebar×206`、**`auxiliarybar×80`**（VS Code 的次级侧栏，Trae 拿它放 AI 面板）、`statusbar×79`、`sidebar×61`、`panel×41`、**`soloaisidebar×16`**、`basepanel×12`、**`banner×12`**、**`solo-mode×7`**、`activitybar×3`、`pane-composite-part×2`。

图标字体是 `codicon`（1094 个类名）——Trae 沿用 VS Code 的图标体系，**没有自建图标字体**。

## 5. 从 DOM 实测到的尺寸基准（截图 ↔ 类名 ↔ 令牌三方对账）

| 元素 | 类名 | 实测 |
|---|---|---|
| 标题栏 | `.part.titlebar` | **1440×40**，字号 13px |
| 状态栏 | `.part.statusbar` | **高 20px**，字号 11px，底色 `rgba(224,226,242,.05)` |
| 画布底色 | `body.windows.theme-icube.icube-chat-next.vs-dark` | `#222427` |
| 模式切换 tab | `.icube-mode-tab` | 68×28，**圆角 6px**，底色 `rgba(224,226,242,.05)` |
| 通知浮层 | `.notification-toast` | 452×90，圆角 4px，底色 `#2a2d31` |
| SOLO 主面板 | `.panel-content.solo-lite-panel-box-shadow` | 1131×796，**圆角 16px + 投影**，白底 |
| SOLO 画布 | `body.solo-lite.theme-icube.vs` | `#f5f5f5`（**亮色**） |

工作台是**直角分栏**、SOLO 是**圆角卡片 + 投影**——同一产品里两套界面语言，这是给本项目做参考时最需要对齐取舍的一点。

## 6. 本轮修掉的一个测量错误（重要）

主题判定我一开始读的是 `data-vscode-theme-name`，一直报 `theme=(未暴露)`。真因：**Trae 把主题写在 `body.class` 上**（`vs-dark` / `vs` / `theme-icube` / `solo-lite`）。已改 `pageCollectVars()`，同时输出 `icubeTheme`。教训：工具报「未暴露」时，先怀疑探针读错位置，而不是记录成「产品没提供」。

## 7. 双层取证策略（写报告的分章依据）

- **壳层**（workbench / SOLO 窗口框架）：语义化类名 + `--vscode-*` → 可靠，可反查、可借鉴。
- **AI 内容层**（SOLO 面板内部、引导页）：**哈希类名**（`accountLoginButton-mqdOJx`、`sc-fhfEft dXhqLu`）+ Trae 自研令牌 → 类名不可用，只能靠截图 + 文案定位 + 计算样式 + 令牌值。

## 8. 下一步（Step 4 报告）

1. 按 target 分章：工作台 / SOLO 窗口 / 悬浮球 / 引导页。
2. 每章：布局分区表（用第 5 节实测尺寸）+ 组件树（用 DOM 快照）+ 该章用到的令牌（区分 VS Code 层 / Trae 自研层）+ 证据编号。
3. 单独一章「可迁移性评估」：哪些能借鉴到 Worktodolist（React+Tauri，无 VS Code 包袱），哪些是 Monaco/扩展宿主/Electron 特有、**不该借鉴**。
4. 补格（亮色工作台、窄窗、右键菜单、QuickOpen、通知浮层）仍需起探针窗口，约 3–4 分钟。
