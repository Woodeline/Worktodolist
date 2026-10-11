# 更新日志

## v1.0.1 · 2026-10-11

把「Python 启动器 + Node/vite 服务 + 浏览器 app 模式」三件套换成 **Tauri 2 原生桌面壳**，并从仓库移除整条旧启动与旧打包链路。产物从「154 MB 解压目录 / 56.6 MB zip」变成 **单文件 `Worktodolist.exe` 4.20 MB**（外带 NSIS 安装包 3.30 MB）：分发体积降到 **1/13.5**，解压占地降到 **1/36.6**。

### 下载

| 文件 | 体积 | 说明 |
|---|---|---|
| `Worktodolist.exe` | 4 406 784 B (4.20 MB) | 绿色单文件，双击即用；需系统自带 WebView2 |
| `Worktodolist_1.0.1_x64-setup.exe` | 3 456 702 B (3.30 MB) | NSIS 安装包，装到当前用户，附开始菜单/桌面快捷方式 |
| `SHA256SUMS.txt` | — | 上方两个文件的 SHA-256 校验和 |

> 本版**覆盖旧的 v1.0.1**（原 v1.0.1 为 PyInstaller 免安装分发包，已随本条链路一并下线）。
> 两者同名不同物，请以本页附件为准。

### 为什么换（不是"能用不能用"，是三处结构性问题）

- **端口是身份的一部分**：页面来源随端口变化，`localStorage` 与目录授权跟着丢。
- **进程是一棵树**：启动器 → node → 浏览器窗口，任一层残留都会演出「pid 残留误判」。
- **目标机要有运行时**：为了「解压即用」，只能在包里塞进 Node 与 Python 运行时。

Tauri 壳一次消掉三条：来源固定为 `tauri://localhost`；单进程单实例（第二个实例只把窗口提到前台）；运行期只依赖系统自带的 WebView2。

### 新增（`todolist-gui/src-tauri/`）

| 模块 | 取代了什么 |
|---|---|
| `workspace.rs` | 浏览器的 File System Access API + Python 侧的路径/pid/端口约定。写入改为「临时文件 + `fs::rename`」原子替换，并用进程内 `Mutex` 串行 |
| `git.rs` | `scripts/git_autocommit.py`（启动时一次自动提交，失败仍写 `.todolist-launch.log`） |
| `reminder.rs` | `scripts/daily_reminder.py` 的解析与文案。应用在运行 → 前端 `reminder_check`；应用没打开 → 计划任务用 `Worktodolist.exe --reminder` 拉起隐藏实例，**不再需要 Python** |
| `ai_proxy.rs` | 浏览器侧那条 AI 兜底转发链路（仍拒绝回环/内网目标） |

图标改为**橙色**，且只落在 `src-tauri/icons/`（Tauri 专用）—— 共用的 `<仓库根>/todolist.ico` 与前端 favicon 一字未动，非 Tauri 侧不受影响。

### 移除

- 旧启动器：`launch_todolist.py`、`stop_todolist.py`、`启动待办清单.cmd`、`启动待办清单.vbs`、`停止待办清单.cmd`
- 旧打包链路：`scripts/build_exe.py`、`scripts/build-requirements.txt`、`scripts/verify_release.py`
- 已被壳内移植取代：`scripts/git_autocommit.py`
- `.gitignore` 里对应的运行状态与产物规则（`.todolist-server.pid` / `.todolist-server.port` / `.venv-build/` / `build_exe/` / `release/`）

保留并收敛为纯 Tauri 版：`launch_todolist_tauri.py`（找到 exe 就启动、找不到就说清怎么构建、`--stop` 结束进程，**不再回落打开任何旧版本**）、`启动待办清单-Tauri.cmd/.vbs`、`停止待办清单-Tauri.cmd`。

### 构建注意（踩过的坑，记下来省下一次）

`schemars` 会报 `E0107: struct takes 3 generic arguments but 2 were supplied`。根因不是依赖版本，而是 **Cargo 特性解析器 v2 按 host / target 分桶**：`schemars` 挂在 `tauri-build` 底下属于 host 桶，而 `indexmap 1.9.3` 的 `std` 特性只在 `[dependencies]` 里开过，host 那份拿不到 —— `indexmap` 无 `std` 时 `IndexMap` 退化成只吃 2 个泛型参数。修法是**在两个 section 里各写一条同版本声明**：

```toml
[build-dependencies]
indexmap = { version = "1.9", features = ["std"] }
[dependencies]
indexmap = { version = "1.9", features = ["std"] }
```

注意 `cargo tree -e features` 会按 package id 合并、忽略分桶，因此它显示 `std` 已启用是**假象**；判据要看 `target/release/.fingerprint/indexmap-*/lib-indexmap.json` 里两条记录 `target` 哈希相同、`profile` 哈希不同。

## v0.1.6 · 2026-10-08

工具集从"一个容器"长成"一套骨架"，随后按需求收紧到 4 个工具；收尾时把整站视觉调性换成了「信号仪表」。这一版还第一次产出**免安装的 Windows 分发包**——内置 Node 与前端依赖，解压双击即用。

> ⚠️ 该免安装分发包链路（PyInstaller + 内置 Node）**已于 2026-10-11 随 Tauri 桌面版一并移除**，
> 本节以下相关内容保留为历史记录；对应的 `scripts/build_exe.py` / `verify_release.py` /
> `launch_todolist.py` / `stop_todolist.py` 已不在仓库中。


> 工具集 P1–P3 的完整交付说明见 `docs/delivery/2026-10-07-工具集P1-P3交付说明.md`；
> UI 重定调的设计全文见 `docs/design/2026-10-07-UI重定调设计方案.html`。
> 令牌对账表（`令牌差异表-2026-10-07.html`）属脚本产物、未入库，跑 `python scripts/ui-rebase-token-validate.py` 可复算。

### 工具集 P1–P3（2026-10-07）

#### 骨架（P0）

- **ToolShell 三版式**（`components/tools/ToolShell.jsx`）：`instant / inspector / workbench` 三种主体排布。外壳**不认识任何具体工具**——只读 `registry.js`、渲染清单、把选中项挂上去；新增工具 = 放一个组件 + registry 加一条，`App.jsx` / `ToolsPage.jsx` 一行不用改。
- **registry 六字段**（`group` / `layout` / `capabilities` / `keywords` / `stateVersion` / `beta·hidden`）：`capabilities` 既是界面上看得见的风险徽标，也是白名单；`canWrite()` 是唯一的写授权入口。硬原则"只描述*是什么*，绝不描述*怎么渲染*"（禁 `render:` 字段，`registry.test.js` 强制）。
- **工具级 ErrorBoundary**（`ToolBoundary.jsx`）：单个工具崩了不再带走整页，崩溃页打印 `componentStack` 前 3 层。
- **`toolStorage(id, version)`**：存档键名 `todolist.tool.<id>.v<version>`。

#### 新增（P1 条目 7–11）

- **`useTodoSnapshot()`**：给工具的只读投影，**投影对象内不含任何变更方法**。
- **提议通道泛化**：`{kind:'create'|'edit'|'batch'}`，确认统一走 `dispatch(intent, ctx)`；未授权工具**拿不到落盘入口**。
- **自然语言开工具**：`nlRules` 新增 `tool.open`——句首窗口 8 字才算命令、禁单字动词；无触发词阈值 0.5、有触发词放宽到 0.22（开工具没有副作用，故可放宽——与"写文件宁可少认"的代价不对称口径一致）。
- **工具动作进事件日志**：写入 `eventLog`（`session-*.ndjson`，ts 存 UTC ISO），replay 无副作用。

#### 新增（P2 条目 12 / 14）

- **三个待办域工具**：周报导出 `WeeklyTool`（workbench）、统计 `StatsTool`（workbench，纯 CSS 条形图走 `--ramp-*`）、批量优先级 `BulkPrioTool`（inspector，**当前唯一 `writes:true`**）。
- **算法一律落 `lib/` 纯函数**：`lib/todoTools/{weekly,stats,bulkSelect}.js` + 各自测试——这是进 registry 的准入门槛。
- **左栏搜索 + 分组折叠（单层）+ MRU**：刻意不做三级导航。

#### 范围收紧（2026-10-07 同批）

- **删 10 个工具**：`units / base / datespan / checksum / codec / regex`（T1 纯计算）、`filestat / textdiff / logview`（T2 本地文件）、`netcheck`（T4 联网自检）。
- **删 3 个分组**：`text`（文本与编码）、`file`（本地文件）、`external`（外部服务）；`GROUPS` 从 5 组收到 **2 组**（`engineering` / `todo`）。
- **删功能 = 删到底**：组件 + `lib/<domain>/` 纯函数与测试 + registry 条目 + 接线（`ToolsPage` 的 `files` 注入、vite 的 `/net-proxy`、设置页联网分组、styleguide 目录迭代器）+ `index.css` 孤立样式 + 门禁断言，一起撤掉，只留注释说明为什么删。
- **刻意保留的"无消费者设施"**（不是遗漏）：`configStore.parseList`、`resolveProxyTarget` 及其 SSRF 测试（AI 兜底仍在用）、`--ramp-1..5`（StatsTool 在用）、ToolShell 的 `instant` 版式（外壳契约三选一）。
- **条目 16「第三方脚本式工具注册」明确不做**：会击穿"数据主权优先"红线，且外部脚本无法纳入本仓 vitest 门禁。

### UI 重定调「信号仪表」（2026-10-08）

视觉调性整体换血：推翻 2026-10-06「贴近原生桌面工具」的拍板，改走 **候选 C「信号仪表」**（2026-10-07 三选一裁决，设计全文见 `docs/design/2026-10-07-UI重定调设计方案.html`）。**改动面只有 `index.css` §1 的令牌层**——组件禁裸值的红利兑现，所有组件零改动自动继承。

#### 变了什么

- **面板分域反转**：`--bg` (#ececee/#131417) 与 `--surface` (#f9f9fa/#1c1e22) 改为「仪器底座」关系——面板始终亮于底座、浮出底座；中间表面按 Oklch L 等感知排布，`--control-line` 对 surface 保持 ≥3:1（WCAG 1.4.11）。
- **强调色**：系统蓝 `#0f5fbf` → 示波器青 `#0e7490`（暗 `#46c9ec`），由候选自动裁决产生（对比度全项 + CVD vs danger/warn 闸门全过）。浅色主题 accent vs ok 的 tritanopia 冲突（ΔE 9.8）色相内不可解，用户裁决 A 接受（产品全程图标+文字双编码，无纯色辨析场景）。
- **mono 扩权**：`--font-display` 由占位（=font-ui）改为 `var(--font-mono)`——标题、页签、计数改由等宽字符承担个性，本次最强单点重定义。
- **姿态收紧**：`--sh-2` 加入 `0 0 0 1px` 描边分量（「分区仪表」的双线语言）；圆角整体 -1px（r-sm 3→2、r-md 4→3、r-lg 6→4、r-xl 8→6）；动效更快（dur-2 140→100ms、dur-3 180→140ms）；遮罩微冷微重。
- **顺序色阶转青相**：`--ramp-1..5` 蓝相 → 青相（与强调色同血统），相邻步差 ΔE ≥ 10。其中 ramp-4 在实施回归中由 `#5297b3` 压深至 `#5094b0`——qa-contrast 要求次深档对轨道 ≥3:1，首版 2.998 差一丝。
- **语义色全冻结**：danger/warn/ok 及全部软底线色一字未动（颜色只编码状态，语义不动；CVD 旧账 danger vs warn ΔE 4.7 为现网既有，列入实施后优化清单）。

#### 质量

- 全门禁绿：`test` **365/365** · `test:ui` 裸色值 0 + 对比度 90 组 0 失败 · `test:responsive` 24 档 285 断言 0 失败 · `test:tools` **63/63** · `test:settings` **27/27** · build 90 模块（index 271.77 kB 与基线持平）。
- **回归中修掉的两处门禁自身问题**：① `qa-tools.mjs` 暗色画布断言写死旧 surface 值 `rgb(42,42,42)` → 改为与 `--surface` 变量现算值比对（门禁不再随令牌换代失效）；② `qa-settings.mjs` 的 CDP 端口 9557 落在本机 Windows 排除端口段 9461-9560（bind 0x271D）→ 挪到 9563 并支持 `QA_CDP_PORT` 覆盖。
- 验证脚本沉淀：`scripts/ui-rebase-token-validate.py`（锚点反解 + WCAG 现算 + CVD 三型色觉模拟 + 色阶步差，附录级对账）、`scripts/ui-rebase-apply-tokens.py`（§1 应用器，值从验证器字典取不手抄）、`scripts/ui-rebase-doc-generate.py`（方案文档生成器，与验证器同源）。
- 换调前备份：`backup/index.css.pre-rebase-20261008.css`。

### Windows 免安装分发包（首次）

第一次把整个应用打成一个"解压双击即用"的包，目标机**不需要装 Node、也不需要 npm install**（Python 由冻结内置）。

#### 产物构成（`Worktodolist-v0.1.6-win-x64/`，约 154 MB）

| 组成 | 说明 |
|---|---|
| `Worktodolist.exe` | 启动器（PyInstaller onedir + windowed 冻结，约 2 MB） |
| `_internal/` | 冻结运行时（含 `python313.dll`，免装 Python） |
| `node/node.exe` | 内置 Node 22 运行时（免装 Node） |
| `todolist-gui/` | 前端源码 + 依赖 `node_modules/` + 预构建 `dist/` |
| `scripts/` · `stop_todolist.py` | 数据自动提交 / 每日提醒 / 提醒任务注册 / 停止 |
| `启动` · `停止` · `注册每日提醒.cmd` | 三个双击入口 |
| `todo.txt` / `done.txt` | 空模板（作者本人的数据绝不进发行包） |

打好的 `Worktodolist-v0.1.6-win-x64.zip` 约 56.6 MB，`SHA256SUMS.txt` 记 zip 与 exe 两个校验值。

#### 为打包改的启动器

- **冻结感知的根目录**：冻结后 `__file__` 指向解包临时目录、`sys.executable` 才是本 exe，所以 `HERE` 按 `sys.frozen` 分支取 exe 所在目录（源码方式启动行为不变）。
- **内置 Node 优先**：`find_node()` 先看同目录 `node/node.exe`，找不到才回落托管/系统的 Node。
- **三个新入口**：`--port <n>`（只认指定端口、不回落候选表，QA 与多实例用）、`--stop`（打包版没有 Python 时的唯一停止入口）、`--run-script <脚本>`（用内置解释器跑辅助脚本）。
- `--run-script` 同时修掉一个**冻结后才暴露的缺陷**：冻结后 `sys.executable` 是 exe，`[exe, script]` 会被当成"再启一次启动器"，自动提交与提醒脚本永远不会执行。`scripts/register_reminder_task.py` 同步改用该入口注册计划任务。

#### 可重复构建

`python scripts/build_exe.py`（依赖装进项目内 `.venv-build/`，版本锁在 `scripts/build-requirements.txt`，绝不污染系统 Python）。设 `SOURCE_DATE_EPOCH` 后两次构建**逐字节一致**：本次实测两轮 zip 与 exe 的 sha256 完全相同。

#### 验包脚本

`python scripts/verify_release.py`，十项：zip 校验值 → 逐条目 CRC → 与发行目录内容对账 → 解压到独立目录冷启动 → HTTP 200 且标题命中 → 断言**实际用的是包内 Node** → 包内含 Python 运行时 → `--stop` 能收尾。

#### 顺带修掉的一个真实缺陷

`stop_todolist.py` 的孤儿清扫原本按 `*todolist-gui*` 字样匹配命令行，同机上开发目录与解压出来的发行包**会互相清掉**（验证发行包时实测把正在跑的开发实例一并结束了）。改为按**脚本自身所在目录**匹配：开发目录只清开发目录，发行包只清发行包。已在中文路径下实测：命中 1 条、反例 0 条。

## v0.1.5 · 2026-10-06

第三个页签「工具集」：把工作中零零散散的小工具收进一个能持续长东西的容器，第一个入驻的是 RTI 耐热指数计算器。

### 新增

- **工具集入口**（顶栏第三页签「工具」）。`☰` 应用菜单里新增「页面」分组，对话 / 列表 / 工具三页分别绑定 `Ctrl+1` / `Ctrl+2` / `Ctrl+3`；「视图」「排序」两组仍是列表页自己的事，菜单结构不动。
- **工具集容器**（`components/tools/ToolsPage.jsx`）：左栏工具清单 + 右侧工具工作区，宽屏左右并排、≤768 转成上方横向段控条。这个外壳**不认识任何具体工具** —— 它只读 `tools/registry.js`、渲染清单、把选中项挂上去，所以后面加工具它不会再长大。
- **工具登记处**（`components/tools/registry.js`）：`id / name / desc / detail / tags / icon / load` 七项，`load` 是 `() => import(...)`。新增一个工具 = 放一个组件 + 这里加一条，别处一行不用改。
- **RTI 耐热指数计算器**（`components/tools/RtiTool.jsx` + `rti/{LifePane,RtiPane,CmpPane,NumberCell}.jsx`）：由独立的单文件网页移植而来，算法与交互一律保留 —— 三个页面（寿命推算 / RTI 耐热指数 / 多材料对比）、粘贴导入、PNG / CSV / JSON 导出、本机自动保存、画布上悬停读值 / 点击固定 / 右键取消。
- **算法抽成纯函数层**（`lib/rti/`）：`stats.js`（回归 / 不完全 Beta / 双侧 t 分位 / 内插与外推 / 置信区间解析解）、`calc.js`（三个计算入口 + 全部格式化）、`demo.js`（示例数据与空态骨架）、`chart.js`（画布绘制与命中检测）、`files.js`（下载与读文件）。与 DOM 完全解耦，因此可以单测；数值与原有独立 Python 基准（`verify_rti.py`）逐项对拍一致。
- **图表配色令牌 `--chart-*`**（13 个，明暗两套）：UI 语义色不够用 —— 数据可视化要的是"多系列彼此可辨 + 深浅两种底都能读"。画布用 `getComputedStyle` 读令牌，所以系统深浅色切换时图表自动跟着变，不会出现"浅底一套颜色、深底还是那套"。

### 关键取舍

- **表单存字符串，不存数字**。受控的 `type="number"` 输入在用户打到 `76.` 或 `-` 这类中间态时，浏览器按 HTML 规范报上来的是空串，React 一回写就把刚敲的小数点吞掉了。所以数字格统一用 `type="text" + inputMode="decimal"`（桌面端没有上下箭头，触屏仍唤数字键盘），解析集中在一处 `toNum()`，**空串是 `null` 而不是 `0`** —— 否则 `+'' === 0` 会让空值悄悄通过所有"大于 0"的校验。
- **画布交互态放 `ref` 不放 `state`**。鼠标移动不该触发 React 重渲染，重画一次画布就够了；事件监听只挂一次，始终走 ref 调最新版 redraw，避免闭包拿到旧数据。
- **结果会自己承认落后**。数据一改就把上一份结果标成 stale 并明说"还是上一次推算的"，免得用户看着结果改数据还以为结果同步更新了。
- **手机端数据表横滚而非压缩输入框**（`.rti-table { min-width: 420px }`）：把数字格压到 ~120px 会让 5 位数（45360）读不全，横滚一点更好用。

### 修复（移植源工具时一并修掉的隐性缺陷）

- **P₀ 留空 + 某个温度组没有数据点时整页崩**：原来在"有数据点的温度组"里取 `Math.max(...map[0].v)`，空数组时 `Math.max()` 返回 `-Infinity`。改为先过滤出有数据点的组。
- **只有 2 个温度点时残差算出 `NaN`**：`df = 0` 时残差无定义，置 `null` 并在 UI 上显示 `—`，而不是把 `NaN` 印到屏幕上。
- **材料被删后悬停态读到失效引用**：命中检测补 `validHit()` 校验，被删材料不再让画布抛错。

### 质量

- 单测 226 → **288**（13 个文件）。新增 62 例：`lib/rti/stats.test.js` 22 例（对教科书 t 表公认值断言 df=1…100、回归系数与 R²）、`lib/rti/calc.test.js` 40 例（直接对 Python 基准 `verify_out.txt` 的数值断言，含阈值内插 / 外推、单调性、边界与错误分支）。
- 新增 **`npm run test:tools`**（`scripts/qa-tools.mjs`）：真实浏览器里点真按钮的端到端验证 **56 项** —— 点「推算 t₅₀」后屏幕上必须出现 `12,518 h`、RTI 必须是 `149.2 / 130.5 °C`、95%CI 必须是 `148.9` 起、Ea 必须是 `122.2 kJ/mol`、画布必须真的有墨（读 alpha 通道计数）、跨页送数据后图例必须是 1 条、自动保存必须落盘成数字而不是字符串、刷新后必须原样恢复。带 `--shots` 输出 `qa-artifacts/tools-*.png`。
- **工具集纳入响应式矩阵**：`test:responsive` 由 19 档 227 断言 → **24 档 285 断言**（新增 1080 / 768 / 390 / 触屏 390 / 暗色 1280 五档工具集用例）。顺手修掉一处"假失败"——列表页专属的 `.nav-item` / 复选框命中区探测点被套到工具页上，现在按视图分流。
- 对比度契约 44 → **70 组**：把 `--chart-*` 全部纳入实测（文字类 ≥4.5:1、线条与数据点 ≥3:1；`--chart-grid` 是纯装饰网格线，只报数值不设阈值）。实测最紧的一组是 `--chart-frame` 3.23:1（浅）/ 3.34:1（深）。
- 全门禁绿：`test` **288/288** · `test:guard` 13 文件 / 288 用例全跑到 · `test:ui` 类名契约 0 缺失 + 对比度 70 组 0 失败 · `test:responsive` 24 档 285 断言 0 失败 · `test:tools` 56/56 · `test:settings` 25/25 · `test:ai` 6/6 · 四个攻击脚本 46/46、95/95、35/35(+7 观察)、28/28。
- 构建 59 → **72 模块**，JS 245.62 → 249.79 kB（gzip 83.97 → 85.51），CSS 40.07 → 51.52 kB（gzip 7.50 → 9.20）。**`RtiTool` 打成独立 chunk 51.63 kB（gzip 19.54）** —— 不打开工具页就不会下载它。
- 新增图标 `toolbox`（2×2 方块）、`thermometer`（温度计），共 16 → **18 个**。
- 样式指南新增 `tools` 视图（渲染真实 `Tabs` + 真实 `ToolsPage`），共 15 个视图。

## v0.1.4 · 2026-10-06

设置集中化：AI 兜底那套参数从对话页里搬出来，独立成一张设置页。

### 新增

- **独立设置页**（`SettingsPage.jsx` + `useAiSettings.js`）：API Key / 服务地址 / 模型 / 单次超时 / 失败重试 / 启用开关六个参数集中一处。左边说明、右边字段，底部一条动作栏（保存 / 放弃改动 / 测试连接 / 清除配置）。设置不是工作流的一部分，所以它不占页签，而是一张覆盖式独立页面。
- **三个入口指向同一张页**：顶栏齿轮（打开时高亮）、`☰` 应用菜单里的「设置…」、全局 `Ctrl+,`；Esc 或「返回」退出。
- **草稿与已保存分离**：改动只活在设置页里，点保存才落盘；页头出现「未保存」标记，保存按钮此时才可用。「测试连接」故意测草稿值——填完先验证，再决定存不存。
- **超时与重试真正生效**：`timeoutMs` 3000–120000（默认 20000）、`maxRetries` 0–3（默认 1）。只对 5xx 与网络异常重试；4xx（Key 错 / 模型名错 / 路径错）不重试——那种情况重试只会让用户白等。
- **配置变更订阅**（`subscribeAiConfig`）：保存 / 清除后所有读取点一起刷新，所以设置页改完，对话页顶部那句「会不会联网、发往哪里」当场跟着变。

### 移除

- 对话页状态行里的「AI 兜底 · 开/关」按钮与整块 `.ai-cfg` 配置面板全部删除，`index.css` 中的 `.ai-cfg-*` / `.chat-status-btn` 死样式一并清掉。状态行只保留一句"当前会不会联网"的明示。
- 旧配置不需要迁移：缺失字段由 `normalizeAiConfig` 补齐默认值。

### 修复

- **「清除配置」的禁用判据错了**：原先用 `aiOn`（是否启用）当判据，于是"填了地址与 Key 但没勾启用"时按钮是禁用的——一份含明文 Key 的落盘配置因此永远删不掉。判据改为「本机是否存有配置」。
- **设置页打开时点顶栏页签像假死**：tab 切了但主内容仍被设置页覆盖。改为点页签即退出设置页；`focusAfterSwitch` 相应改成按帧重试，等目标组件挂载后再聚焦（原来是单次 `setTimeout`，在"先关设置页再聚焦"的时序下会落空）。

### 质量

- 单测 215 → **226**（新增 11 例：配置归一化的区间夹取、超时取值来自配置而非常量、5xx 重试到成功 / 4xx 不重试 / 网络异常重试 / `maxRetries=0` 只发一次、订阅通知与"订阅者抛异常不影响写入"）。
- 新增 **`npm run test:settings`**（`scripts/qa-settings.mjs`）：真实浏览器点真按钮的 UI 级验证 25 项——设置页结构完整、旧入口确实消失、保存真的落盘（含超时与重试）、跨组件同步、清除干净、390 宽单列无横向溢出。带 `--shots` 额外输出 `qa-artifacts/settings-*.png`。
- 全门禁绿：`test` 226/226 · `test:guard` 11 文件全跑到 · `test:ui` 类名契约 0 缺失 + 对比度 44 组 0 失败 · `test:responsive` 19 档 227 断言 0 失败 · `test:ai` 6/6 · 四个攻击脚本 46/46、95/95、35/35(+7 观察)、28/28 · `test:settings` 25/25。
- 构建 56 → 59 模块，JS 240.26 → 245.62 kB（gzip 82.36 → 83.97），CSS 37.94 → 40.07 kB（gzip 7.23 → 7.50）。
- 新增类名 `settings-*`（18 个）与 `is-on`；新增图标 `settings`（齿轮）、`chevron-left`。

## v0.1.3 · 2026-10-06

桌面化改造：把界面从「网页」拉回「本机程序」。目标不是"更好看的网页"，而是关掉地址栏后看不出是网页。

### 视觉

- **字体三族 → 两族**。删掉宋体标题：`Songti SC` 在 Windows 上回落到 `SimSun`，小字号笔画发虚、且与正文不同族——这正是"字体不统一、观感不佳"的来源。标题与正文统一走 `Segoe UI` / 微软雅黑栈（显式栈，仍不用 `system-ui`），等宽只保留给数据、度量与键位。
- **色板**：暖调纸感 → 系统窗口灰 + 系统强调蓝（`#0f5fbf`，暗色 `#77a9f0`）。
- **几何**：圆角 12/18px → 4/6/8px；阴影从大范围漫射 → 窄、硬、贴边；正文 14px → 13px，行高 1.7 → 1.55。
- 删除整页方格底纹与 `.app > *` 逐块入场动画；动效时长 140ms → 90ms。

### 交互

- **自定义右键菜单**（新增 `ContextMenu.jsx` + `useContextMenu.jsx`）：全局禁用浏览器默认右键菜单。任务行 / 列表空白 / 对话消息 / 快照项 / 应用菜单各有自己的动作集；文本框由 Provider 统一兜底出「剪切 / 复制 / 全选」，不必每个输入框各挂一遍。支持子菜单、勾选项、危险项、越界翻转、Shift+F10 唤出，键盘 `↑↓ / Enter / → / ← / Home / End / Esc`。执行后用 rAF 重试拿稳焦点——实测单次 `focus()` 会被随后的 React 提交抢走。
- **应用工具条**左侧新增 `☰` 应用菜单（新建 / 搜索 / 撤销 / 视图 / 排序 / 重载 / 切换目录），位置对应原生程序的菜单栏。
- **屏蔽网页专属行为**：`Ctrl+P/F/G/U/J`、`Ctrl+±/0`、`Ctrl+滚轮`缩放、文件拖放到窗口触发导航、`overscroll` 回退手势、触屏点击高亮块。
- 全页文本默认不可选（数据区与正文区除外），选中色跟随系统强调色。
- 光标回归箭头（按钮 / 列表行 / 菜单项 / 页签）——手型光标是网页信号，可点性改由 hover 背景表达。

### 控件

- 按钮：hover 只变灰阶**不换色**，去掉按下位移。
- 复选框：18px 绿底 → 15px 系统强调蓝。「勾选」是选择语义，不是成功语义；`--ok` 仍留给保存状态。
- 分段控件：选中态从蓝色实心 → 凹底。
- 页签：浅蓝药丸 → 底部 2px 指示线。
- 任务列表：独立卡片 → 原生行（固定行高 + 整行 hover + 发丝分隔线 + 左侧 2px 强调条）。
- 工具调用卡片：卡片 → 左线等宽记录。
- Toast：底部居中深色气泡 → 右下角提示条。
- 抽屉 / 模态去掉 `backdrop-filter` 毛玻璃与滑入动画；原生滚动条（方形滑块 + 透明轨道）；`index.html` 内联首屏底色避免启动白闪。

### 质量

- 全门禁绿：`npm run test` 215/215 · `test:guard` 11 文件全跑到 · `test:ui` 类名契约 0 缺失 + 对比度 44 组 0 失败 · `test:responsive` 19 档 227 断言 0 失败 · 四个攻击脚本 46/46、95/95、35/35(+7 观察)、28/28。
- 触屏复选框命中区修复：visual 15px + `::before` 外扩时，行内边距必须 ≥ 14.5px，否则左侧半区会被行边界裁掉（实测宽 35px → 45px）。
- 新增令牌 `--font-ui` / `--h-control` / `--h-control-lg`；新增类名 `ctx-*` / `appmenu-btn` / `tabs-group` / `is-active` / `is-danger` / `is-open`。
- 构建 54 → 56 模块，JS 229.86 → 240.26 kB（gzip 79.23 → 82.36），CSS 37.96 → 37.94 kB（gzip 7.29 → 7.23）。

## v0.1.2 · 2026-10-06

对话「反问确认」按钮化：听懂了一句待办但不确定时，不再要求手打「是/不是」。

### 体验

- **提议按钮（新建 / 修改… / 跳过）**：隐式新增的反问消息下方直接挂三个按钮，一键确认或放弃（复用 readConfirm 状态机，确认前仍不改动文件）。按钮只挂当前存活的提议消息上——被回复或新命令消费后随之消失，刷新回放的历史消息不出现按钮（与澄清态不持久化的语义一致）。
- **修改弹窗 ProposalModal**：点「修改…」在弹窗里改标题 / 截止日 / 优先级 / 分类 / 标签（复用 EditDrawer 的字段样式体系），确认后走与「是」完全同一条 add 执行路径（工具卡片、事件日志、Ctrl+Z 撤销全兼容），日志记为「修改后新建「标题」」可读事件。空标题双保险拦截（弹窗禁用 + hook 兜底）。
- **Esc 分层**：修改弹窗打开时先关弹窗，否则照旧清空输入框。
- **favicon**：新增 `public/todolist.ico` 并在 index.html 引用，浏览器标签页不再显示默认图标。

### 质量

- 测试基线 208 → **215 例全绿**（新增 7 例：confirmCreate 直建路径、proposal 生命周期绑定、空标题拦截）。
- 生产构建 226.25 KB → 229.86 KB JS（gzip 78.20 → 79.23 KB）。

## v0.1.1 · 2026-10-06

AI 兜底接入检测工具 + preview 模式下代理缺口的修复。

### 修复

- **preview 模式下 AI 兜底绕过本地代理**：`resolveEndpoint` 原本只看 `import.meta.env.DEV` 标志，而构建产物里 DEV 恒为 false——日常双击跑的 preview 会直连上游、被 CORS 拦截，代理在 preview 里配了也白配。改为「DEV 或本机回环来源」即走代理（`isLocalOrigin()`），与"应用永远由启动器服务在 localhost"的部署模型一致。

### 新增：AI 接入检测（双层）

- **应用内「测试连接」按钮**（对话页 → AI 兜底设置面板）：用 `callAiFallback` 的真实请求路径发一条测试句，分档报告诊断结果——`config` 未配置 / `proxy` 代理拒绝内网目标（提示 TODOLIST_AI_ALLOW_HOSTS）/ `timeout` / `auth` Key 失效 / `model` 模型名或地址错误 / `request` / `upstream` 服务商 5xx / `network` 不可达（含 CORS 提示）/ `format` 返回无法解析为有效意图 / `success` 成功并展示模型解析出的意图。测的是表单当前值，未保存也能测。
- **命令行回归 `npm run test:ai`**（`scripts/qa-ai-link.mjs`）：不需要真实 API Key——自动起 mock OpenAI 上游 + 生产 preview，断言六件事：转发到达上游、路径拼接正确、Authorization 透传、`x-ai-target` 不泄漏、未放行内网目标 403、缺失目标头 403。这条脚本的存在理由：router 存量 bug 已证明「全绿测试 + 成功构建」发现不了配置层静默失效。

### 质量

- 测试基线 199 → **208 例全绿**（testAiConnection 九个分档用例）。
- 生产构建 226.25 KB JS（gzip 78.20 KB）。

## v0.1.0 · 2026-10-06

首个对外版本。基于 2026-10-06 两轮代码评审（自评 + 外部评审建议）合并落地。

### 数据安全（P0）

- **转后台/关窗前即时刷盘**（评审 P0-1）：监听 `visibilitychange`/`pagehide`，未保存改动立即写入 todo.txt；保存防抖 500ms → 200ms。修掉「点完就关、改动丢失」的主路径缺口。附回归测试 C9/C10。
- **原子写入口径修正**（评审 P0-2）：方案文档原声称「tmp+rename」与代码不符。实测确认依赖的是 Chromium `createWritable()` 交换文件 + `close()` 原子提交语义（FSA 对用户目录无 rename 原语），文档与代码注释均改为如实描述。
- **git 版本化落地**（自评补充）：`git init` + 每次启动后台自动提交数据变更（`scripts/git_autocommit.py`，只提交 todo.txt/done.txt/backup，失败静默）。方案 D2 承诺的「git 版本化 = 免费备份+历史」自此生效。
  <br>（该脚本已于 2026-10-11 被 `src-tauri/src/git.rs` 取代并移除；能力与行为不变。)

### 架构与运维（P1/P2）

- **默认跑生产构建**（评审 P1-1）：启动器默认用 `vite preview` 服务 `dist/`（不再把 dev server 长驻用户机器），dist 缺失自动构建；`--dev` 强制开发模式。端口不变，已授权的目录句柄不受影响。
- **服务身份探针**（自评补充）：`is_our_server` 从「进程映像名是否 node.exe」改为 HTTP 内容探针（检查页面标题标记），关闭「另一个 node 程序占端口导致浏览器被开到别人页面」的 B5 盲区。踩坑记录：urllib 必须禁用系统代理、IPv6 地址要加方括号。
- **端口失败换端口重试**（评审 P2-1）：`--strictPort` 失败后自动换下一个候选端口（最多 2 次）；失败文案区分「被占用」「被系统保留」「其他」三种，不再把误占用误诊成 Hyper-V 保留。
- **AI 代理修复 + 硬化**（评审 P2-2 + 存量 bug）：实测发现原实现的 `router` 选项在 vite/http-proxy 中**根本不存在**，AI 兜底代理自始至终返回 500（从未真正转发过）。已改为 `configure` 包装 `proxy.web` 按请求注入目标（读 http-proxy 源码确认每请求覆盖能力），dev/preview 共用。同时加固：只放行公网 http(s) 目标，回环/内网网段一律 403，可用 `TODOLIST_AI_ALLOW_HOSTS` 显式放行本地大模型。附回归测试 proxyTarget.test.js（5 例）。
- **孤儿进程清扫**（自评补充）：stop 脚本按命令行特征（node.exe + vite.js + 本应用目录）扫描并结束残留 vite 进程，不再只杀 pid 文件里记录的最后一个。
- **仓库清理**（评审 P2-3）：删除 40+ 个 vite timestamp 临时文件、dist-qa/dist-check-3 历史构建、23MB vitest 临时目录；新增根 .gitignore。

### 体验（P1）

- **对话页顶部今日概览**（评审 P1-2，B 方案）：常驻摘要条显示「逾期 N 条 · 今日到期 M 条」，有逾期时升为警告色，点击直达列表页。对话页仍是默认页签。
- **每日提醒脚本**（评审 P1-3）：`scripts/daily_reminder.py` 扫描今天到期/逾期的任务并弹窗（WScript.Shell.Popup，消息经环境变量传递防注入）；`scripts/register_reminder_task.py` 一键注册 schtasks 每天 09:00 运行。注：受限/沙箱环境可能拦截 schtasks，需真实环境验证。

### 质量

- 测试基线 192 → **199 例全绿**（vitest，11 个文件）。
- 生产构建：223.64 KB JS（gzip 76.78 KB）+ 37.07 KB CSS。

### 暂缓项（下版本评估）

- 评审 P0-3（动作事件流重放撤销栈）：改动面大，且 git 版本化落地后紧迫性下降，单独确认口径后再启动。
