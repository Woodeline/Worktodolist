# 更新日志

## 未发布 · 2026-11-17（编辑浮窗十条 UI 优化）

**一句话**：按用户最新十条要求收编辑浮窗的版式与配色。标题降一档去粗、左缘与页面行对齐、宽度锁死；除标题外统一 13px；备注去图标并加高、底栏收矮；分类 / 标签改一体化输入框；子任务复选框重画、行高与行内编辑对齐；优先级四档改用列表旗色；面包屑去掉 `@` / `+` 前缀。

### 编辑浮窗

- **标题与左缘**：`.drawer-title-input` 从 16px / 600 改为 14px / 400，水平内边距归零；`.drawer-header` / `.drawer-body` / `.drawer-actions` 的左右内边距统一到 `--row-pad`。宽边 20、≤1080 为 16、≤480 为 12，标题文字、字段标签、底栏按钮落在同一条左缘上，也和列表行同一条线。
- **宽度锁死**：`.edit-window` 补 `min-width: 0` 与 `flex: 0 0 var(--edit-window-w)`。此前它作为 `.modal` 的 flex item 会按内容 min-content 撑宽，长标题 / 长标签时窗口从 392 长到 460 以上；现在宽度只认 392，`max-width:100%` 仅在物理放不下的极窄视口兜底。520 宽下长标题实测窗口仍为 392，390 宽下降级为 358 且无横向滚动。
- **字体统一**：除标题外全部 13px，作用域收在 `.edit-window`，字段标签 / 输入 / select / 日期 / 备注 / 子任务读数与添加行同一号；提议弹窗等复用 `.field` 的地方不受影响。
- **备注**：去掉铅笔图标（编辑态保留 check）；按钮从 22px 增到 26.3px（+20%），字体 13px；`.edit-window .field-note` 改 flex 后 gap 8px（原 4px 的 2 倍）。裸 `.field-note` 会被后面的 `.field { display:block }` 盖掉，选择器必须带浮窗前缀。
- **底栏**：`.drawer-actions` 固定高 39.9px（旧 57px，少 30%），按钮 25.6px（旧 32px，少 20%）；`.drawer-actions .btn` 同时写 min-height，压过粗指针的 44px 兜底。左右内边距改 `--row-pad`，按钮横向 padding 保持 12px。
- **分类 / 标签**：`.tag-input` 成为唯一带边框、圆角和底色的 32px 容器；内部 input 去边框、透明、占满剩余宽度，`.tag-toggle` 变成容器内 28px 宽的无边框图标钮，hover 浮 `--surface-2`，展开时 accent 着色。`focus-within` 的焦点环画在容器上。
- **子任务**：`.subtask-list li` 最小高 26px；`.subtask-list .checkbox` 补 16px 圆环、1.5px 边框、hover accent、选中实心 accent + mask 对勾；行内编辑降到 24px，选择器带 `.edit-window` 前缀压过 `.field input` 的 32px 全局高度，点开前后行高都是 26px，浮窗不再跳动。子任务区上方新增一道 `.field-sep`，与下方原有分隔线一起把这一组框住；`.field-subtasks` 的 margin-top 归零，避免线后再叠 8px。
- **优先级配色**：按钮加 `priorityClass()` 产出的 `prio-*` 类；选中档高红 / 中橙 / 低蓝，边框与字取 `--flag-high|mid|low` 实色，底取新增的 `--flag-*-soft` 明暗两套；「无」用 `--border-strong` + `--text` + `--surface-2` 中性；D~Z 走 `prio-other`。选中态不再一律 accent 绿。

### 面包屑

- `TopBar` 的 `viewTitle` 对 `@:` / `+:` 改成只返回 `view.slice(2)`。侧栏与窄边底部导航点分类 / 标签时，顶部标题只留汉字，`@` 与 `+` 不再出现；项目色点仍由 `listName` 负责，不受影响。

### 验证

`npm test` 804/804（50 文件，新增 10 例，覆盖标题 / 宽度 / 字号 / 备注 / 底栏 / 标签 / 子任务 / 优先级 / 分隔线 / 面包屑）、`test:guard` 50 文件 / 804 例、`test:ui` 144 组 0 失败（新增 6 对优先级选中态对比度，明暗各一组）、`npm run build`、`test:responsive` 37 档 / 665 项、`test:settings` 48/48、`test:tools` 73/73、`test:attack` 46/46。浏览器 CDP 实测 600 宽标题 14/400、左缘 121 与字段标签同 x；底栏 39.89、按钮 25.59、备注 26.31；子任务行与行内编辑均 26；备注 gap 8；520 宽长标题窗口仍 392，390 宽无横向溢出；明暗两套高 / 中 / 低选中色与列表旗一致，中档文字压深一档后对淡底 4.82:1。

## 未发布 · 2026-11-17（行分隔线柔化）

**一句话**：主行分隔线从 `--border` 换成淡约 30% 的 `--row-line`，下面加 2px 柔光晕开；子任务行再淡一档到 `--row-line-child`，1x 下几乎看不见，只留换行暗示。

### 列表行

- 新增明暗两套令牌 `--row-line` / `--row-line-child` / `--row-line-halo`。`.task-row` 的 `border-bottom` 走 `--row-line`，`box-shadow: 0 1px 2px var(--row-line-halo)` 负责阴影晕开。
- `.task-row.is-child` 覆盖为 `--row-line-child` 并取消阴影。子任务连接线的竖脊 / 肘线仍用 `--border`，那是层级结构线，不跟着行分隔线一起淡。
- `.task-row.fading` 退场时清掉阴影，避免折叠中的行在下一行上方留一条灰带。

### 验证

`npm test` 794/794（50 文件，`TaskRow.test.jsx` 新增 1 例样式契约）、`test:guard` 794、`test:ui` 132 组 0 失败、`npm run build`、`test:responsive` 37 档 / 665 项。浏览器读实际应用后的计算样式核对：主行 `1px solid #e4e2db` + `0 1px 2px rgba(30,28,22,.05)`，子任务行 `1px solid #f0efea` 且无阴影；暗色为 `#2b2a25` / `#23221d`，两套均按 30% / 75% 淡化。600px 明暗截图中主行线变浅并带柔光，子行线在 1x 下基本不可见。

## 未发布 · 2026-11-17（Esc 隐藏到托盘）

**一句话**：Esc 改成「逐层退出」：先关浮层 / 搜索 / 选中，退无可退时把主窗口藏到托盘；隐藏前先把防抖窗口里的改动刷盘。

### 交互与实现

- **列表页**：分层顺序收进纯函数 `lib/escape.js#resolveEscape`，即编辑浮窗 → 冲突弹窗（阻塞，不做事）→ 搜索 → 选中行 → 隐藏到托盘。`App` 的 `onEscape` 按返回值派发；旧行为「一次 Esc 清搜索 + 清选中」保持不变。
- **工具页**：工作态 Esc 先回卡片墙；墙态 Esc 隐藏到托盘；工具搜索框里的 Esc 仍只清关键词（新增 `stopPropagation`，避免继续冒泡到外壳的藏窗层）。
- **其余层**：设置页 Esc 仍只关设置页，不藏窗；编辑浮窗 / 日期弹层 / 右键菜单 / 日历浮层 / 行内标题编辑各自先消费，到不了藏窗这一层。
- **刷盘与 Rust**：前端 `runtime.js#hideToTray` 先 `await saveNow()` 再 `invoke('app_hide_to_tray')`（刷盘失败也照样隐藏）；Rust 新增 `app_hide_to_tray`，只 `win.hide()`，与关窗到托盘的收尾同一动作，托盘左键 / 单实例 / macOS Reopen 的唤回逻辑不变。
- 设置页速查表「列表页 · Esc」改为「清空搜索 / 取消选中 / 隐藏到托盘」。

### 验证

`npm test` 793/793（50 文件，新增 `escape` 5 例 + `runtime` 3 例）；`test:guard` 50 文件 / 793 例；`test:ui` 132 组 0 失败、字阶 19/19、hooks 45；`npm run build`；`test:settings` 48/48；`test:responsive` 37 档 / 665 项；`test:tools` 73/73；`test:attack` 46/46；`cargo check --release` 通过。浏览器 CDP 用假壳记录 IPC：真实 App 干净状态按 Esc 调 `app_hide_to_tray`；工具墙按 Esc 调同一条命令；工具工作态 Esc 只回墙、无调用；工具搜索框 Esc 只清词、无调用。

## 未发布 · 2026-11-17（列表页四处 UI 优化：快录留白、一键展开、子任务连接线、底栏加高）

**一句话**：按用户截图做的四处版式调整 —— 快录条上下白收紧、组头计数旁加「一键展开 / 收起全部子任务」、子任务前面的通高竖线换成对齐父复选框的树形连接线、底部导航从 31px 加到 37.2px（+20%）。数据、门禁口径与三条红线均未动。

### 列表页

- **快录条留白**：上留白只在窄边（≤768）收 25%（8 → 6px）；下留白在长边 / 窄边统一收 30%，由条的 `padding-bottom`（8 → 5.6）与首个分组头 `padding-top`（12 → 8.4）两段一起让，合计 20 → 14px，避免只改一段把 30% 算丢。
- **一键展开 / 收起全部子任务**：挂在「全部任务 / 即将到期 / 收集箱」组头的计数右侧（`.group-tail`，双箭头 `chevrons-down` / `chevrons-up`，动作写 `aria-label` / `title`）。只批量改本屏可展开父项的 stableId，复用 `useRowCollapse`，与行尾三角箭头读同一份收起态；没有可展开父项时不画按钮。`qa-responsive.mjs` 新增窄边「全部」视图一档，点两次断言子行数 `3 → 0 → 3`、`aria-label` 随之翻转。
- **子任务连接线**：`.task-row.is-child::before` 的竖脊从原来悬在 `--row-pad + 13px` 的通高线，改到**父任务复选框圆心**（`--row-pad + --cb-size / 2`）；每行加一段短肘线指向子任务复选框，`MainList` 按渲染顺序给连续子行打 `.is-child-last`，末行竖脊收到行中腰，单子行自然只剩一个「L」。
- **底部导航**：`--bottomnav-h` 改为 `calc(var(--chrome-row-h) * 1.2)`，31 → 37.2px；标题行 / 横向页签条仍为 31。`BottomNav.test.jsx` 与 `qa-responsive.mjs` 的「三行同高」断言同步改为「底栏 = 页签条 × 1.2」，`AGENTS.md` 的骨架契约一并更新。

### 验证

`npm test` 785/785（49 文件）、`test:guard` 49 文件 / 785 例、`test:ui`（缺失类 0 / 对比度 132 组 0 失败 / 字阶 19 / hooks 45）、`npm run build`、`test:settings` 48/48、`test:responsive` 37 档 / 665 项、`test:tools` 73/73、`test:attack` 46/46。窄边 / 长边快录留白与底栏高度已由 `qa-responsive.mjs` 实测断言，子任务连接线在明暗两套截图下核对。

## 未发布 · 2026-11-17（仓库收尾清理：文档跟着版本走、一次性脚本退场）

**一句话**：v1.5.1 定为最终版后做的一轮只做减法：把已被后续版本覆盖的设计与交付过程稿、一次性迁移脚本、能写用户数据的开发工具、零引用的死导出全部删掉，跟踪文件从 309 降到 252，`docs/` 从 4.0 MB 降到 2.2 MB；产品代码的行为一行未改。

### 文档

- **删除 20 份失效文档**（含 Trae 解析目录 7 份）：`2026-10-07` 的「信号仪表」设计稿与工具集路线图、`2026-10-17` 工具页卡片式改版、`2026-11-01` C 原生 UI 方案、`2026-11-10` 优先级字阶徽章与日历补齐说明、`2026-11-11` 窄边降级说明、`2026-10-18` Trae 外部 UI 解析整个目录、`2026-11-14` 界面精简方案（其中 `ChatPanel` 等对象已退场），以及 `2026-10-07` / `2026-11-11` / `2026-11-13` 三份旧交付报告。
- **只留下仍然描述当前实现的 9 份文档**：使用说明与 topydo 指南、11-07 工作登记簿设计稿（已去掉已删除的对话页截图）、11-10 字体排版方案、11-15 两份体检记录、产品优化方案 v2。
- **`docs/README.md` 重写**：索引与现存文档一一对应，并写死「文档跟着版本走」的归档口径 —— 被覆盖的稿子直接删，历史由 git 保留，不再写「已作废」存根。
- 清理只被被删文档引用的截图：11-10 的日历 / 优先级样张、11-11 的三张窄边截图、11-07 的两张对话页截图，共 10 张。

### 脚本与代码

- **删除 9 个一次性脚本**：`ui-rebase-*` 三件套（10-07 迁移期产物）、`path_backup.txt`（本机生成物）、`interop.mjs` 与 `qa-interop.mjs`（后者无引用，前者能覆写 `todo.txt` / `done.txt` 且硬编码 Windows 路径）、`make_shortcut.py` / `verify_shortcut.py` / `install_topydo_shim.py`（Windows 一次性安装辅助，且已无文档引用）。
- **删除死导出** `useContextMenu.jsx` 的 `copyMenu`（全仓零引用，含测试）。
- **修正依赖归类**：`dayjs` 是前端运行时依赖，从 `devDependencies` 移到 `dependencies`，`package-lock.json` 同步。
- 同步修正因此失效的引用：`index.css` 的令牌验证注释改指 `npm run test:ui`，topydo 指南里 `path_backup.txt` 的说明改为「脚本运行时生成、不入库」。

### 构建缓存

- 删除 `src-tauri/target/debug`（782 MB）、前端 `dist` 与 `.DS_Store`；保留 `target/release` 与可运行 app，避免下次构建从头编译。
- 项目目录从 2.2 GB 降到 1.4 GB。

### 验证

`npm test` 781/781（49 文件）、`test:guard` 49 文件 / 781 例、`test:ui`（对比度 132 组 0 失败 / 字阶 19 / hooks 45）、`npm run build`、`test:settings` 48/48、`test:responsive` 36 档 / 603 项、`test:tools` 73/73、`test:attack` 46/46。文档相对链接脚本自检 0 断链。用户数据 `todo.txt` / `done.txt` / `backup/` 未改动。

## v1.5.1 · 2026-11-16（全量体检与清理：临时产物 3.3G、两个死模块、三组死样式）

**一句话**：v1.5.0 之后又叠了五轮界面收敛（十三至二十改），本版把它们连同一次**全量体检**一起放出 —— 代码、数据与安全三条红线一条没动，删掉的是**零引用的两个模块、三组再无人用的样式，以及 3.3G 不会再被读到的临时产物**；五处版本号同步到 1.5.1。

### 本轮（全量体检与清理）

**排查范围**：仓库根、`todolist-gui/`（前端 `src/` + `scripts/` 门禁）、`todolist-gui/src-tauri/`（Rust 壳 + 构建缓存）、`.github/workflows/`、`docs/`、`.gitignore` 覆盖情况。

**门禁实跑（全部通过）**

| 命令 | 结果 |
|---|---|
| `npm test` | 49 文件 / **781 用例**（清理前 50 / 809 —— 删掉的 `textScore.test.js` 带走 28 例） |
| `npm run test:ui` | css-check 缺失 0 / 对比度 / 字阶 19/19 / hooks 45 文件 |
| `npm run build` | 通过，`index-*.js` 384.59 kB（gzip 126.15）、CSS 101.06 kB（gzip 17.39） |
| `npm run test:guard` | 49 文件 / 781 用例，磁盘与实跑数一致 |
| `npm run test:settings` | **48/48**（11-15 报告里的 7 条过期断言已在本区间修完，不再是红灯） |
| `npm run test:responsive` | 36 档 / **603 项**断言，失败 0 |
| `npm run test:tools` | 73/73 |
| `npm run test:attack` | 46/46 |
| `cargo check` / `cargo test` | 无 warning；**13/13** |
| `npm audit --omit=dev` | **0 漏洞** |
| `npm audit`（含 dev） | 7 条（3 moderate / 2 high / 2 critical），全在 vite / vitest 链，见下方「未处理」 |

**清理项**

- **临时产物 3.3G**（全部在 `.gitignore` 内，可重新生成）：根 `.tmp/`（61M，QA 截图 + `node-compile-cache`）、`todolist-gui/.tmp/`（278M，69 个哈希目录，vitest 落盘残留）、`todolist-gui/qa-artifacts/`（4.9M 截图）、`todolist-gui/dist/`（0.6M 构建产物）、`src-tauri/target/debug/`（3.0G 开发档编译缓存）。仓库体积 4.7G → **1.4G**；`target/release/` 保留（内含可用的 macOS `.app`）。4 个 `.DS_Store` 删除。
- **两个零引用模块**：`src/lib/listTypography.js`（111 行，排版偏好 —— 已被 `readingDensity.js` + `listStyle.js` 取代，`applyListTypography` 全仓无人调用）、`src/lib/textScore.js` + `textScore.test.js`（169 行，模糊匹配打分 —— 随语言层退场后只剩自己的测试在引用它）。
- **三组死样式**：`.tool-group-toggle`（3 条规则 + `.tool-col-in` 网格里那条 `grid-area: caret` + 触屏 44px 清单里的一项）、`.tool-group-caret`（2 条）—— 工具墙的可折叠组头已重写，`RtiCompare` / `BulkPrioTool` 只用 `-head` / `-label` / `-meta` / `-acts`；`.tool-badge.is-ok`（`riskBadges` 的 tone 只有 quiet / warn / danger，没有 ok）。CSS 类名 473 → 470。
- **复扫确认零残留**：重跑孤儿样式扫描，剩余「源码零引用」只有 `.rdp-*`（`@daypicker` 运行时生成）与 `density-a-*` / `resize-*` / `tool-layout-*` / `prio-*`（模板字符串拼接）—— **真孤儿 0 组**。

**未处理（有意保留，已记在案）**

- `backup/`（11 个文件，含 `index.css.pre-rebase-20261008.css` 与 6 份历史 `todo-*.txt`）与根 `scripts/*.py`（topydo 时代的安装 / 换肤脚本，`docs/` 里仍有引用）—— 是历史资产不是垃圾，删了会断文档链接。
- 仓库根 `todo.txt` / `done.txt` 仍是 0 字节占位（真实数据在 `~/Documents/todolist/`）。
- dev 依赖 7 条漏洞要升 vite 7 + vitest 5，属大版本迁移；本地离线应用、不进产物，风险实为低。
- `src-tauri/target/release/` 1.2G 保留（含 macOS 打包产物），`src-tauri/gen/` 344K 是 Tauri 脚手架生成物。

### 验证

`npm test` 781/781、`test:ui`（CSS 缺失 0 / 运行时拼接缺失 0 / 对比度 / 字阶 19 / hooks 45）、`build`、`test:guard` 49 文件 781 例、`qa-settings` 48/48、`qa-responsive` 36 档 603 项、`qa-tools` 73/73、`qa-independent` 46/46、`cargo check` 无 warning + `cargo test` 13/13、`npm audit --omit=dev` 0 漏洞。版本号五处（`package.json` / `package-lock.json` 根两行 / `Cargo.toml` / `Cargo.lock` 的 `worktodolist` 条目 / `tauri.conf.json`）全部 1.5.1，`cargo check` 未改写锁文件其余部分。

下面是本版区间内（v1.5.0 → v1.5.1）的逐轮改动原文，按日期倒序 —— 保留当时的验证数据与取舍理由，方便回溯每一次判断。

### 2026-11-16（二十改：日志不再映射到日历，日历只画「全部」）

**一句话**：日历从此**只有一份数据来源** —— `todo.txt` 里全部未完成的任务（也就是「全部」列表那一批）。「日志」（`done.txt`）是已完成的记录，**不再按完成日投影到日历**，那一整套只读形态（「本月完成」读数、只读标、灰掉的不可拖 chip、浮层「没有完成记录 / 无添加入口」）一并删除。

#### 改动

- **`lib/calendar.js` 只剩一个来源**：`calendarSource(todoEntries)` 返回 `{ tasks: 未完成, dateKey: 'dueDate' }`。形参里的 `doneEntries` / `view` **直接去掉**（不是加个 if 挡掉）—— 签名本身就是这条边界的护栏，后面谁想再塞日志进来，得先改函数签名。`projectionForMonth` / `calendarProjection` 一并瘦身为 `(todoEntries, query, today[, month])`。
- **只读那套删除**：投影不再返回 `readonly` / `undated`；`CalendarView` 的 chip 恒可拖、页头恒「本月到期」；`CalendarDayPopover` 只有一种形态（永远带「添加任务」）；`index.css` 删掉 `.cal-stats-ro` 与 `.cal-chip.cal-done`（含窄屏 8px 色块那支），`undatedTasks`（无日期托盘）连函数一起清掉。
- **从「日志」切进日历，视图落回「全部」**（`App.jsx`）：日历模式下四个视图条目本来就不亮（选中态互斥），但面包屑会写着「日志」、格子里画别的任务，所以进日历时把 `view` 归到 `all`。
- **门禁同步**：`qa-css-check` 的运行时拼接白名单去掉 `cal-done`；`qa-settings` 的 `calendar-done` 舞台断言改写为「日志视图里打开日历仍只画未完成 —— 无只读标、chip 全部可拖、不出现已完成条目」；`calendar.test.js` / `CalendarView.test.jsx` 的只读与托盘断言换成「日志不参与投影」。

#### 验证

`npm test` 809/809、`test:ui`（CSS 缺失 0 / 运行时拼接缺失 0 / 对比度 / 字阶 19 / hooks 45）、`test:guard` 50 文件 809 用例、`build`、`qa-settings` 48/48（含新的「日志不进日历」）、`qa-responsive` 36 档 603 项全绿。真实数据核对（`Documents/todolist`：todo 36 条未完成 / done 25 条完成）：日历数据源 36 条、其中已完成 0 条，网格里出现已完成标题 0 条；样式指南 `?view=calendar` 与 `?view=calendar-done` 两页的格子内容与读数完全一致（本月到期 13 / 逾期 1）。

### 2026-11-16（十六改：chip 左缘墨条回归、浮层行高 70%、弹层不再跳）

**一句话**：日历格子里的任务条重新长出**左缘那道墨条**，颜色取该档深色（浅红底 + 深红条、浅橙底 + 深橙条……）；「当天任务」浮层里的行**行高收到 70%**，鼠标扫过去也不再整行上下跳一下。

#### 改动

- **左缘墨条回来，且跟底色同族**（`index.css`）：`.cal-chip` 加 `--chip-bar`（按 `prio-*` 取 `--chip-high|mid|low|none-fg`）与 `--chip-bar-w`（2px），由 `.cal-chip::before` 画成 2px 竖条，左缘圆角跟 chip 一致。**没用 `border-left`**（会把文字挤右、且和 `--row-pad` 互相牵制），**也没用 `box-shadow`**（悬停已经占了内描边，两者会互相顶掉）。文字左内距同步加一个条宽 `calc(var(--sp-1) + var(--chip-bar-w))`，标题不会被条压住。已完成 chip（无底色）与窄屏 8px 色块（块本身就是记号）都关掉墨条。
- **浮层行高 70%**（`.cal-pop .task-row`）：`min-height: calc(var(--row-h) * 0.7)`，32 → 22.4px。不重定义 `--row-h`，密度设置（28/32/38）与设置页样张不受影响。
- **修「鼠标移上去跳一下」**：`.task-head` 的悬停上移（`translateY(-6px)`，本来是为了给行底读数行让位）在浮层里没有意义 —— 那里 `minimal` 根本不渲染读数行。给 `TaskRow` 加 `.is-minimal` 类，并在浮层范围内把 `.task-head` 的 `transform` 钉成 `none`（含 `:hover` / `:focus-visible` 两个变体）。

#### 验证

`npm test` 795/795（新增 3 例：`is-minimal` 类与读数行不渲染、主列表不带 `is-minimal`、浮层 70% 行高与 `transform: none` 的样式契约；chip 契约改写为「四档墨条取 `-fg` + 伪元素绘制」）、`test:ui`（CSS 缺失 0 / 运行时拼接缺失 0 / 对比度 132 组 0 失败 / 字阶 19 / hooks 45）。浏览器实测：四档墨条 2px、颜色 = 对应 `-fg`（`rgb(140,30,23)` / `rgb(116,69,10)` / `rgb(20,71,127)` / `rgb(61,59,53)`），文字左内距 6px；浮层行 `min-height: 22.4px`、实测行盒 22px、悬停时 `.task-head` 的 `transform` 仍是 `none`；深色主题下墨条与底色明度差 7.2–8.1（清晰可辨）。

### 2026-11-16（十五改：日历 chip 按优先级着色并可拖，浮层可置顶 / 可拖动 / 可多开）

**一句话**：日历格子里的任务条**只剩标题 + 一档底色**（高红 / 中橙 / 低蓝 / 无灰，灰比周末格底明显更深），可以**直接拖到别的日期**改期；点开的那块「当天任务」变成**可置顶、可拖动的小窗口**，能同时开好几天的清单并排看；顺手修掉「在浮层里滚动 / 拖滚动条它自己关掉」的 bug，以及列表与「添加任务」之间那条**接缝**。

#### 改动

- **chip 只剩标题 + 底色**（`index.css` 的 `.cal-chip.prio-*`）：新增令牌 `--chip-{high,mid,low,none}-{bg,fg}`（明暗两套），高红 / 中橙 / 低蓝 / 无灰；D~Z 与「无」同灰。项目色点（`.cal-chip-dot`）与左缘墨条（`.cal-chip-bar`）**删除**。窄屏 8px 色块改用 `--flag-*` 的实色，8px 的淡底看不见。
- **「无」档的灰要与格子分开**（用户点名：周六日格子混色）：浅色 `#d9d5cc`、暗色 `#3b3931`；`qa-contrast.mjs` 加两条「块 vs 格底 ≥1.12」的明度差守卫，外加四档「字 / 底 ≥4.5」。
- **chip 可拖改期**：`draggable` + `onDragStart/DragEnd`，格子接 `onDragOver/DragLeave/Drop`；写入复用纯函数 `lib/calendar.js#dropReschedule`（同一天 / 拖回原处 = 零写入）。拖动中的 chip `.is-dragging`（半透明），落点格 `.is-drop`（inset 2px accent）。悬停给一层内描边 + `cursor: grab`。**拖动期间选中日的强调框让位**（`.cal-grid.is-dragging .cal-cell.is-selected:not(.is-drop)` 只留底色、去掉 1px inset 框）—— 否则屏幕上两个绿框，读不出到底会落在哪一格。
- **浮层可置顶**：右上角图钉（`cal-pop-pin`，开＝实心 + `.is-on` + 面板 `.is-pinned` 外框）。置顶时把当前落位**冻结成屏幕坐标**，之后点外面 / 翻月 / 切选中日都不关它；未置顶的同一时刻只留一块。
- **浮层可拖动**：拖标题栏移动（`pointerdown` 起手，`pointermove/up` 挂 window —— 挂标题栏上指针一离开就丢事件）；位置夹在窗口内留 8px，拖动期间关掉整页文字选择。
- **修 bug：在浮层里滚动 / 拖右侧滚动条，浮层会消失**（Windows 尤其明显）：根因是浮层自己挂了 `window.addEventListener('scroll', onClose, true)`，浮层内部的滚动事件也在同一条捕获路径上。现在收起逻辑集中在 `CalendarView`，target 落在任一 `.cal-pop` 里就跳过。
- **修 bug：列表与「添加任务」之间的接缝**：`.cal-pop-rows` 去掉底部留白，末行 `.task-row:last-child` 去掉下边框，页脚那条 `border-top` 成为唯一分隔（原来是「末行线 + 4px 空白 + 页脚线」）。
- **浮层里的行只报标题**：`TaskRow` 新增 `minimal` —— 读数行整块不渲染、悬停不浮快捷按钮。日期就在它所在的那一天，再报一次是噪声。
- **日历取数不再跟侧栏视图走**：`calendarSource` 只认「已完成」一支，其余一律取**全部未完成**。切今日 / 分类 / 标签不会再让某一天凭空少几条；搜索仍生效（显式动作）。
- **样式指南**：`?view=list-all` 加一条「五段读数全有」的样张（每月对账并导出流水），用来核对分段顺序与竖线。

#### 验证

`npm test` 792/792（新增 5 例：视图不影响取数、chip 无点无条、chip 可拖、置顶钮、minimal 行、接缝与底色令牌）、`test:ui`（css-check「缺失 无」、对比度 132 组 0 失败、字阶 19、hooks 45）、`test:guard` 49 文件 / 792 例、`qa-responsive` 36 档 588 项、`qa-settings` 48/48、`npm run build`。浏览器实测：接缝 0px、末行 `border-bottom: 0px`、浮层内滚动不再关、置顶后点外面仍在、两块同屏、chip 拖 11-14 → 11-16 生效。

### 2026-11-16（十四改：读数行分五段、竖线分节、字号统一）

**一句话**：鼠标悬停浮出的读数行从「一长串挤在一起」改成**五段用细竖线切开**——`日期 · 子任务 ｜ 分类 ｜ 标签 ｜ 重复 ｜ 提醒`，**全行统一 11px**（原来后面的信息比日期更小，读起来像注脚）；空着的段连同竖线一起不画。

#### 改动

- **分段顺序与分隔线**（`TaskRow.jsx`）：读数行不再手写一串 `{due}{ctx}{proj}…`，改为先构造 `metaGroups[]`，渲染时 `map` 并**只在两段之间**插 `.meta-sep`（1px × 9px，`--border-strong`）。空段不 push，所以竖线数恒等于「非空段数 − 1」，不会留孤立线头。
- **字号统一**：`.task-meta` 整行 `font-size: var(--fs-2xs)`，日期与后四段同号；新增 `.meta-field`（内联 flex + `--sp-1` 间隙 + `--muted`）作为分类 / 标签 / 重复 / 提醒的统一外壳，`.is-time` 走 `--font-mono`。旧的 `.rec-chip` 整条删除。
- **提醒进读数行**：`rem:` 渲染为 🕐 + `MM/DD HH:mm`（导出 `remindLabel`），不再只存在于编辑浮窗里。

#### 验证

`npm test` 792/792（读数行新增 6 例：段序、竖线数＝段数−1、空段无线、提醒格式、无 `rem:` 不出、字号与 `.meta-sep` 样式契约）、`test:ui` 全绿。浏览器实测某行副行 = `2026/12/01 ☰0/1 ｜ 投资 ｜ ●复盘 ｜ ↻每月 ｜ 🕐11/30 09:30`，`sepCount: 4`、`sepBox: 1×9`、`metaFont = dueFont = 11px`。

### 2026-11-16（十三改：读数行报分类 / 标签，子任务补齐三处，快捷按钮加编辑）

**一句话**：列表悬停时的读数行**多了分类与标签**（只写名字、不带 `@` / `+`）；「今日」终于有子任务层级、「即将到期」的展开箭头不再点开为空；行内快捷按钮从三枚变**四枚**（多一枚编辑），优先级下拉**收窄一半**，且鼠标移到下拉上时那组按钮**不再消失**；新建框右侧那串语法提示**整块删掉**。

#### 改动

- **读数行（`.task-meta`）**：截止日之后渲染分类（`.meta-ctx`）与标签（`.meta-tag`，前置 6px 色点、`--dot-edge` 描边，与侧栏圆点同源）。**只写名字** —— `@` / `+` 是 todo.txt 的写法，不搬到界面上。每枚 `max-width: 14ch` + 省略，防止把日期挤出行外。
- **侧栏 / 底栏术语统一**：`+项目` 那组从「列表」改名「标签」（侧栏组名、底部导航菜单的「标签 +」与空态文案、`aria-label`）。「列表」在本应用里专指主区的任务清单，同名两处会让人以为点它回到清单；编辑浮窗早已写「+标签」。
- **「今日」有子任务了**（用户报的 bug）：`App.jsx` 不再对 `view === 'today'` 强制 `depth: 0`，`viewTasks` 对 today 也走 `nestChildren`，收起态在逾期 / 今天到期 / 无日期三组里都生效，↑↓ 导航同步过滤（`filterCollapsed`）。分组仍按紧急度走，但**子任务跟着父任务所在的分组走**（`todayGroups(tasks, today, nesting)`）—— 否则父在「今天到期」、子落「无日期」，展开等于没展开。
- **「即将到期」箭头不再点开为空**（用户报的 bug）：根因是两套口径 —— 箭头按 `childProgress`（全部子任务）出现，渲染只铺「本屏可见」的层级。修法两条：① 新增 `lib/subtasks.js#withDescendants`，父项在本屏时把后代一并带进来（递归；**有搜索词时不补**，搜索是在收窄）；② 箭头改由 `MainList.rowProps` 的 `kidInView` 决定 —— 有子任务落在本屏才画。
- **行内快捷按钮四枚**：新增「编辑」（`store.openEditor`，与双击等价），排在旗标前面。
- **优先级下拉钉住快捷按钮**：菜单挂在 body 上，鼠标移过去就离开本行、`:hover` 失效，按钮当场消失。现在 `openAt(..., { variant, onClose })` 支持登记关闭回调，行上挂 `.is-quick-pinned` 保活，选完 / Esc / 点外面时与菜单一起收。
- **优先级下拉宽度减半**：`ContextMenu` 新增 `variant="compact"` → `.ctx-menu.is-compact { min-width: 92px }`（标准档 184px），四枚小旗不再撑一块空纸。
- **新建框右侧语法提示删除**：`.quick-add-hint` 的 JSX 与 CSS（含窄屏那条 `display:none`）一并删除。占位文字已经说清这一行做什么，chips 预览照旧。
- `styleguide.jsx`：舞台的 `openEditor` 从 `noop` 改成真实状态（`editingTask` + `EditDrawer`）—— 原先点「编辑」毫无反应，CDP 验证不了这条链路。

#### 验证

- `npm test` **781 例**（+15）：`withDescendants` 4 条、视图层级 6 条（今天嵌套 / 分组继承 / displayOrder 同源 / 即将到期带后代 / 搜索不补）、读数行 4 条（不带 `@` `+`、色点只给标签、空态不画、子行不画）、新建框提示 1 条（源码级）。
- `test:ui` 全绿（css-check 无缺失类名 / 对比度 120 组 / 字阶 19 项 / hooks 45 文件）；`test:guard` 49 文件 781 例全跑到；`npm run build` 通过。
- `qa-settings` **48/48**；`qa-responsive` **36 档 / 588 项 0 失败**。
- CDP 实测：今日视图 `t10` 带 `is-child` 子行、收起后两行一起消失；读数行 `投资` + `•回测`、`overflow 0`；快捷按钮 4 枚（编辑/旗标/今天/删除）；优先级菜单 **92px**（原 184）、鼠标移到菜单上 `quickOpacity` 保持 1、选完 `prio-badge` 出现且按钮与菜单一起收；点编辑钮弹出 `.modal`，标题「准备季度复盘材料」，焦点落在标题输入框。

### 取舍

- 「即将到期」选择**把后代带进来**，而不是「干脆不画箭头」：用户想在这屏展开父项看子步骤，藏掉箭头等于回答"这里没有子任务"，是错的。
- 分类与标签只用文字 + 一枚色点区分，不加「分类：」「标签：」这种二级标签 —— 布局本身已经把它们排在一起，再写两遍说明只会把 11px 的读数行撑得更长。

## v1.5.0 · 2026-11-16（界面统一精简：日历只剩网格、窄屏底部导航、列表行版式重做）

**一句话**：v1.4.0 之后半个月的界面收敛一次性放出 —— 日历页只剩网格（点日期弹「当天任务」浮层，拖拽改期与区间条整条退场）、窄屏换成底部导航、列表行压到 32px 且悬停展开读数行全程零重排、子任务行独立单行版式、日期与时刻统一走 `DateField`；同时修掉 CI 断路与 `fs_read`/`fs_write` 的路径白名单缺口。

### 这一版能看见的变化

- **日历**：只剩网格本体。点任意日期格弹出贴格浮层 —— 有任务看列表 + 底部「添加任务」，没任务直接进添加态；任务只在 `due:` 当天出现。
- **窄屏（≤768）**：没有侧栏、没有侧栏开关，视图与标签筛选走底部导航（今日 / 即将到期 / 全部 / 标签），且是网格独立一行，清单再长也压不住。
- **列表**：行高 32px，读数行（截止日 / 完成日 / 子任务进度 / 备注 / 重复）折在标题下方、悬停才展开，展开过程不改任何盒尺寸。子任务行是另一套更紧的单行版式。
- **设置页**：七节固定顺序（列表外观 / 阅读密度 / 显示模式 / 数据 / 全局 / 列表页 / 日历），新增阅读密度三档（28 / 32 / 38）。
- **编辑浮窗**：优先级与重复同行、截止日与提醒同行，日期统一 `DateField`（中文 locale、周一起始）。

### 需要注意的取舍（相对 v1.4.0）

- 日历**不再支持拖拽改期与跨日区间条**，多日任务的 `t:→due:` 区间展示与调整一并撤除；改期走编辑浮窗或文本。
- 日历**不再有快录框 / 右侧日详情栏 / 无日期托盘**，一律从日期格进入。
- 「收集箱」侧栏入口取消（视图逻辑仍在，只是不再有 UI 入口）；「日历」成为侧栏第五个入口，页眉的模式切换控件撤除。
- 对话页（`ChatPanel` / 语言层 / `useChatAgent`）在 v1.4.0 之后已整层退场，本版把残留文案与测试脚本清完。

下面是本版区间内的逐轮改动原文，按日期倒序 —— 保留当时的验证数据与取舍理由，方便回溯每一次判断。

### 2026-11-15（全量体检：CI 断路修复 + 冗余清理 + Rust 文件名白名单）

**一句话**：按当日健康检查报告逐项复核并修复 —— CI 两条流水线不再引用已删除的 `test:nl`；`fs_read`/`fs_write` 加数据文件名白名单；9 组孤儿样式与悬空的 `GROUP_TONES` 删除；「未识别行」不再借用逾期红；欢迎页去掉硬编码个人目录；对话层退场后的失效文案与过期注释清零。

#### 改动

- **CI（P0）**：`build-windows.yml` / `build-macos.yml` 的门禁行去掉 `npm run test:nl`（脚本已随语言层退场删除，此前任何推送都会构建失败）。
- **Rust 安全**：新增 `data_file_name` 白名单（`todo.txt` / `done.txt` / `notes.md` / `session-YYYY-MM-DD.ndjson`），`fs_read` / `fs_write` 改走它 —— 堵住 Windows 盘符相对路径（`C:foo`）绕过 `Path::join` 前缀的口子；`fs_save_as` 的导出名仍走 `safe_name`，不受影响。新增边界单测，Rust 13/13 通过。
- **冗余清理**：删 `.topbar-done-count` / `.ctx-kbd` / `.drawer-preview-text` / `.proposal-actions` / `.settings-badge` / `.settings-warn` / `.settings-check*` / `.tool-input-temp` / `.tool-errors` 九组零引用样式；删 `wallConfig.js` 的 `GROUP_TONES` 与 `ToolsWall` 的 `--tone` 注入（CSS 里 0 次消费）。产物 JS 379.81 → 379.56 kB。
- **UI 铁律**：「未识别行 · 原样保留」分组头去掉 `tone="overdue"` —— 类别不借逾期强色（行内已有 `--warn` 三角记号）；`--danger` 回到只编码逾期与危险。
- **BUG**：`App.jsx` 日历清焦点 effect 的依赖从整个 `store`（每渲染新对象，effect 每帧空跑）改为稳定的 `store.setFocusedId`；`runQuery` 空命中文案去掉「回"是"创建」（对话层已退场，无处可回）与无人消费的 `clarify` 负载。
- **文案/文档**：欢迎页第二步改为「选中放 todo.txt 的文件夹」（原硬编码 `WorkBuddy/todolist` 对分发用户是错误指引）；README 日历段更新为十二改后的契约（网格 + 当天任务浮层，无托盘/区间条/拖拽）、目录结构注明根目录数据文件是占位；`useHotkeys` / `actions` / `eventLog` / `proposals` / `ProposalModal` / `ToolsPage` / `useContextMenu` / `useLayoutMode` 里指向已删模块（ChatPanel / useChatAgent / nlRules / 对话页）的注释全部更新；`.workbuddy/memory/MEMORY.md` 摘要同步为七节设置页。

#### 验证

- `npm test` 49 文件 / 766 例全绿；`test:ui` 全绿（对比度 120 组 / 字阶 19/19 / hooks 45 文件）；`npm run build` 通过。
- `test:settings` 48/48、`test:responsive` 36 档 / 588 项、`test:tools` 73/73、`test:attack` 46/46、`test:guard` 49 文件 / 766 例 —— 全部通过。
- `cargo test` 13/13（含新增白名单边界测试）；`npm audit --omit=dev` 0 漏洞。

#### 仍开着（不在本轮范围）

- 最小 ESLint（rules-of-hooks + exhaustive-deps）未引入；`ProposalModal` / `InlineTitleEditor` 渲染测试空白；dev 依赖 7 条漏洞需 vite/vitest 大版本迁移；外部修改检测仍只在窗口获焦时触发。

### 2026-11-15（十二改：日历页只剩网格，点日期弹「当天任务」浮层）

**一句话**：日历页撤掉顶部「添加任务」框、右侧日详情栏与无日期托盘，**只留日历本体**；点任意日期格弹出**贴格浮层** —— 有任务看列表 + 底部「添加任务」，没任务直接进添加态；**多日区间条与拖拽改期整条删除**，任务只在 `due:` 当天出现和操作（交互范式对齐 Things 3 的 Tasks 日历）。

#### 改动

- 删除 `lib/taskRange.js`（及单测）、`CalendarView` 里的区间条 / 车道算法 / `BAR_TOP` / `LANE_H` / `DRAG_MIME` / `ResizeObserver` 测宽、chip 的 `draggable` / 右键菜单 / `cursor: grab`。
- 新增 `components/CalendarDayPopover.jsx`：导出纯展示的 `DayPanel`（SSR 可测）与 portal 壳。浮层复用 `TaskRow`（勾完成 / 双击编辑 / 右键菜单照旧），底部添加框提交 `store.addTask('… due:<该日>')` —— 与手敲 `due:` 等价，不另造写入路径。
- `lib/placement.js` 新增 `computeDayPopoverPlacement` + `DAY_POPOVER_W/H`：先量后放（挂载后按 `scrollHeight` 重算）、贴格 +4px、末行上翻、右缘夹回、窄屏收宽（下限 160）、矮窗收缩。
- `CalendarView` 的交互只剩一条：格子单击 / 回车 = `openDay(date)`；键盘 `day/select/create` 一律走它（只读态没有添加入口）。格子补 `aria-haspopup="dialog"` / `aria-expanded`，被点中的格子挂 `.is-open`（inset 2px accent）。
- 点**邻月灰格** = 先翻月、再在新格子上重算锚点后弹浮层（`pendingPopRef` 记一笔，交给 `month` effect 补开）—— 沿用旧矩形会浮在旧格子腾出来的空位上。
- 日历里的「新建任务」（`n` 键 / 右键菜单 / 应用菜单）由「往快录框塞 `due:` seed」改为 `addSignal={date, seq}` → 浮层直接进添加态；`App` 删掉 `quickSeed` / `seedSeq` / `quickResetKey`，日历分支不再渲染 `.quick-add-bar`。
- CSS：删 `.cal-range-*` / `.cal-bar*` / `.cal-side` / `.cal-tray*` / `.cal-cell.is-drop` / `--cal-panel-w`；新增 `.cal-pop*` 一族（`position: fixed; z-index: 45`，宽 288、标题行 24px 关闭钮、foot 里输入框或「添加任务」）；触屏档把命中区兜底从托盘项挪到 `.cal-pop-addbtn` / `.cal-pop-add-input`（44px）。
- `styleguide.jsx`：舞台去掉 `seed` / `onCreateDay`，侧栏补 `listMode` / `onPickListMode` 透传（窄边降级那组断言要量「偏好仍是日历」）。

#### 验证

- `npm test` 766 例全绿（`CalendarView.test.jsx` 重写 23 条：42 格 / tab 序列 / chip 档位 / `+N` / 项目色点 / **旧结构不得回流** / 只读态，另有 `DayPanel` 5 条）；`test:ui` 全绿（对比度 / 字阶 19 项 / hooks 45 文件）；`npm run build` 通过。
- `qa-settings` **48/48**：新增「日历只剩网格（无快录框 / 右栏 / 托盘 / 区间条）」「首屏不弹浮层」「点有任务日弹列表 + 添加按钮」「点空日期直接进添加态且输入框聚焦」「点邻月灰格翻月并在新格子上弹出（量 `left` 对齐 + 贴格 + 视口内）」；窄边那条「三处开关仍显示日历偏好」按新入口改为读侧栏「日历」条目。
- `qa-responsive` 36 档 / 588 项 0 失败；CDP 目检：1280（网格铺满、无右栏）、390（浮层完整在屏内）、深色、「点 10/26 灰格 → 翻到 10 月、浮层落在该格下方 4px」。

#### 取舍

- 浮层是**临时视图**，状态留在 `CalendarView` 内、不进 store：它不为"记住刚才看了哪天"服务，进 store 只会多一份要清理的状态。
- 没有做「点灰格只翻月不弹」的省事版：用户点它就是想看那一天，代价只是多一次 `pendingPopRef` 记账与一轮重新量锚点。
- chip 变成纯读数（无点击 / 拖拽 / 右键）：格子的单击已经有明确含义，chip 上再挂动作两者会互相打架。

### 2026-11-15（十一改：标题行 / 轨距收紧，窄屏换成底部导航）

**一句话**：标题行 44 → **35**（−20%）、轨内行距 44 → **31**（−30%）、图钉随轨**倾斜 45°**；窄屏**撤掉侧栏与侧栏开关**，把「今日 / 即将到期 / 全部」搬到窗口最下沿做成**纯图标按钮条**，中间加一枚「标签」按钮向上弹出分类与列表的筛选菜单。

#### 改动

- `--titlebar-h` **44 → 35**（44 × 0.8）；`tauri.conf.json` 的 `trafficLightPosition.y` 24 → **20** —— 两者成对改，否则红绿灯偏出标题行中线。
- 新增 `--rail-row-h`(31 = 44 × 0.7，轨内行距与窄屏页签条行高)、`--rail-tab-size`(30 见方)、`--bottomnav-h`(48，等于触屏命中区)。
- 置顶图钉加 `.pin-tilt { transform: rotate(45deg) }`：只转图形，按钮命中区仍是正方。
- 新增 §10「窄屏底部导航」整节：`.bottom-nav`（默认 `display: none`，窄屏 `grid-row: 3`、带标题栏时 `4`，`grid-column: 1 / -1`）、`.bnav-item`（`flex: 1 1 0`）、`.bnav-item.active::after`（**固定 24px 居中**短横线，不用百分比 —— 600px 档会横穿图标）、`.bnav-labels::before`（视图与标签之间的竖分隔线）。
- 窄屏媒体查询重写：`.app` 四行 `--titlebar-h var(--rail-row-h) minmax(0,1fr) auto`；`.panel-toggle { display: none }`（侧栏开关退场）；`.sidebar { display: none }`（旧的「侧栏转横向过滤条」整段删除）；`.tab` 收到 30 见方。
- 新增 `components/BottomNav.jsx`：四枚纯图标按钮（今日 / 即将到期 / 全部 / 标签），文字只在 `aria-label` / `title`；标签菜单复用 `useContextMenu`，从按钮顶沿**向上弹**。
- `lib/placement.js` 新增纯函数 `computeMenuPlacement(x, y, menu, viewport, place, margin)`：把 ContextMenu 里原来内联的「先量后放」抽出来，并支持 `place: 'above'`（`top = y - height`）；`ContextMenu` / `useContextMenu.openAt` 透传 `place`。
- `Icon` 新增 `tag`（lucide）。
- `styleguide.html`：窄屏隐藏指南自己的 `.sg-nav` 并让 `.sg-stage` 用 `100vh` —— 它在 390px 上折成三行（120px），会把演示区顶出视口、底部导航掉到屏幕外（正是首次跑 qa-responsive 17 项失败的根因）。

#### 验证

- 811 例单测全绿（新增 `BottomNav.test.jsx` 18 条、`placement.test.js` 5 条）；`test:ui` 全绿（对比度 120 / 字阶 19 项 / hooks 44 文件）。
- `qa-responsive` 36 档 / **601 项 0 失败**：新增断言「标题行 = 35」「宽屏不显示底部导航」「窄屏不显示侧栏与侧栏开关」「页签条 ≤34」「底部导航 4 枚按钮均分整宽、贴住 shell 下沿、列表不与它重叠」。
- 带标题栏的窄屏骨架实测：`rows = 35 31 730 48`，`titlebar y0 h35 / tabs y35 h31 / workspace y66 h730 / nav y796 h48`，`vh 844` —— 严丝合缝。
- 标签菜单实测：`x=200 y=563 w=184 h=234`，菜单底沿 797 ＝ 按钮顶沿 797，完全在视口内。
- CDP 目检：390（三行头 + 9 行列表 + 四按钮条）、标签菜单上弹（「分类 `@`」「列表 `+`」分组、色点、对勾）、600（侧栏消失、按钮变宽）、1280（底部条不显示、轨内图钉倾斜）、390 深色。

#### 取舍

- 「清单多时不被按钮压住」用的是**网格独立一行**，不是 `position: fixed` + `padding-bottom`：后者滚到底仍会有行从条子后面滑过。代价是工作区实际高度少了 48px，窄屏首屏少一行左右。
- 标签菜单挂在窗口最下沿，只能向上弹；`computeMenuPlacement` 因此加了 `place` 参数，而不是在 BottomNav 里自己算一遍坐标。

### 2026-11-15（行距再收 20%、读数行改成零重排的绝对定位）

**一句话**：列表行高 40 → **32**（行距再收 20%），同时把读数行从「收 `max-height`」改成**绝对定位 + 只动 opacity / transform** —— 悬停展开时行高、行位置、相邻行一格不动，`layout-shift` 全程 0。旧版虽然行高也恒定，但每帧都在改这一格的盒尺寸、整行重排，鼠标扫过与滚动时发涩，读起来像「列表在抖」。

#### 改动

- `--row-h` 默认 **40 → 32**（`lib/readingDensity.js` 三档同步改成 28 / 32 / 38）；`.task-row` 纵向内边距 **3px → 0** —— 32px 里要同时装下 14px 标题（行盒 17.5）与 11px 读数行（行盒 13），留着 3px 就必然撑破。
- `.task-meta` 改为 `position: absolute`（左缘 = 行内边距 + 复选框列 + 列间距 + 旗标槽，右缘止于箭头槽），高度固定 `--meta-h`(13)；收起态 `opacity: 0` + `translateY(2px)` + `pointer-events: none`（看不见时不能替这一行吃掉点击）。
- `.task-head` 悬停 / 键盘聚焦时 `translateY(calc(var(--meta-lift) * -1))`（6px）给读数行让位 —— 走的也是 transform，**不产生任何重排**。
- 新增令牌 `--cb-size`(18，复选框列宽，读数行靠它算左缘)、`--meta-lift`(6)。`--meta-h` 语义从「max-height 上限」改成「读数行固定高度」。
- `.cal-day .task-row` 的左右内边距与列间距取 `--sp-3`：触屏上勾选框命中宽 = 左内边距 + 列间距 + 19，8 + 8 只有 35px（够不到 40 的手感线），12 + 12 回到 43。
- 子任务行 `--row-child-h` 从「主行 − 8」改成「主行 − 6」（40/32 → 32/26），保持矮一档。

#### 验证

- 788 例单测全绿；`test:ui` 全绿（对比度 120 组 / 字阶 19/19 / hooks 43 文件）；`test:guard` 49 文件 / 788 例；`test:responsive` 36 档 / 523 项 **0 失败**；`vite build` 通过。
- CDP 实测（`?view=list-all`，目标行＝红旗 + 逾期）：
  - 行高：主行 **32**、子行 **26**，14 行只有这两种高度；
  - 静止 vs 悬停：全部行的 `top` / `height` **逐行完全相同**（`true`），移开后亦 `true`；
  - `PerformanceObserver` 的 `layout-shift`：悬停全程 **0 条 / 总和 0**，连续 40 格滚动过程中仍 **0**；
  - 过渡曲线（rAF 采样）：`opacity 0 → 1`、`headTranslateY 0 → -6px`，行高全程 32 不曾变化；
  - 收起态读数行 `pointer-events: none`，`elementFromPoint` 命中 `.task-row` 而非日期；
  - 触屏（390 / `pointer: coarse`）：行高 44、读数行常驻（`opacity: 1`）。

#### 取舍

- 32px 行里两行内容只能「贴着排」：悬停时标题上移到行顶、读数行贴行底，视觉间隙约 2–3px。这是「行距恒定 + 标题居中」同时成立时的唯一排法；若希望间隙更宽，只能加大行高或缩小字号，两者都会破坏本轮的目标。

### 2026-11-15（日期行收放取消所有例外：逾期行 / 带红旗的行一视同仁）

**一句话**：`is-pinned` 那套「常驻展开」的后门整条删掉 —— 逾期行、带红旗的高优先级行、以及两者兼有的行，现在和普通行一样：默认收起、悬停淡入、移开收回。上一版只有「只挂日期」的行参与收放，逾期行永远摊着，读起来像功能只覆盖了一半。

#### 改动

- `TaskRow.jsx`：删掉 `hasMetaMarks` / `metaPinned` 与 `.task-meta.is-pinned` 的类名拼接，读数行恒为 `class="task-meta"`。**状态只改颜色与记号，不改交互**。
- `index.css`：`展开` 选择器组从 `:hover / :focus-visible / .is-pinned` 收回成前两条；注释同步说明「没有例外」。`@media (hover: none)` 的常驻兜底保留（触屏没有悬停这回事）。
- `TaskRow.test.jsx`：原「逾期行常驻 / 三类记号常驻」两条用例改写为「逾期、红旗（高/中/低）、红旗+逾期、进度/备注/重复，一律不加 `is-pinned`」，CSS 契约加断言 `not.toContain('.task-meta.is-pinned')`。

#### 验证

- 787 例单测全绿，`test:ui` 全绿（对比度 120 组 / 字阶 19/19 / hooks 43 文件），`test:guard` 49 文件 / 787 例，`test:responsive` 36 档 / 523 项 0 失败。
- CDP 实测（styleguide `?view=list-all`，样张「季报复核」＝红旗 + 逾期）：
  - 静止：`max-height: 0px`、`opacity: 0`、行高 40 —— 与普通行完全相同；
  - 悬停：`max-height: 14px`、`opacity: 1`、标题上抬 6px，**行高仍 40**，相邻行位置不动；
  - 移开：回到 `0px / 0`，无残留。

### 2026-11-15（子任务行独立版式：单行 32px、只留复选框 + 标题）

**一句话**：子任务行不再套用主行的「标题 + 读数行」两行版式，改成**独立单行** —— 只有复选框与标题、两者同轴居中，行高比主行矮 8px（默认 32，跟着「阅读密度」缩放）、复选框 14px（主行 18，配 12px 子任务字号），日期 / 旗标 / 进度 / 备注 / 重复一概不上屏，悬停也不浮出任何浮层与提示。

#### 列表行

- **结构分叉**：`TaskRow` 里 `isChild` 走单独的 `span.task-body.child-body`，主行那套 `.task-head` + `.task-meta` 子树**根本不渲染**（不是 CSS 藏起来）—— 所以不存在「子任务行里漏出一行日期」这种可能。子任务行的读数数据仍在 `task` 上，只是不画。
- **版式**：`.task-row.is-child` 两列网格（`var(--cb-child)` + 正文）、`min-height: var(--row-child-h)`、缩进 28px、字号 `--fs-list-child` + `--muted`；复选框 `--cb-child`(14px)、对勾 mask 从 11px 缩到 9px。新增令牌 `--row-child-h: 32px` / `--cb-child: 14px`。
- **不弹东西**：子任务行不渲染 `.row-quick`，勾选框也不挂原生 `title`（只留 `aria-label`）—— 子任务悬停只留一层极浅底色。
- **触屏兜底**：`pointer: coarse` 下子行回到 44px 行高，勾选框的命中外扩单独调到 `inset: -16.5px`（14px 的框沿用 -14.5px 只够 40px）。

#### 验证

- 786 例单测（新增 5 条：单行结构、不画旗标、不渲染 row-quick 且无 `title`、日期/备注/重复不上屏、CSS 契约）、`test:ui` 全绿（对比度 120 组 / 字阶 19/19 / hooks 43 文件）、`test:guard` 49 文件 / 786 例、`test:responsive` 36 档 / 523 项 0 失败、`vite build` 通过。
- CDP 实测：主行 40px / 子行 32px、勾选框 14×14、勾选框中心与标题中心同为 y=299（同轴）、子任务标题左缘 270 与主行标题左缘 268 基本对齐、子行内 `.task-meta` / `.row-quick` / `[title]` 均为空。

### 2026-11-15（读数行默认收起：悬停 / 键盘聚焦才弹出日期）

**一句话**：标题下方那行日期改成**默认收起**，鼠标移到某一行才淡入弹出、移开自动收回 —— 列表平时只剩标题，扫起来更干净；收放只动读数行自己那一格，**行高恒定 40px、邻居一格都不动**（行高若跟着悬停变，鼠标往下扫时下面每条都会被顶着走）。

#### 交互与视觉

- `.task-meta` 收起态 = `max-height: 0` + `opacity: 0` + `translateY(-2px)`，展开态回到 `--meta-h`(14px)；过渡 `--dur-2`(160ms) `--ease-out`，CDP 实测 0 → 13.99px 逐帧插值、标题上抬 6px，不是瞬切。
- 触发条件是 **`:hover` 与 `:focus-visible`**：鼠标移上去看，键盘用户用 ↑↓ 聚焦同样看得到。快捷按钮仍只认悬停（`:focus-within` 那条不回来）。
- 行外框高度不变（`min-height: var(--row-h)` + `justify-content: center`），所以收起态标题与复选框同轴（实测 342 / 343），展开时标题抬 6px 让出读数行 —— 动作全在这一行内部发生。
- **两类行常驻展开**（`.task-meta.is-pinned`，判定在 `TaskRow`）：① 逾期行 —— 红色日期是整屏唯一强色，收起来等于逾期看不见；② 读数行带**子任务进度 / 备注 / 重复**记号的行 —— 那是功能线索不是装饰，悬停才出现等于平时没有。只有「只挂日期」的行才真正收起。
- `@media (hover: none)` 兜底：触屏 / 无悬停设备一律常驻，否则日期在平板上永远取不到。
- 样式指南样张补一条未来截止日的任务（`结算上月交易流水`，2027-01-05）：原来那批日期全在 9~10 月、一律逾期（逾期常驻展开），只看它们会以为「日期行永远在」。

#### 验证

- 781 例单测（新增 5 条：只有日期的行不加 `is-pinned`、逾期常驻、进度/备注/重复常驻、日期仍在 DOM、CSS 契约含 `@media (hover: none)`）、`test:ui` 全绿（对比度 120 组 / 字阶 19/19 / hooks 43 文件）、`test:guard` 49 文件 / 781 例、`test:responsive` 36 档 / 523 项 0 失败、`vite build` 通过。
- CDP 实测：收起 0px/0 → 悬停 14px/1 → 移开 0px/0；悬停前后各行 `top` 完全一致（无重排）；键盘聚焦时读数行展开而快捷按钮仍 `opacity: 0`。

### 2026-11-15（列表行改版：旗标＝优先级、箭头＝展开、读数折到标题下方）

**一句话**：按参考稿重排列表行 —— 每行两行（标题 + 读数），优先级从「3/2/1 枚橙色感叹号」换成**标题最左边一枚中空旗**（高红 / 中橙 / 低蓝，「无」不画）；展开 / 收起从「整行单击」改成**行尾那枚三角箭头**；日期字号更小、颜色更浅、折到标题下方且只逾期变红；行内快捷按钮改为**只随鼠标悬停浮出**，其中旗标按钮点开是「高/中/低/无」四色下拉。

#### 列表行

- **两行结构**：标题一行；读数行（截止日 · 完成日 · 子任务进度 · 备注 · 重复）折到标题下方、左对齐跟着标题走。行高仍由 `--row-h`(40) 兜住 —— 标题行高收到 `--lh-tight`、读数行 11px、纵向内边距 3px，加起来正好 40，列表密度不变。
- **优先级 = 旗标**：`PriorityMark` 的 badge 形态从「感叹号枚数」改成「一枚中空旗 + 档位颜色」（`--flag-high|mid|low`，明暗两套）。旗标占固定的 18px 槽（`--flag-slot`），所以有旗没旗的行标题都在同一条竖线上；读数行让过同一槽宽，日期不会跑到旗标底下。`priorityBangs()` 删除。
- **展开 / 收起**：行尾新增 `button.row-expand`（收起朝下、展开原地转 180°，`--dur-2` 过渡）。**整行单击不再接管子列表**，父项行拿回普通行的点击语义（快双击进浮窗、慢双击改标题）；键盘 `→` / `←` 展开收起。箭头独占网格第三列，快捷按钮靠它让位，两者永不重叠。
- **子任务进度**：`0/2` 前面加一枚 `list-tree` 小记号，原来那枚 chevron 退场（它已经不再是展开入口）。
- **读数行配色**：截止日 `--fs-2xs` + `--muted`，**只有逾期换 `--danger`**；「今天」不再单独染色（一屏里第二支强调色会盖掉真正要动手的逾期）。
- **行内快捷按钮**：删掉 `.task-row:focus-within .row-quick` —— 只有鼠标悬停才浮出，键盘用 ↑↓ 扫列表时右侧不再有按钮跟着闪。第一枚旗标按钮改为打开优先级下拉（红/橙/蓝/黑四枚旗 + 高/中/低/无），复用同一个上下文菜单渲染器（↑↓ / Enter / Esc 现成）。
- **`star:` 旗标退场**：列表行、编辑浮窗标题栏、行内快捷按钮三处图形入口全部删除 —— 旗标此后只表示优先级，同一行摆两支红旗会让人分不清哪支是急、哪支是标记。**数据不删**：解析 / 写回 / `form.starred` 透传原样保留。

#### 门禁

- `qa-contrast` 新增 `--flag-high|mid|low` 三组对 `--surface` 的 3:1 校验（现在 120 组）。
- `qa-typography` 的 600 白名单里 `.prio-badge.prio-high` 已不成立（旗标不再加粗），白名单保留未清。
- 验证：776 例单测、`test:ui` 全绿、`test:guard` 49 文件 / 776 例全跑到、`test:responsive` 36 档 / 523 项 0 失败、`vite build` 通过；CDP 实测行高 40px、悬停按钮右缘 860 与箭头左缘 864 不重叠、键盘焦点下按钮 opacity 0。

### 2026-11-15（用户评审回退：顶栏主段恢复 16px、组头分区带撤销）

**一句话**：两处视觉实验被用户评审否掉，回退并钉回门禁 —— 上下文条主段 13px 撑不起 36px 顶栏（显得又空又高），恢复 16px（--fs-lg）；组头「分区带底色 + 吸顶」在纸面上太吵，撤销带底与吸顶，保留左缘文字列对齐与收紧后的留白。

- `.crumb b` 恢复 `--fs-lg`；`qa-typography` 与 `qa-settings` 的主段断言同步钉回 16px。
- `.group-title` 回到无底静态组头（`position: static`、无 background / border-bottom）；`.group-overdue` 只留红字 + 红竖记号。
- 验证：763 例单测、test:ui 全绿、test:responsive 36 档 / 533 项 0 失败、test:settings 45/47（仅两条日历既有红灯）；macOS 包重出并覆盖安装，内嵌前端 hash 与 dist 比对一致。

### 2026-11-14（视觉精修：行高收紧、左缘文字列对齐、节奏降噪）

**一句话**：不改功能的一轮 redline 精修 —— 列表默认行高 44→40（触屏 44 兜底不动），组头与欢迎页节奏收紧，组名 / 快录提示 / 任务标题三条左缘文字列归到同一条竖线；阅读密度的「标准」档同步跟随新默认。

#### 间距与密度

- `--row-h` 默认 44→40：单行 14px 正文配 44px 行高留白偏大；`pointer: coarse` 的 44px 命中兜底原样保留，日历日详情行随令牌一起收紧。阅读密度三档改为 36 / 40 / 48（`lib/readingDensity.js` 与单测同步）。
- 组头 `.group-title` 上下留白 16/8 → 12/4：每组省 8px，分组仍比组内行距松一档。
- 工具墙底部留白 48→32；欢迎页步骤行高 1.8→1.55、纸页下第二条图注间距 8→4。

#### 对齐

- **左缘文字列统一**：组名文字对齐任务标题列（`gap: calc(18px + var(--sp-3) - 3px)`，竖记号仍留在行首）；快录框左内边距 12→8、图标间隙 8→6，提示文字与任务标题同列。此前组名 / 标题 / 快录提示三个起点相差最多 25px。

#### 审计后保留不动

- 侧栏（最密区，组间 / 组内间距比例成立）、编辑浮窗（双列字段节奏成立）、meta 簇（优先级固定宽 + 右缘直线已由门禁钉死）、滚动条与选区（早已令牌化安静处理）、色板 / 字阶 / 圆角 / 动效（冻结契约）。

### 2026-11-14（设置页新增「阅读密度」：侧栏 / 列表的字号与行距）

**一句话**：设置页多一节「阅读密度」—— 侧栏与列表各有字号（小 / 标准 / 大）与行距（紧凑 / 标准 / 宽松）三档可调；每档按钮自带样张、下方迷你登记簿实时预览，全程没有数值输入。偏好走 configStore，不写进 todo.txt。

#### 界面

- **新节插在「列表外观」之后**：两列（侧栏 / 列表）× 两行（字号 / 行距），每行一组三档按钮。字号按钮按该档真实字号画「A」，行距按钮按该档真实疏密画三线 —— 点之前看到的就是点之后的。
- **实时预览**：一本迷你登记簿（左目录右列表，含子任务与逾期行），行高 / 字号按当前组合真实渲染，换档即变。
- **「恢复默认」只在非默认时出现**（与色板「自动」出口同一判据）；清除的是落盘本身，不是「存一份默认」。
- 档位映射：字号 13 / 14 / 16（冻结字阶里选档，不改数值），子任务恒小 2px；侧栏行高 22 / 26 / 32，列表行高 36 / 40 / 48。

#### 数据层

- 新增 `lib/readingDensity.js`：configStore 键 `worktodolist.reading-density.v1`（一个能力一个键），档位 → `--pref-*` 偏好变量；`index.css` 基础令牌以 `var(--pref-*, 默认)` 消费 —— 没设置 = 不写变量 = 走令牌层默认，QA 新 profile 几何一字不差。
- **触屏兜底天然压过偏好**：`@media (pointer: coarse)` 直接重写 `--row-h: 44px`（同特异性、源码序更后），选「紧凑」也不会把触屏命中区压到 44 以下。
- `.task-title, .nav-item` 共享规则拆出字号：默认仍同档（--fs-md），两边可各自换档；族 / 字重仍共享一条。

#### 门禁

- `qa-settings`：分组等式六节 → 七节；新增阅读密度断言（12 颗按钮 / 4 档按下 / 预览 3+3 / 默认无恢复出口）与交互链路（点「宽松」→ 预览行高变大 + `--pref-nav-h` 落到 `<html>`；「恢复默认」→ 变量移除）。
- `qa-css-check`：运行时拼接值白名单补 `density-a-s/m/l` 三档样张。
- 新增 `lib/readingDensity.test.js`（归一化 / 档位映射 / 偏好变量 / apply 写删）与 `SettingsPage.test.jsx` 阅读密度渲染契约。

### 2026-11-14（上下文条重排：删掉概览与状态栏，搜索收成放大镜）

**一句话**：竖向只留「上下文条 + 内容」两层 —— 今日概览条与底部状态栏整行移除，任务行占满窗口；搜索从常驻输入框收成一枚放大镜，排序从「排序 · 手动」文字按钮收成图标钮，页眉左右各归一组。

#### 界面

- **今日概览整块移除**（`Overview` 组件、`.overview*` / `.stat*` 样式、`--overview-h` / `--overview-handle-h` 令牌、styleguide 的 `list-panel` 视图与响应式 `desktop-1280-panel` 档）。
- **底部状态栏整行移除**（`Footer` 组件、`.statusbar*` 样式、`--status-h` 令牌、三态圆点）：`「手动重载」「切换目录」与保存状态读数搬进设置页新增的「数据」节。
- **上下文条重排**：左＝面板开关 · 列表/日历 · 面包屑，右＝放大镜 · 排序，五枚控件统一为 `.ctx-btn.ctx-btn-icon`（新增令牌 `--ctx-btn-h`＝26px）。
- **搜索不再常驻**：平时只有一枚放大镜，点它（或 `/`、行右键菜单、应用菜单「搜索」）才挂出输入框；关闭时连关键词一起清空。
- **排序收成图标钮**：自动＝`arrow-up-down`、手动＝`grip-vertical`，`data-sort` 标当前档；日历里不出这枚钮。
- **面包屑只留「我在哪」**：标题（+项目带色点）+「N 项」，删掉「/ 到期与逾期」「/ 分类过滤」「/ 只读投影」这类第二段。

#### 门禁

- `qa-css-check`：`dot-ok / dot-warn / dot-danger` 移出运行时白名单（随底栏删除）。
- `qa-settings`：分组等式由五节改六节（新增「数据」、「数据」节两颗按钮有断言），页头说明仍须含「只读」。
- `qa-responsive`：探针去掉 `.overview` / `.statusbar`，删掉 `list-panel` 档（36 档 / 533 项）。
- 新增 `src/components/TopBar.test.jsx`（9 例：搜索默认只有按钮、点开才出输入框、排序两副图标、面包屑无描述段、左侧／右侧分组顺序、三枚钮同族）与 `SettingsPage.test.jsx`（5 例：数据节两颗按钮、保存状态读数、分组顺序、App 里不再挂底栏）。

#### 验证

`npm test` 48 文件 / **746 例**；`test:ui` 全绿（无缺失类名、无裸值、对比度 AA、排版 19/19、Hooks 48 文件）；`build` 通过（CSS 100.96 → 98.89 KB，JS 381.77 → 381.03 KB）；`test:guard` 48/746；`test:responsive` **36 档 / 533 项 0 失败**；`test:tools` 73/73；`test:settings` 40/42（剩 2 条日历既有红灯，与本次无关）。CDP 实测 1280 / 390 两档页眉几何：三枚图标钮均 26×26、右对齐且无横向溢出。

### 2026-11-14（剥离对话页：应用回到「列表 + 工具」两个页签）

**一句话**：把「用一句话改 todo.txt」整条链路从代码里摘掉 —— 界面少一个页签、设置页少一节、主包少约 49 KB；改数据的能力一条不少，全部收口到列表页与工具页。

#### 移除

- **界面**：对话页签、消息流 / 快照列 / 命令提示浮层（`ChatPanel`、`ToolCallCard`），以及 `index.css` 原 §5 整章（约 575 行）与窄屏、中等屏、触屏三处的对话特化规则。
- **逻辑**：会话状态机 `useChatAgent`、中文意图解析 `nlRules`（1.4k 行）、工具路由匹配 `toolMatch`（早已无引用的遗留）。
- **设置项**：设置页「对话页」快捷键组；`Ctrl + 1 / 2 / 3` 收敛为 `Ctrl + 1 / 2`。
- **门禁**：`test:nl`（覆盖/漂移/留出集）、`test:attack-chat` 三个脚本；`qa-settings` 的分组等式由六节改为五节，`qa-tools` 的页签断言由三改二，`qa-responsive` 撤掉三档对话场景与对话几何断言，`qa-typography` 撤掉 `.chat-empty-title`。
- **依赖面**：无生产依赖新增或删除（对话本就是本地规则引擎，不联网、无 SDK）。

#### 保留（被工具链共用，删了会连坐）

- `lib/actions.js`：`dispatch` + ACTIONS 表仍是工具提议落盘的唯一执行入口，只删掉对话专有的多轮澄清函数 `pickByReply`。
- `lib/eventLog.js` / `lib/toolEvents.js`：工具动作的 append-only 事件线照旧写入；只删掉对话专用的 `replay` 与跨写序列交接 `drainLastToolSeq`。
- `lib/proposals.js`、`todoTools/ops.js`：提议与批量原语不动。

#### 新增

- `src/lib/actions.test.js` 重写为「工具提议 → dispatch」路径：用真实 `parseFile` 造任务，覆盖 create / edit / batch / 不适用 / 未知意图 / undo 九例 —— 对话测试删掉后，`dispatch` 仍被钉子钉住。

#### 验证

`npm test` 40 文件 / **656 用例**（原 827，减掉对话与中文解析的 171 例 + 新增 9 例）；`test:ui` 全绿（css-check 无缺失、对比度 AA、typography 19/19、Hooks 41 文件）；`test:guard` 40/656；`test:attack` 46/46；`test:tools` 73/73；`test:responsive` **37 档 / 546 项断言 0 失败**；`test:settings` **38/41**（仍是日历四档记号 / 跨天区间 / 虚线空框那 3 项既有红灯，无新增）。产物：主 JS `428.32 → 378.82 KB`，CSS `110.49 → 101.59 KB`。

### 2026-11-12（墨绿账簿 + 日历可拖区间条）

**一句话**：视觉语言从「冷灰仪器」换成「墨绿账簿」（暖纸面 + 墨绿强调），列表 / 浮窗 / 对话同步降噪；日历的任务标签升级为贯穿多日的可拖区间条 —— 拖两端改时长、拖条身保时长平移，单日任务拖边缘即长出区间。

#### 视觉语言：墨绿账簿

承「工作登记簿」的产品灵魂与外壳骨架，换掉色彩与密度：

- **暖纸面中性色 + 墨绿强调**（浅 `#1e6b4f` / 暗 `#6cc59c`）。红仍只属于逾期 / 危险，绿只属于今天 / 选中 / 完成；明暗两套令牌同步换血，对比度门禁 110 组全过。
- **列表降噪**：无优先级留白不画虚线框；逾期去红底药丸改红字（分组头红一次）；新增 mono 行号 gutter 呼应 todo.txt「一行一条」；内容收进 1080px 居中栏。
- **编辑浮窗**：固定头 / 可滚 body / 固定底栏三段式，保存永在首屏；优先级 + 截止日、提醒 + 重复、分类 + 标签三组双列；标签解释缩为灰字。
- **对话页**：用户消息气泡化；AI 字母头像换墨绿记号；工具卡收成单行可展开记录；错误只红记号不红整句。

#### 日历：可拖拽多日区间条

任务标签不再固定在单日 —— 有 `due:` 的任务统一渲染成贯穿多日的连续条（单日任务是 1 天的条），区间 = `[t: 起点, due: 终点]`：

- **拖两端改时长**：起点最多拖到终点、终点最多拖到起点，钳制不交叉（永不产生无效区间）；拖动中实时预览，松手一次性写盘。单日条拖边缘即长出区间（自动补 `t:`）。
- **拖条身保时长平移**：整条移到新日期，起止同移、时长不变。与 chip / 托盘拖放（只改终点 + 钳起点）是两种刻意不同的改期语义。
- **跨周连续 + 车道分配**：条按周行断段续接（续段画刻痕、不放假手柄）；重叠任务全局贪心分车道，翻月车道号稳定；车道上限随行高自适应，溢出进「+N」，日详情列出覆盖当天的中途任务。
- **边界**：62 天上限拖动钳制 + 提示；超长现值折叠为单日条可拖回；无效区间降级虚线条走菜单修复；重复任务拖终点 toast 提示锚点已移；松手按 id→stableId 重取任务防外部重载失效。
- **降级守约**：窄屏（≤768）条整体隐藏退回 chip 色点；已完成视图只读不渲染条；`groupByDate` 单 key 聚合与 EditDrawer 无阈值字段的契约一字未动。
- 语义全落纯函数 `lib/taskRange.js`（resizeRange / moveRange / rescheduleWithRange / rangeBars / barSegments / rangesCovering），新增 31 条单测；pointer 拖拽与既有 HTML5 chip 拖拽并存。

#### 编辑浮窗与列表细节打磨

- **日期读中文「年月日」**：截止日 / 提醒时刻改成中文格式按钮（`2026年10月10日`），点按调系统原生 picker（`showPicker`，旧内核回落 focus+click）；存储仍是 ISO，数据层零改动。
- **备注默认展示、点按才编辑**：浮窗里备注先以只读块呈现内容，旁设「编辑 / 添加」按钮，点击才切到 textarea，「完成」收回展示 —— 不再一打开就是一大块输入框。
- **标题移进固定头部**：浮窗头部即可直接编辑标题，body 滚动时标题始终可见可改；底部「写入行预览」压成单行、弱化展示，不再抢表单的注意力。
- **子任务进度条**：浮窗子任务区加完成占比细线（accent 填充），配 `1/3` 计数一眼读出进度。
- **侧栏行距降 20%**：`--nav-h` 32→26，分类 / 列表目录更紧凑（触屏 44px 命中区兜底不变）。
- **列表子任务次级层级**：子任务经 `nestChildren` 紧随父任务出场（父不在本屏降级顶层、绝不消失）；缩进加深 + 小一档字号 + 淡字色，左缘只用一条极淡竖向参考线暗示从属（不画横向短线，避免把子任务推到前台）。

## v1.4.0 · 2026-11-11（工作登记簿与日历）

**一句话**：界面按「工作登记簿」的语言整体重做 —— 行号 │ 源文本行、颜色只编码状态、四档优先级徽章；列表多出日历显示模式与窄边自动降级；同时清掉 4.7 GB 脏产物与 10 处死代码，CI 的 Node 版本与平台依赖问题一并修正。

### 视觉语言：工作登记簿

上一版把 `(A)` / `(B)` 这类**存储格式**当显示用，颜色还把每个元信息都染上底色，看久了只觉得吵。这一版把界面当账本做：

- **签名是「行号 │ 源文本行」**。原文只出现在展示文件内容的地方（写入行、纸页、语法提示）—— 这些场合要逐字可信；界面读数则要让人读懂，所以优先级读**高 / 中 / 低**，不印 `(A)`。
- **四档字阶徽章**：无 = 虚线空框、低 = 400 浅字、中 = 500 细描边、高 = 600 实心底反白，全中性墨。单一真相源 `lib/priority.js` → `PriorityMark.jsx`，旧的 `p-A` / `p-B` / `p-C` 类名作废。
- **颜色只编码状态**：逾期是整行唯一的强色，accent 只用于选中 / 今天 / 焦点，其余一律中性。颜色一旦兼职装饰，就再也读不出预警告。
- **两族字体分工**：`--font-ui` 管文字，`--font-mono` 只管读数（另有中文回退 `--font-mono-cjk`）。8 档字阶数值冻结，`600` 只给白名单选择器；字体取自系统栈，不打包 webfont。
- 图标 12 / 16 / 24 描边 1.5，圆角 4 / 6 / 8 / 12 / 16，`--nav-h 32`、`--row-h 44`，间距一律落在 4 的倍数上。

### 日历：列表的第二种显示模式

日历**不是第四个页签**，而是列表换了种摆法 —— 同一份数据、同一套行组件，只是按日期归位。模式存 `configStore`（`worktodolist.list-mode.v1`），顶栏、侧栏、快捷键三处入口读同一份。

- **选中日是唯一真相**：月份由选中日派生，恒 42 格，翻月不丢选中；「今天」条只负责跳回。
- **语义分工**：在列表里「今天」是到期今日，在日历里放宽为全部未完成 —— 看板要的是这一天有哪些事，不是哪些事今天到期。
- **已完成按完成日期锚定且只读**：勾选记录的是「哪天做完的」，日历按这个日子归位；月视图里不提供完成/删除入口，避免在错误的日期上改历史。
- 语义全部落在纯函数 `lib/calendar.js`（本项目没有 jsdom，不为日历装 DOM 依赖），交互与渲染分离。

### 窄边自动降级

窗口拖窄到放不下双栏时，界面前几版会硬挤，读不出重点。现在三档优先级：**手动覆盖 > 窄边降级 > 用户偏好**。

- 进入 `< 480` 降级、退出 `> 560` 恢复 —— 两档之间留出滞回区间，避免在临界值来回抖。
- 观测的是 `<main>` 的宽度（`ResizeObserver`），不是 `window.innerWidth`：侧栏展开 / 收起同样改变可用宽度，只盯窗口尺寸会漏。
- **关键约束：显示模式是持久化偏好，永不因窗口宽度改写**。降级只是渲染层的一层覆盖，窗口拉宽后回到你自己选的那个模式，不会被窄边「教会」成另一种。

### 仓库整理与构建链修正

- **4.7 GB → 99 MB**：删掉 `src-tauri/target`（debug + release）、`.tmp`、`qa-artifacts`、`dist` 等可重建产物；仓库里移除 4 个文件 —— v1.0.4 的 exe 快照（与当前差三个版本，分发走 Releases）、零引用的图标预览图、被 `reminder.rs` 取代的 `daily_reminder.py`、被 `useLayoutMode` 取代的 `useMediaQuery.js`。
- **删 10 处确认零引用的导出**，最大一处是 `lib/proposals.js` 的三个从未被调用的工厂（233 → 103 行）。构建产物 hash 未变，反证这些代码在树摇时本就没被打包。
- **CI 钉着 Node 20，而代码要 22**（QA 脚本用了 `node:fs` 的 `globSync`，Node 22 才导出）——两条流水线升到 22，`package.json` 补上此前根本不存在的 `engines.node >= 22`。
- **`@esbuild/win32-x64` 挪进 `optionalDependencies`**：macOS / Linux 上 `npm ci` 不再 `EBADPLATFORM`，`npm ci --force` / `npm install --force` 那套绕法全部退休。
- **提醒计划任务去掉 Python 依赖**：`register_reminder_task.py` 改为注册 `Worktodolist.exe --reminder`（壳早已支持隐藏实例），并加了 `--time` / `--delete` / `--dry-run`。
- **门禁补强**：新增 `qa-typography.mjs`（字号 / 字重白名单）并入 `test:ui`，字体契约从「靠自觉」变成「会拦」。

## v1.3.0 · 2026-11-02（外观与窗口）

**一句话**：加了明暗主题（可跟随系统，也可手动锁死），Windows 用上自绘标题栏，侧栏间距重新对齐；另含两个数据安全与流程补丁。

### 明暗主题：跟随系统 / 浅色 / 深色

此前应用只有「跟随系统」一种行为，暗色由 `@media (prefers-color-scheme)` 直接决定，用户无法在应用内改。现在活动栏多了一个主题按钮：

- **点按**在当前生效的明暗之间切换（浅↔深）—— 从肉眼看到的这一屏出发取反，按下必然有变化；
- **右键**（或应用菜单新增的「外观」）三档并列：跟随系统 / 浅色 / 深色，档位含义写在 label 上；
- 选「跟随系统」时，系统换色应用立刻跟着换，不必重启。

实现上把暗色令牌从媒体查询重构为 `:root[data-theme="dark"]`，由 `lib/theme.js` 把档位解析后落到 `<html data-theme>` —— 暗色令牌全场只留一份，不必抄两份（抄两份迟早漏改一条）。首屏底色由 `index.html` 内联样式用媒体查询兜住 JS 跑起来前的那一帧，避免启动闪白。主题偏好只落本机配置（`worktodolist.theme`），不进壳、不进数据目录、不写进 todo.txt。

### Windows 自绘标题栏

Windows 上改用自绘标题栏（窗控按钮 + 八向缩放），与 macOS 的上下文条并入 overlay 首行，两端外观更一致。

### 侧栏间距统一

侧栏的间距 / 圆角 / 行高统一刻在 4 的倍数上，图标缩到 13px，视觉更齐。

### 数据安全与流程补丁

- **每日备份纳入 notes.md**：此前每日备份只拷 todo.txt，备注文件一旦被误删或写坏没有副本可救。现在 `backup/` 里每天同时落 `todo-YYYY-MM-DD.txt` 与 `notes-YYYY-MM-DD.md`，**两个家族各自保留 30 份**（互不挤占）；notes.md 不存在或为空则跳过，不产生空备份。两个家族的判重互相独立 —— 早上已备过 todo.txt、中午才新建的 notes.md 当天也能补上。Rust 壳与浏览器双模式（`fs_backup` / `ensureDailyBackup`）同步实现，语义一致；prune 的名字白名单两侧逐字对齐，非备份文件（`todo-abcdefgh-1.txt` 这类）永远不碰。
- **CI 加测试门禁**：两条构建流水线（macOS / Windows）在 Rust 编译之前先跑 `test:guard`（全量 vitest + 测试文件数核对，拦「假绿」）+ `test:nl` + `test:ui`，失败即中断构建 —— 标签构建（发 Release）同样被拦。此前 CI 只验证「能编译」，测试全靠本地自觉，v1.1.0 事故暴露的就是这个缺口。

## v1.2.0 · 2026-10-23（手感与反馈）

**一句话**：功能没加，把「差点意思」的地方补上了 —— 完成 / 删除任务 now 有体面的退场，拖拽看得见落点，鼠标用户不用猜右键里有什么，编辑浮窗的焦点不再穿透。

### 完成与删除：从「消失」到「退场」

旧行为是勾选 → 整行 180ms 淡出 → **行消失、后续行瞬移上跳**；重复任务的下一次还会在原位闪一下（卸载重挂）。位置突变在视觉上就是「跳了一下」，这是列表发涩感的最大来源。现在是一条三段式：

1. **0–90ms**：复选框弹一下，标题上的划线从左到右扫过（`text-decoration` 不能动画，划线是用一条伪线划的）；
2. **90–140ms**：行淡出的同时**高度从 42px 折叠到 0** —— 后续行随布局平滑上移，这是整个改动里最关键的一招；
3. **140ms 起**：若任务带重复规则，下一次任务在原位淡入并高亮渐隐 700ms，明示「它跟刚完成的那条是同一条事的延续」，而不是凭空多出来的新任务。

删除走同一条退场动效（同一套 CSS，store 里同一个 fade 窗口机制），撤销链路不变。

### 焦点：编辑浮窗不再「穿透」

`aria-modal="true"` 之前只是摆设 —— Tab 能一路跳出浮窗落到背后的列表上，关闭后焦点也不知所踪。现在 Tab / Shift+Tab 在浮窗内到头循环，关闭时焦点还给打开它的那一行（行被删了则退给出场前的焦点）。陷阱逻辑抽成了纯函数（`src/lib/focusTrap.js`），node 环境直接单测。

### 鼠标用户：行内快捷按钮

优先级 / 日期 / 星标 / 删除全埋在右键菜单里，鼠标用户根本不知道右键有全功能。现在行 hover 时右端浮现三个按钮：**星标 / 到期日设为今天 / 删除**。键盘用户不走这条路（快捷键 + 右键菜单已全覆盖），所以按钮刻意不进 Tab 序列 —— 隐藏时可聚焦的按钮是键盘用户的陷阱。

### 其它修补

- **拖拽排序有了落点线**：拖拽中按鼠标上下半在目标行前缘 / 后缘画一条 2px 强调线，松手前就知道会插到哪（预览与落点同一个判断函数，不会「线画在前面、人落到后面」）。
- **快速添加的 chips 不再静默裁切**：超过 3 个折叠成 `+N`，完整清单在悬停里 —— 旧的 `overflow:hidden` 让用户以为没解析上。
- **搜索多处匹配全部高亮**：旧行为只标第一处。
- **toast 自动消失**：普通提示 3.4s、带「撤销」的 6s，不再常驻右下角。
- **✎ / ↻ 两个裸 Unicode 图标退役**：换成与全站一致的 SVG（`trash` / `pencil` / `rotate-cw` 三个新图标），消除 Windows 上的字形走形风险。
- **页签切换 140ms 轻过渡**：刻意不按 key 重挂内容 —— 那会把对话历史、侧栏展开状态一起重置。

数据面零改动：todo.txt / done.txt / notes.md 的格式一个字节没动，本轮全部是界面层。测试 **614 条全过**（新增 39 条：焦点陷阱 8、toast 计时 4、行级动效 6、拖拽落点 5、chips 折叠 4、高亮 4、其余回归），css-check / contrast 90 组 / hooks 门禁 / nl 词表全过。

## v1.1.1 · 2026-10-23（修复版）

**撤销了 v1.1.0**：该版本在 Windows 上「点编辑 → 界面没了、点哪都没反应」，GitHub 上的 Release 与 tag 已删除，请不要再下载那一版。v1.1.0 的全部功能（列表外观、稳定 ID、子任务、重复、备注）都保留在 v1.1.1 里。

### 修的是什么

编辑浮窗里有一个 `useMemo` 被写在了提前 `return null` **之后**，于是 Hooks 的数量在两次渲染之间发生了变化：

| 时刻 | 调用了几个 Hook |
|---|---|
| 应用启动（没在编辑） | 3 个，然后 `return null` |
| 点「编辑」之后 | 4 个（多出那一个 `useMemo`） |

Hooks 的数量必须在每一次渲染里恒定 —— 这不是风格问题，是 React 的硬规则：少一个多一个，它就认为前后两次渲染不是同一个组件，直接抛 `Rendered more hooks than during the previous render.`。而当时树上**没有错误边界**，React 18 的处理是卸载整棵 root：用户看到的就是「界面没了、点什么都没反应」，跟卡死一模一样，控制台之外没有任何线索。

它跟 Windows 无关（macOS 同样会中招，只是没人点过那一下），也跟数据无关 —— 不必担心 todo.txt。

### 怎么修的

- **编辑浮窗拆成「外壳 + 表单」两个组件**：外壳只判断「现在有没有在编辑」，没有就整体不挂载；表单组件因此只在真的要编辑时才 mount，它的初始状态能用 `useState` 直接算出来，不需要「先渲染空壳、再在 effect 里 setState」那种会改变 Hook 数量的写法。顺带修掉了「从 A 直接切到 B 编辑时标题还留着上一条」的隐患。
- **加了应用级错误边界**：任何一次渲染异常不再等于白屏，而是显示一个能读的现场（错误信息 + 出错组件 + 「重新载入」按钮），并明确告诉用户「你的 todo.txt 没被改动」。根因要修，但下一次再出错时不该让人对着白窗口猜。
- **加了两道防回归**：`EditDrawer.test.jsx`（渲染冒烟 + 源码级的 Hook 规则断言），以及 `npm run test:hooks` 全仓门禁（提前 return 之后不许再调 Hook，已并入 `npm run test:ui`）。拿 v1.1.0 的旧文件验过：这道门禁确实会拦下它。
- `reminder.rs`：`reminder_tick` 里重复读了一次已提醒记录文件。这个 tick 每 30 秒跑一趟，重复读是白给数据目录（可能在网盘 / 被杀软实时扫描）加压。

测试 575 条全过（新增 5 条），css-check / contrast 90 组 / hooks-check 全通过，前端 build 与 `cargo check` 均通过。

## v1.1.0 · 2026-10-22（已撤销，请用 v1.1.1）

> ⚠️ 该版本已因上述缺陷从 GitHub 撤销（Release 与 tag 均已删除）。内容保留在此仅供追溯。

**列表外观**：`+项目` 升格为「列表」—— 侧栏每个列表前多一颗颜色圆点，颜色在设置页挑（8 色板）。这是「向提醒事项式列表靠拢」的第一步，**数据面零改动**：todo.txt / done.txt 一个字节没动，颜色存本机 localStorage，不进数据目录、不进 git。

### 为什么颜色不写进 todo.txt

- 颜色是外观偏好，不是数据：同一份 todo.txt 换台机器打开，颜色该跟着这台机器的偏好；写进文本就把它变成了数据的一部分。
- 纯文本里塞 `#E24B4A` 会污染 grep / 排序 / topydo（topydo 会把色值当普通词）。
- 备份与 git 只该管事实，不该管审美。

### 没挑过色的列表也有色

按项目名做**稳定散列**取色（FNV-1a → 8 色板取模）：同名永远同色，不同名尽量分散，且不随排序变化跳色。所以「没配过」与「配成灰色」是两种状态 —— 设置页里显式配过的项会多出一个「自动」按钮，点了就回到按名字取色。

### 稳定 ID（`id:` 标签）

子任务、重复规则、备注三者都要「引用某一条任务」，而 todo.txt 的行号会变、标题会改，唯一能当锚点的是一个写进那一行里的 ID。这一节只埋地基，**界面上没有任何变化**。

- 语法：`id:<6 位 base36>`，作为普通 `key:value` 标签写进 todo.txt（topydo 与记事本都当它是普通标签，无害）。
- 与 `task.id` 分开：后者是解析时现算的运行时 ID（服务 React key 与拖拽），重读一次文件就全变了；`stableId` 写进行里，一旦生成不再变。
- **渐进补齐，不批量改写**：新建任务自带 ID；老任务在被编辑时才补。不为埋 ID 把几百行文件一次性改样 —— 那会让 git 记下一次谁也看不懂的大 diff。
- 重复 ID 只认第一个（复制粘贴的常见后果），后来者置空而不是替它改号：改号等于替用户决定「哪条是真的」。
- 拿不到唯一 ID 时宁可不写：没 ID 将来还能补，写重了会让引用它的人指错。
- 非法 ID（含冒号 / 空格 / 中文 / 长度不符）直接丢弃，不留成 `extraTags` —— 它既不是用户写的，也不是我们能用的，显示出来只是噪音。

### 子任务（`parent:` 标签）

关系写在**子任务自己那一行**上：`parent:<父的 stableId>`。**不用缩进**表达从属 —— 缩进在 todo.txt 里活不下来：topydo 不认、记事本会吃掉行首空格、复制粘贴经常丢。一行一条 + 一个标签，是唯一扛得住「外部编辑器随便改」的形状。

- 入口：编辑浮窗（双击任务）里的「子任务」区块 —— 列出全部子任务、可勾选完成、可删除、底部输入框回车即添加。放在浮窗而不是列表行上，是因为加子任务是「停下来想一想」的动作，不是一个顺手的点击。
- 列表里子任务缩进一档紧跟父任务；父任务的元信息簇显示 `1/3` 进度。
- **「今天」视图不缩进**：那个视图先按紧急度分流，父子本来就会被拆到不同组，缩进一条旁边没有父的行只会让人以为界面坏了。两种视图的渲染与键盘导航都走 `viewTasks` 一条路径，顺序不会分叉。
- 父任务缺 ID 时**当场补一个**再加子任务 —— 这就是「用到才补」的场合：为可能永远不会来的子任务提前改写整份文件不值得。
- 完成的子任务仍算在分母里（`2/3` 的 2 就是它们）：索引同时吃 todo 与 done，否则子任务一完成就从进度里蒸发、分母跟着缩水。
- **删父不带走子任务**，它们降级为独立任务，toast 会说明「N 个子任务已变为独立任务」。连带删除更符合提醒事项的手感，但那意味着替用户删掉他没点过的行 —— 纯文本清单的底线是不让人意外地丢数据。

三种「看不见」的失效都写成了断言：父子互认成环会让整组任务从界面消失（环在建索引时断开）；父不在当前视图时子任务会跟着消失（降级为顶层）；快速添加里手打的 `parent:` 会挂不上（一律丢弃）。

### 重复规则（`rec:` 标签）

完成后**自动生成下一次**，而不是把任务留在原地勾选又取消。语法只做提醒事项里真正高频的那几种，不抄全 EKRecurrenceRule：

| 写法 | 含义 |
|---|---|
| `rec:+1d` / `rec:+3d` | 每天 / 每 3 天 |
| `rec:+1w` / `rec:+2w` | 每周 / 每 2 周 |
| `rec:+1m` / `rec:+3m` | 每月 / 每 3 个月 |
| `rec:mon` / `rec:mon,thu` | 每周一 / 每周一、四 |

- 入口：编辑浮窗「重复」下拉（含「每个工作日」与各星期几）；手写在文本里同样生效，`rec:mon,wed` 这类组合下拉里没有也能正常用，且会作为一项补进下拉，不会显示成空白。
- 列表里带 `rec:` 的行显示一个 `↻`，完整规则（「每周一、四」）放在悬停提示里 —— 列表是用来扫的，多一个字都会挤压日期的位置。
- **下一次以 `due` 为锚点推进，不是以「今天」推进**：逾期三天才完成的任务，下一次仍是 `due + 一个周期`。若从今天推，每逾期一次间隔就被悄悄缩短，「每周」会慢慢变成「每几天」。
- 算出的日期**必须严格晚于今天**：提前完成的重复任务不会当天再冒出一条。
- `t:`（阈值）与 `rem:`（提醒时刻）跟着平移同样的天数，时刻不变 —— 「每周一 9 点提醒」不能变成「那周的周二才提醒」。
- **每月按号数走，遇短月压到月末且不漂移**：1/31 → 2/28 → 3/31。实现上每一步都从原始锚点重算，而不是在上一步结果上累加（后者会让「每月 31 号」被 2 月永久拽成 28 号）。
- **下一次是另一条任务**：运行时 ID 与 `stableId` 都重新分配，绝不继承 —— 继承会造成两行同号，引用它的人（子任务 / 备注）指不准。`parentId` 则保留，父没换。
- **插回原位置**而不是追加到末尾：重复任务该在它原来待的地方重新长出来。
- **撤销完成会连带撤掉下一次**：它不属于用户做过的动作，留着就是一条凭空多出来的任务。
- 认不出的 `rec:` 值**不丢**，原样留在「其他字段」里 —— 这是用户自己写的规则，静默吞掉会让人以为设过了。这一点与 `id:` / `parent:` 相反（那两个是系统分配的引用，非法值直接丢弃）。

### 备注（`notes.md`）

备注是唯一**不放在 todo.txt 里**的数据。双击任务，编辑浮窗底部那块多行输入框就是它。

- 位置：数据目录下的 `notes.md`，与 todo.txt 同级。每条备注是 `## <stableId>` 起头的一节，正文随便写（Markdown 可用）。
- 为什么外置：备注是多行、长、带格式的，而 todo.txt 的每一行都是一条待办 —— 扫列表、grep、topydo、拖拽排序全依赖这个形状。而且备注不是「扫列表时要看见」的东西，它是点进去才看的。
- 为什么是**一个文件**而不是 `notes/<id>.md` 一任务一文件：将来纳入备份 / git 是「多一个路径」而不是「多一个目录」（后者的清理、孤儿回收、目录创建都得另写一套）；数据目录里也不该长出几百个碎文件。
- 文件开头那段说明**原样保留**，程序只重写 `## <id>` 之后的部分。
- **保存是「读·改·写」**：写之前重新读一次磁盘，只合并自己那一条。用户可能正用别的编辑器改着 notes.md，拿内存里的旧文本整文件覆盖会吃掉他的改动。
- 清空输入框 = 删掉那一节，不留空节。
- 老任务没有 ID 时先补一个再挂 —— 备注靠 `id:` 认人，没有 id 就挂不住。
- 列表上有备注的行显示一个 `✎`。
- **删任务不删备注**：那一节还留在 notes.md 里（它是你写过的字），要清就直接在文件里删掉那一节。提醒事项的备注跟着任务走，但纯文本清单的底线是不让人意外地丢数据。
- 已知缺口：**每日备份（`backup/todo-<date>.txt`）只拷 todo.txt，不含 notes.md**。git 自动提交已同步纳入（见下）。

### git 提交范围纳入 notes.md

`git.rs` 的 `DATA_PATHS` 由两项改为三项（`todo.txt` / `done.txt` / `notes.md`），备注从此有版本历史。同时把 `git add` 改成**只 add 实际存在的文件** —— `git add -- a b c` 里只要有一个 pathspec 不存在就**整批失败**，那会让「用户还没写过备注」变成「todo.txt 也不再自动提交」。

这一处是 Rust 改动，`cargo check` 已通过（`RUSTUP_TOOLCHAIN=stable-aarch64-apple-darwin` 覆盖 `rust-toolchain.toml` 里写死的 Windows-MSVC 通道后验证）。

> 注：`src-tauri/rust-toolchain.toml` 把通道锁成 `stable-x86_64-pc-windows-msvc`（理由见该文件注释：Windows 上必须走 MSVC，GNU 路线会踩 windres / 中文路径 / 响应文件三个坑）。因此在 macOS 上直接跑 `cargo` 会报 `target tuple in channel name`，**这不是代码问题** —— 用 `RUSTUP_TOOLCHAIN` 覆盖即可，不要去改那个文件。

### 改动面

- 新增 `src/lib/listStyle.js`：色板、稳定散列、本机配置 store（key `worktodolist.list-style.v1`；色板外的脏 id 在归一化阶段丢弃）。
- `Sidebar.jsx`：项目组条目加圆点，分组标题由「项目」改「列表」。`@分类` 不长圆点 —— 它不是列表。
- `TopBar.jsx`：当前视图是某个列表时，面包屑带上它的颜色（否则「列表」只在侧栏成立，进主区就退回一串灰字）。
- `SettingsPage.jsx`：新增「列表外观」组，列出全部列表 + 8 色点。这一节会写本机配置，页头说明因此由「本页只读」改为「列表外观存本机」。
- `index.css`：新增 `--dot-edge` 令牌（色点描边，明暗两套值）、`.nav-dot` / `.swatches` / `.swatch` / `.swatch-auto` 样式。
- `todoParser.js`：`stableId` 字段（读写 `id:`、序列化时排在用户自写标签之前）、`parseFile` 内重复 ID 去重、`newStableId` / `isValidStableId` / `collectStableIds`。
- `useTodoStore.js`：`addTask` 与 `updateTask` 两处分配 ID（需要全库视角，所以放在提交时而不是解析器里 —— 解析器保持纯函数）；新增 `addSubtask`；`deleteTask` 的 toast 会说明有多少子任务变为独立。
- `subtasks.js`（新）：`buildNesting`（建索引 + 断环）/ `childrenOf` / `childProgress` / `depthOf` / `nestChildren`（子随父排）。
- `sortFilter.js`：`viewTasks` 末尾做一次嵌套（「今天」「已完成」两个视图除外，原因见上）。
- `TaskRow.jsx`：新增 `depth` / `kids` 两个 prop —— 缩进类 `is-child` 与进度 `1/3`。
- `EditDrawer.jsx`：新增子任务区块；输入框回车是「加一条」而不是「保存浮窗」（不拦住会顺手关掉浮窗）。
- `recurrence.js`（新）：`parseRecurrence` / `formatRecurrence` / `describeRecurrence` / `nextDueDate` / `nextOccurrence` / `RECURRENCE_CHOICES`。纯函数，只依赖 dayjs。
- `todoParser.js`：`recurrence` 字段（读写 `rec:`，序列化排在 `star:` 之后、`id:` 之前）；新增 `newTaskId`（给凭空造出的任务分配运行时 ID）；快速添加里手打的 `rec:` 生效（与 `id:` / `parent:` 相反，它是用户能写的规则）。
- `useTodoStore.js`：`toggleComplete` 在提交时生成下一次实例（fade 窗口内撤销时它还没出生，不会留幽灵任务）；撤销记录新增 `spawnedId`，撤销完成连带删除；toast 预告「下次 2026-10-29」。
- `EditDrawer.jsx`：新增「重复」下拉；手写的规则若不在预设里会补一项进去。
- `TaskRow.jsx` 与 `index.css`：`.rec-chip` 重复标记。
- `notes.js`（新）：`parseNotes` / `serializeNotes` / `writeNote` / `readNote` / `NOTES_FILE`。纯函数，只依赖 `isValidStableId`。
- `useTodoStore.js`：加载时读 notes.md 进内存（`noteIds` 进 state，正文留在 ref 里按需取）；新增 `getNote` / `saveNote`；`saveNote` 对缺 ID 的老任务先补 ID 再挂。
- `EditDrawer.jsx`：新增备注输入框（多行；`textarea` 里的回车不触发保存）；保存时顺带写备注。
- `TaskRow.jsx` 与 `index.css`：`.note-chip` 备注标记、`.note-input` 输入框样式。
- `styleguide.jsx`：假 store 补上 `getNote` / `saveNote` / `noteIds` / `addSubtask`。
- `src-tauri/src/git.rs`：`DATA_PATHS` 加 `notes.md`；`git add` 前过滤不存在的文件。

### 打包与分发

- 新增 `.github/workflows/build-macos.yml`：在 `macos-latest` 上出 `Worktodolist.app`（打 zip 后上传）。同样两个坑：`RUSTUP_TOOLCHAIN` 覆盖写死的 Windows-MSVC 通道；`.app` 是目录包，上传前先 `ditto` 成 zip。
- 改造 `.github/workflows/build-windows.yml`：新增**推送 `v*` 标签即自动构建**，并把 NSIS 安装包挂到该版本的 Release 上（手动触发时只传 Artifacts，不建 Release）。
- 构建命令统一改为直接调 `node node_modules/@tauri-apps/cli/tauri.js build`，绕过 `npm run tauri:build` —— 后者依赖 `node_modules/.bin/tauri` 软链，该软链在部分安装方式下不建立，会报 `tauri: command not found`。
- 版本号定为 **1.1.0**，`package.json` / `tauri.conf.json` / `Cargo.toml` 三处同步（不同步会让 app 里显示的版本与日志对不上）。

### 验证

- `npm test` 570 用例全过（新增 `recurrence` 19 例 + 解析器 `rec:` 7 例 + store 重复 4 例 + `TaskRow` 3 例 + `notes` 19 例 + store 备注 5 例 + `TaskRow` 备注 3 例）。
- `notes` 那一组专盯**丢数据**：往返不丢正文、说明头不被重写、正文里的 `##` 不被当成新节、反复写同一条不产生重复节、空正文不留空节。
- store 备注那一组里有一条专门模拟「用户正在外部编辑器改 notes.md」，断言保存一条之后别人的那条还在 —— 这是「读·改·写」唯一值得写测试的理由。
- `Sidebar.test.jsx` 是首个组件渲染冒烟（react-dom/server 静态渲染）：断言 3 个 `+项目` 渲染出 3 颗 `#RRGGBB` 圆点、不同列表不同色、`@分类` 不长圆点。圆点失效的方式是静默的（dotFor 传漏、色值取到 undefined 都只是变回一排灰字），所以需要这层断言。
- `qa-css-check`（无裸色值 / 裸字号）、`qa-contrast` 90 组、`vite build` 全部通过。

## v1.0.4 · 2026-10-18

**小版本更新 · 纯本地离线**：自然语言识别长尾收口（八轮 held-out 压测 + 会话回指层 + 极性护栏，零模型、零出网）、工具页改「目录态卡片墙 + 工作态」两态、UI 外壳换成「左侧活动栏 + 上下文条」骨架、页眉开关左侧化，外加 git 自动提交范围与备份清理两处数据层修正。构建产物 `Worktodolist.exe` 随仓库分发（见文末「下载」）。

### git 提交范围与备份清理

- **自动提交不再纳入 `backup/`**（`git.rs` 的 `DATA_PATHS` 由三项减为 `todo.txt` / `done.txt`）。备份文件就是 todo.txt 每日的整份副本，而 todo.txt 本身已在版本控制里 —— 跟踪它等于把同一份历史存两遍，且每天新增一份、历史永不回收。要回溯历史看 todo.txt 的提交记录即可。
- **备份清理由「删失败即停」改为「删失败留痕后继续」**（`workspace.rs` 的 `prune_backups`）：此前单个文件被占用（杀软扫描 / 编辑器打开）就会让**其后所有**过期备份永久滞留，"保留 30 份"的承诺实际只兑现一次。失败明细写在数据目录的 `.todolist-backup.log`（已加入 `.gitignore`）。
- 注：`backup/` 下的 `icons-before-lucide-*`、`index.css.pre-rebase-*` 是**手工一次性快照**，不在 `is_backup_name` 的识别范围内，清理逻辑不会动它们 —— 这是刻意的，不是遗漏。

### 页眉左侧化（侧栏开关移到最左）

上下文条左边原本只有面包屑，侧栏折叠按钮混在右侧的「搜索 / 排序」簇里。参照桌面软件「面板开关在左上角」的惯例，把它移到**页眉最左**并改成图标式：26px 方形钮、悬停才浮底色、折叠态仍是强调色。图形与提示**与原型 v2 的折叠钮完全一致**——`panel-fold`（左缘竖条 + 左向箭头，由原型 16×16 路径 ×1.5 换算到 24 画布）+ 提示「折叠侧栏 · Ctrl+B」。语义与快捷键（`Ctrl+B`）不变，只改位置与形态。

- **只影响列表页**：对话 / 工具 / 设置三个页签没有侧栏，页眉维持原样（面包屑在最左）。
- 工具提示与 `aria-pressed` 保留；触屏档沿用 `.ctx-btn` 既有的 44px 命中区规则。
- QA 补两类断言：宽 / 窄屏列表档「开关在页眉最左」、对话页「页眉无开关」；`qa-responsive` 30 档 / 358 项、`qa-settings` 15/15、`qa-tools` 74/74、`npm test` 444 用例全部通过。

### 工具页卡片式改版（目录态 + 工作态两态）

工具页从「左栏清单 + 右栏工作区」的主从结构改为**两态**：目录态是一张按分组排布的卡片墙，点卡片才进入工作态。工程计算、待办数据两个分组各成一张 auto-fill 网格，每组末尾一张虚线**预留卡**（组内工具满 4 个自动隐藏）—— 扩展位在界面上可见。工作态本体零改动，只在页头加了「← 工具集」返回按钮与面包屑。方案过程稿已在 v1.5.1 收尾清理中删除，结论保留在本条。

### 目录态（新）

- 卡片墙：标题 + 模块计数 + 搜索框（过滤名称 / 描述 / 标签 / 关键词，有查询时平铺不分组）；每张卡含组色竖条、图标、名称、两行描述、标签（至多 3 个）、底部风险徽标（只读 / 会写入 todo.txt）与「最近」标记。
- 收藏置顶成独立分区（星标点击，不顺带打开工具）；组内按最近使用排序；未登记分组的工具进「其它」兜底，不会消失。
- 预留卡是纯装饰（`aria-hidden`、不进 Tab 序列），规则 `RESERVED_SLOT_LIMIT = 4` 与组色 / 组注一起放在外壳侧 `wallConfig.js`——**registry 契约零改动**，加工具仍然只改一条登记。
- 键盘：卡片 `role="button"` + Enter/Space 打开；星标是真按钮（卡片根不用 `<button>`，避免嵌套）。

### 工作态（仅页头变化）

- 页头改为「← 工具集」+ 面包屑（工具集 / 工具名）+ 风险徽标；大标题收成面包屑末项，内容标题归工具自己。
- `Esc` 返回目录态（焦点在输入框 / 模态打开时不拦）；对话页 `tool.open` 仍直达工作态，不经过墙；**刷新后回目录态**（墙是"家"，属行为变更）。

### 迁移与验证

- 删除左栏那套样式与断言；QA 期望值改从 registry + wallConfig 现算：工具卡数 = 可见工具数、预留卡按组现算；卡片名改**集合**比较（收藏 / MRU 会重排）；新增「点卡进入 / 返回 / Esc / 搜索过滤 / 收藏置顶」断言。
- `qa-tools` 74/74（原 66）；`qa-responsive` 30 档 / 339 项（新增 `coarse-390-tools-work` 一档，覆盖工作态触屏命中区）；`npm test` 411 用例全过；`qa-css-check` / `qa-contrast` 90 组 / `qa-settings` 15/15 通过。

### UI 外壳改版（按原型 v2）

外壳从「顶部横向页签 + 工具条」改成「左侧活动栏 + 上下文条」，列表、对话、工具、设置四个页面一起换骨架。**功能逻辑零改动**：视图、排序、搜索、快捷键、文件读写、撤销、工具计算全部沿用原实现，改的只是布局、样式与交互表现。令牌层（颜色 / 字阶 / 间距 / 圆角）一个值都没动，QA 的对比度与 CVD 结论继续成立。

### 外壳：46px 活动栏 + 36px 上下文条

- **页签竖起来**：对话 / 列表 / 工具从顶部横排改为左侧 46px 轨道上的 34px 图标按钮，悬停浮出文字提示；应用菜单、窗口置顶、设置三个入口同时从顶栏右端搬到轨道底部（`Ctrl+,` / `Ctrl+1..3` 不变）。
- **新增上下文条**：36px，左边是面包屑（视图名 / 数据来源文件 / 共 N 项），右边只放这一层能做的事（搜索、排序切换、折叠侧栏）。原来的「已保存」状态不再出现两处，只留在底部状态栏。
- **新建任务下沉**：从工具条里的一行长输入框改为列表首行（吸顶），回车创建、chips 实时解析的行为不变。
- **今日概览**：状态栏上方新增可折叠条，收起时一行摘要（完成 x / y · 逾期 n），展开是四格等宽数字（今日完成 / 逾期 / 近 7 天日均 / 高优先级）。全部由现有 entries 现算，只读。

### 列表页

- 行高 42px、**行间发丝线**、圆形 18px 复选框、整行悬停 + 左缘 2px 选中条（逾期不抢这条边，由红色截止日与红色分组标题表达）。
- 行内改成稳定三栏（复选框 / 标题 / 元信息簇）：标题 13px 半粗、元信息靠右成列，优先级与截止日各占固定宽度，整列右边缘是一条直线。
- 截止日只在「今天到期」「逾期」两种状态上底色（浅青 / 浅红），其余保持纯文字 —— 满屏彩色药丸会让真正紧急的那条淹掉。
- 分组标题改成「左侧色条 + 等宽小字 + 右端计数」，不再画延伸到底的规则线。
- 侧栏 176px（中等屏 156px），深半档底色；四个固定视图各配一个 16px 线性图标（日历 / 列表 / 勾选圈 / 收件盘），选中态是一整块浅灰圆角 + 加粗计数，分类 / 项目组名改等宽大写小字并缩进对齐到标签列；底部加脚注（`todo.txt` / 自动排序 开·关）。
- 新建任务收成列表首行（吸顶）的**输入框**：描边 + 浅底 + 圆角 + 聚焦高亮环，占位文字只留「添加任务，回车创建」，支持字段挪到右端的等宽提示（窄屏自动收起）。
- 新增侧栏折叠（上下文条按钮 / `Ctrl+B`），窄屏下侧栏仍是横向过滤条。

### 对话页

- 消息从「左右分栏气泡」改成「头像 + 正文」的单列日志：AI / 我 / 工具三种 22px 方角头像，工具调用记录保持等宽块。
- 输入区合并成一个描边输入带，发送改为 24px 主色图标按钮；顶部「逾期摘要条」改为 30px 中性信息带，只有真的逾期才转红。

### 工具 / 设置

- 工具左栏与列表侧栏同底色同宽度；工具页头、工作区、页签全部沿用原组件，只跟随新外壳调整高度与边距。
- 设置页文案从「顶栏齿轮」改为「活动栏齿轮」，快捷键清单补上 `Ctrl+B`。

### 验证

- `npm test` 358/358；`qa-css-check` 类名契约 + 裸值门禁通过；`qa-contrast` 90 组全过。
- `qa-responsive` 28 档 / 330 项断言全过（新增桌面档 chat / tools / settings / 概览展开四个对照视图）。
- `qa-settings` 15/15、`qa-tools` 66/66。

### 本地中文识别长尾增强（七轮 held-out 压测收口）

仍然零模型、零出网：改的是 `nlRules` 的词表、裁决顺序与时间解析，加一层会话回指。目标是"听得懂人话"而不是"猜得更快"——认不准一律走澄清。

### 动词与句式

- 触发词长尾扩充（完成 / 删除 / 延期 / 优先级 / 星标 / 分类 / 查询各族），补进"办了、结了、干完、不用去了、作废、置顶、收藏、归到、贴个、做了哪些"这类口语说法。
- 体貌结构：句末 `V了 / V过了`（"差旅报销我报过了""电话那条帮我回了"）识别为完成回报，而不是新任务。
- **句中命令按"离句首/句尾越近越像命令"裁决**（旧实现按词表顺序扫全句，"把 星标任务 干完"里任务名中的"星标"会抢走真正的动词）；句首触发词只认开口就说的。
- 特指疑问句前置：以"哪些 / 有几个 / 还有几 / 多少"（允许"现在 / 手上"等前垫）开头的句子先判为查询，句中的"到期""查"不再被当成 setDue / 查询动词；"复查、检查、排查"这类复合词不参与查询判定。
- 感想句闸门：有评价词且找不到任何事项线索（"今天天气还不错"）不再生成待办建议。

### 上下文（新增 `src/lib/nlRef.js`）

- 三档回指：序数回指（上面第二个）、强回指（它 / 刚才那条 / 上一条）、弱回指（这条 / 那个，仅当剥完动作词什么都不剩才算）。
- `useChatAgent` 维护焦点栈（lastTaskId / lastCandidates），"再把它标为高"这类追问能落到上一轮的对象上；裸"第 N 条"仍按列表序号解释，口径不变。

### 时间表达

- 新增：`过N天 / 再过几周`、`N天以后`、`N天内 / 以内`（时长上限即截止日，裸"弄它个三天"仍不算期限）、`下下个礼拜三`、裸"N号"（带溢出校验）、`11/5`、国庆等公历节日锚点。

### 查询

- `scope: 'overdue'`：「哪些事拖到期了 / 列出逾期」只回 dueDate 已过的活跃任务，逾期最久的排前面；无逾期时明确说"没有逾期任务"。
- 疑问框架虚词（哪些 / 还有 / 手上 / 啥没办…）不再污染关键词，避免"要不要新建一条「事」"这种答非所问；剥完不足两个汉字的残片一律不作检索词。
- 「行政里还有啥没办」这种不带 `@` 的分类说法，在该名字确实命中已有分类时才认。

### 多动作单句（新增）

- 「把对账删了，然后把报销单标成高」这种一句话两件事，过去要么硬认一件、要么整体听不懂。现在按分隔词（，、。；＋"顺便/然后/接着/并且/同时/另外/末了"）切句逐条解析：**拆出 ≥2 个互不相同的会改数据的动作时，只列清单不动文件**，回「1」「2」各做一条，回「都做」按说出的顺序依次执行，回「不」取消。
- 反向护栏同权重：同一件事换着说两遍（「回测这条要紧，顶格」）、后半句其实没有动作（「删了，就是昨天说的那条」）都**不拆**，照原样执行一条 —— 拆错比拆不出来更伤用户。
- **无分隔连写也能拆**：「把季报复核删了把周线复盘标成高」没有逗号也没有"然后"，改按「把」字的重复出现切句。这条证据比分隔词弱，所以门槛更高 —— 每个子动作的目标都必须在当前列表里锁得到（或本身就是新增），否则不计入；「把伞收了把鞋换了」这种列表里没东西的连写照旧不动。
- 「同一意图、不同目标」现在算两件事（「把A删了把B也删了」），但目标锁到同一条时合并 —— 只认意图不同会把"重复删除同一条"当成两件事。
- **改口护栏**：后半句以「就是 / 其实就是 / 我是说 / 也就是说 / 意思是」开头，或这些词落在前一段尾巴上（无分隔切分会把"就是把"甩到前段末尾），判为对前一句的**自我纠正**而非第二件事，整句交回单句解析。
- 孤立副词不再污染目标：「把这条**也**标成高」过去会把关键词认成"也"（回指被盖掉），现在按空格分词剥掉 也/还/就/便/又/再/先 这类独立单字片段，正常走回指。
- 批量执行里遇到目标没锁定的子动作：明确说"这条先跳过，请单独说一句"，不静默丢掉。

### 极性护栏（第七轮盲测抓到的两个安全级漏洞）

第六轮之前，引擎**完全没有否定/征询判定**。于是：

- 「不要完成述职材料」→ 判成 `complete / high`，会把那条任务勾掉。否定词只是混进关键词（"不要 述职材料"），相似度 0.6 仍过 0.5 的线。
- 「要不要把租约改到下周？」→ 判成 `postpone / high`，真的去改截止日。`QUESTION_RE` 此前只在隐式新增里查过，命令路径上根本不看。
- 「别删牙科复查」侥幸安全（裸「删」不是触发词），「别把租约删了」却执行 —— 同一句话两种结果，靠运气。

这直接违反本项目的硬口径「认不准一律走澄清，绝不静默执行」。修法：

- 新增 `hasNegatedCommand` —— 判据是**否定词是否管住了一个真的命令动词**，而不是"句子里有否定词"。否则「租约不要了」（"不要了"本身就是 delete 触发词）会被自己的护栏掐死。
- 后视/前视断言排掉复合词：别墅 / 级别 / 特别 / 识别 / 告别 里的「别」不算否定。
- 新增 `CONSULT_RE`：要不要 / 该不该 / 是不是 / 句末吗呢问号 → 判为征询。
- 护栏只作用于**会改数据的意图**（`MUTATING_INTENTS ∪ {add, suggestAdd}`）；查询、列清单不受影响。
- `useChatAgent` 侧新增 `refused` 分支：回一句人话说明"我没动，文件也没改"，而不是笼统的"没听懂"。返回值仍是 `'unknown'`，好让"待建议第三态必须明确收尾"的契约继续生效。
- 反向断言同权重：「回测报告这条不要了」必须仍是 delete，「加一条 明天 交周报，别忘了」必须仍是 add。

### 改口句（第七轮）

「把牙科复查延到下周一，哦不，是延到下周二」过去被判成 `multi`，回"我听到 2 件事"—— 其实是一件。但直接塌回单句解析**更糟**：离两端距离打分会选中后一个动词，`extractDate` 却取前一个日期，结果是"延到下周二"配上周一的日子。

- 新增 `splitRestatement`：以「哦不 / 不对 / 说错了 / 应该是 / 我是说…」为界，**动词与日期取最后一段**，目标缺失时从前一段继承，并一律 `needsConfirm=true`。
- 改口标记必须落在**分句边界**上（前有标点或句首）。否则「记一下 报销单不是今天的」里的"不是"是任务内容，会被当成改口拆坏一条正常新增。
- 递归安全：切出来的后半段必然以标记开头 → `cut === 0` → 递归调用直接返回 null。

### 词表漂移门禁（新增 `scripts/qa-nl-drift.mjs`）

一次性审计发现 `TRIGGERS` 与 `COMMAND_RULES` 已经漂了 8 处（设个提醒、记下、做完、删干净、清干净、扔掉、拖一拖…）：词表里写着能认，裁决正则里没有，于是"文档说支持、实际判 unknown"。已全部补齐（裸「记」有意排除 —— 标记/日记/记性歧义面太大，进 allowlist）。

审计脚本转为常驻门禁并挂进 `npm run test:nl`：直接读 `nlRules.js` 源码，抽出两份词表，断言每条 `TRIGGERS` 都能被同意图的 `COMMAND_RULES` 正则匹配。漂移退出码 1，源码结构变了退出码 2。

### 其余补漏（第七轮）

- **优先级说法残留会毁掉目标定位**：「年度述职材料标成最高优先级」过去 `matches=[]`，因为 `drop` 集合按空格分词过滤，抠不掉连写的"最高优先级"，关键词相似度掉到 0.45。现在 `matchPriority` 同时返回命中片段，长度 ≥2 才整段剥掉（避免从「高中同学聚会」里挖走"高"）。
- **年份被悄悄改写**：「2028年3月5日」只匹配到「3月5日」，再经"当年已过算次年"规则变成 2027，标题里还留着"2028年"。新增四位年整段匹配，排在 M月D日 之前。
- **「三个星期以后」不认**：周单位的 `NUM_SRC` 模式缺 `个?`（只有 `个?月` 有）。已在 4 处 `extractDate` + 1 处 `stripNoise` 补上。
- **「拖后 5 天」不认**：`拖后` 在 `TRIGGERS` 里但不在 `COMMAND_RULES` 里；且偏移前缀备选里只有 `拖`，`拖` 命中后剩下的"后"挡住了数字。两处同补，长词优先。
- **「提前到」归 `setDue` 而不是 `postpone`**：两者都只改 dueDate，但 postpone 的回复文案是「已延期到…」，用户说的是提前，回一句"延期"等于答反了。必须带「到/至」才算，裸「提前完成年报」仍是 complete。此前「给母亲订生日蛋糕提前到本周末」会产出一条标题为"母亲订生日蛋糕提前到"的垃圾新建建议。

### 评测（`npm run test:nl` / `test:nl:heldout`）

- 基线考卷 `qa-nl-coverage` 44/44，基线桶 A 不允许失败；`qa-nl-drift` 168 条触发词 / 10 条命令规则比对一致。
- 三至六轮 held-out 盲测：第一轮 36%→100%，第二轮 67.9%→100%，第三轮 63%→100%，第四轮 **首轮 59%**、补齐后 17/17，第五轮（多动作拆分正反两向）首跑 12/12，第六轮（无分隔连写）**首跑 92.9%**、补上改口护栏后 14/14。
- **第七轮 44 条**（L 新说法 18 / M 会话回指链 6 / N 时间新形态 7 / O 该保守的 13），写于前六轮补齐之后、未参与调参。**首跑：正向 23/31 = 74.2%，"该保守的"严格档 6/12 = 50%** —— 两个安全级漏洞就是这一跑抓出来的。补齐后 44/44，O 组安全底线（没直接改文件）13/13。第七轮从此也是考卷，`process.exit(1)` 做真门禁；**可引用的泛化数字是首跑那两个，不是 100%**。
- 每轮都同时测"该保守的"：同音错别字、农历节日、征询意见、否定句，全部正确落到 unknown、拒绝或澄清。
- `npm test` 411 个用例（20 个文件）、`test:guard` 完整性校验通过；`test:ui`（类名契约 + 对比度 90 组）与 `vite build`（285.80 kB）通过。
- 多动作确认态在 `styleguide.html?view=chat` 的 mock store 里做过浏览器级点击验证：清单文案 + `只做 1 / 只做 2 / 都做 / 取消` 四个按钮渲染正常，点「都做」后按说出顺序落出 `todo.delete` → `todo.setPriority` 两张工具卡片，确认前侧栏任务数不变（零写入）。

### 仍未解决（词表路线的结构性上限）· 第七轮收口时

改口句现在认了（「哦不 / 不对 / 应该是」这一族），无分隔连写仍只覆盖「把」字句这一种形态；不带把的裸连写（"打印机卡纸修好租约续签"）只会硬认第一件。此外是同音/拼音容错（"报消凭证"）、农历与未收录节日（中秋、圣诞 → 直接 unknown，不编日期）、以及"要真正理解才好判"的长头多目标指代（"第一个和第三个都完成"）。这些在第七轮里都是**有意保守**的结果，不是漏掉的 bug。再往上只有两条路：继续人工堆词表（边际收益递减），或引入离线小模型兜底（fastText / BGE-small ONNX，约 50–100MB，仍不出网）—— 后者是产品决策，须用户拍板。

### 第八轮 held-out + 四处纯规则补漏

接着第七轮的收口，先出一卷全新盲测拿干净的泛化基线，再把「词表路线还差哪四口气」逐条补掉。仍然零模型、零出网。

### 第八轮评测设计（新增 `scripts/heldout/round-08.mjs`，53 条）

把「已知上限」从泛化分里剥出来，是这一轮相对第七轮唯一的方法改进：P 全新说法 + Q 回指与时间新形态算**泛化主数**；R（农历节日 / 错字 / 裸连写 / 并列多序号）是第七轮就记为结构性上限的四类，**另立追踪板、不计入泛化分** —— 它们失败不意外，通过才要单独报收益，混进总分只会让数字失真；S 该保守的按每条自带档位判，安全底线（没直接改文件）单列。

**首跑（2026-10-18，改动前，此后原样冻结）：P 7/20 = 35%，Q 6/10 = 60%，泛化主数 13/30 = 43.3%；S 10/12、安全底线 12/12；R 2/11。** 比第七轮的 74.2% 低一截，因为 P/Q 是照着"前七轮都没出现过"写的、没有为词表覆盖面筛题 —— **两个数不可比**，不能读成能力退步。

首跑另外抓到两处**安全级**缺陷（S 组没覆盖到）：「需求文档未完成」→ `complete/high`，会把任务直接勾掉，动作与用户意思正好相反；「第1条和第4条都标星」→ 只标了第 1 条、第 4 条连提都没提，用户说了两件事而软件做了一件且不交代。

补齐后重跑 P 20/20、Q 10/10、S 12/12（安全底线 12/12）、R 10/11 —— **这组数从此是考卷成绩，不是识别率。**

### 补漏〇（安全级）：`未 V / 没 V`

第七轮的否定护栏是按词加的（别 / 不要 / 不用那一族），压根没覆盖「未完成 / 没核完」。新增 `hasUnrealizedComplement`，判据**刻意比那一族窄**：只认否定词紧贴命令动词，中间隔了定语不算 —— 否则「把没用的那条删了」里的"没"是定语，会把一条正常删除掐死。`useChatAgent` 的拒绝文案跟着按 `negated / unrealized / consult` 三档分开，各说各的原因。

### 补漏一：农历节日（窄年份表，出范围不猜）

`extractDate` 补进 春节 / 除夕 / 端午 / 中秋 / 圣诞。**只收 2026–2028 三个年份，且每个日期都对外部权威来源核过才写进表**（凭记忆写农历日期比不写更危险；核对时确实抓到一处来源把 2025 年的日子标成 2027，已弃用）。表外年份一律不落日期 —— 编一个截止日，用户会照着安排事情，比"没听懂"伤得多。农历年初判定按"过了就滚到下一年，滚一次还没有就放弃"。「X前 / X后」= 节日 ∓1 天。

### 补漏二：裸序号与并列序号

「把第一个和第三个都完成」过去只办第一条。现在 `stripNoise` 把汉字序数归一成阿拉伯数字（此前 PARTICLES 里的「一个」会把「第一个」剥成「第」，序号通道整个失效 —— **第七轮的 O 组安全底线因此从 13/13 掉到 12/13，是被门禁抓到的，不是被用户发现的**），并列多目标走 `multi` 只列清单；`buildTarget` 认「第一/第二…第十」但**强制要求量词**（裸「第一」不带"条/个"不算，标题里"第一季"这类写法太常见）。

### 补漏三：不带「把」的裸连写

「办公室绿植不用换了季度发票核完」没有逗号也没有「把」，过去只会硬认第一件。放弃"标题词典最大匹配"那条路（要养一份词典，且词典永远新不过用户的标题），改成**反向验证**：每个切点都试一次，只有两截**各自**都能锁定列表里互不相同的真实任务时才拆。列表里没东西的「把伞收了把鞋换了」照旧不动。

### 补漏四：错字容错（救援通道，不抬置信）

`textScore` 加 OSA 编辑距离（含相邻交换一档）与 `similarityFuzzy`，只在强匹配和常规弱匹配都空手时兜一批澄清候选。返回值**固定 0.45**，刻意卡在门槛 0.5 之下 —— 这条架构红线是用数值表达的，不靠调用方自觉：容错结果天生只可能进 `nearMatches`，不可能进 `matches`。装拼音词典要几十 KB 起，而待办标题只有 4~8 字，等长窗口允许一处编辑已经接住了同音/形近手误，词典并不能多认什么。

### 结构式识别（认结构，不再枚举动词）

「三季度发票我核完了」「需求文档我码完了」里的 核/码 永远补不完。**V + 完/好/掉/妥** 的动词是开放集、补语只有四个字，于是改认结构。代价立刻显形：

- **同位置必须输给词表**：这条规则被放在 `COMMAND_RULES` **末尾**，靠书写顺序裁决同分 —— 「把收集箱任务干掉」仍是 delete，不是 complete。`stripAction` 同时改为"同意图多条规则取最左命中"，`qa-nl-drift` 的比对口径同步改成 `some`。
- **程度词不能升成命令**：「这个方案很好」「时机太成熟不好」靠一串 `(?<!先)(?<!要)(?<!很)…` 前视断言挡在命令之外，并配了反向断言。
- **框式 delete 与禁令同形**：「办公室绿植不用换了」和「不要删了这条」是同一个框，无条件放行会删掉用户明说别删的任务。改按「了」后面剩什么分家 —— 什么都不剩（或只剩语气词）= "不再需要"→ delete；还剩一句自己的动作 = 两件事 → 交给 multi；只剩一个宾语 = "了"属于框里的动词，否定确实辖住了它 → 拒答走澄清。判据不用词典（宾语和从句的分界本来就没有词汇答案）。
- **`不需要` 补进否定词表**：旧表只有「不用 / 不必」，「不需要完成回测报告」字面上摆着"完成"，护栏压根不看它。

### 评测与验证

- `npm run test:nl`：覆盖率 44/44、漂移门禁 174 条触发词 / 12 条命令规则一致。
- `npm run test:nl:heldout`：一至八轮全绿，第七轮 O 安全底线 13/13、第八轮 S 安全底线 12/12。
- `npm test` **444 用例 / 20 文件全过**（本轮 +33：结构补语、极性护栏三档、裸序号、农历窄表、裸连写反向验证、容错档门槛）。八轮语料收敛到 `scripts/heldout/round-01..08.mjs`，总入口 `scripts/qa-nl-heldout.mjs` 一条命令跑完八轮（支持 `--round N` / `--verbose`）；第七、八轮是**硬门**（未过非零退出），前六轮是探针只报告。R 已知上限板照常计分、照常进失败明细，但**不决门** —— 其中「续鉴舞蹈班合同」一条是主动记为上限、决定不修的项（0.5 门槛在 7 字短标题上偏松，收紧会砸掉第一到七轮）：硬门里放一个已知不过的条目，门就不再是门。
- 新写的 `textScore` 容错测试顺手纠正了一处注释里的错例：「疫苗 → 苗役」看着像一次手误，实际换了序又换了字，是两处；真正的相邻换序是「疫苗 → 苗疫」。

### 仍未解决（实测出来的上限，不是漏掉的 bug）

R 板「续鉴舞蹈班合同我填好了」：7 字标题带一处错字时，**主通道**（bigram 覆盖率）自己就给到 0.571 ≥ 0.5，直接进了 `matches`。这不是容错档越权，是 0.5 这条线在短标题上偏松；收紧它会回头砸掉第一到第七轮，所以留着。标题里自带「逾期 / 到期」等查询词的命令句仍会被读成查询（只读误判，代价是多问一轮）。可引用的泛化数字是第八轮首跑的 **43.3%**；下一个干净数字要等第九轮首跑。

### 评测基建整理（scripts/heldout/）

八轮 held-out 语料从 `scripts/` 下平铺的 `qa-nl-heldout{,2..8}.mjs` 收敛为 `scripts/heldout/round-01..08.mjs` + 一个总入口 `scripts/qa-nl-heldout.mjs`：一条命令跑完八轮、逐轮打印汇总、硬门（07/08）未过即非零退出，支持 `--round N` / `--verbose`；`npm run test:nl:heldout` 随之缩成一条命令。目录内 `README.md` 记下轮次分工与「先记首跑成绩、再动手补」的评测纪律。同批清理：一次性核对脚本 `shot-toggle.mjs`、Trae 取证素材（PNG 与 JSON 快照，共约 5.5 MB）按「均可由文档命令复现」原则留在本机、不入库；该外部项目解析目录已在 v1.5.1 收尾清理中整体删除。

### 质量

- `npm test` **444 用例 / 20 文件全过**；`test:guard` 20 文件 / 444 用例全部跑到。
- `test:nl`：基线考卷 44/44（桶 A 全过）、漂移门禁 174 条触发词 / 12 条命令规则一致。
- `test:nl:heldout`：八轮全过 —— 硬门第七轮 O 安全底线 13/13、第八轮 S 安全底线 12/12；可引用的泛化数字仍是两轮**首跑**的 74.2% 与 43.3%（重修后的满分是考卷成绩，不是识别率）。
- `test:ui`：类名契约 0 缺失 + 对比度 **90 组 0 失败**。
- `test:settings` 15/15、`test:tools` **74/74**、`test:responsive` **30 档 / 358 项断言 0 失败**。
- 四个攻击脚本：46/46、95/95、35/35（+7 观察项）、28/28。

### 下载

| 文件 | 体积 | SHA-256 | 说明 |
|---|---|---|---|
| [`Worktodolist.exe`](./Worktodolist.exe)（仓库根目录，随本次提交入库） | 3 730 944 B (3.56 MiB) | `be89fc8a18f18558d35efa4f501ed21aeb6d3944dbb47d61e82b9033d04e8378` | 绿色单文件，双击即用；需系统自带 WebView2 |

从本版起构建产物直接随仓库分发：仓库根目录的 `Worktodolist.exe` 即 v1.0.4 的构建结果（`FileVersion` 1.0.4，与 `src-tauri/target/release/` 下产物逐字节一致，哈希见上表）。启动器检测到源码比它新时照旧自动重建，因此这个文件同时是「最近一次发版」的快照；历史版本的 NSIS 安装包仍在 GitHub Releases。

## v1.0.3 · 2026-10-17

**RTI 耐热指数工具重做**：把「先填数据、再切到别的页签去翻结果」的检查器式界面，改成**答案流**——单列自上而下，先给结论，再给证据，最后才是录入。顺带把寿命推算并进按温度展开的明细里，并让表格与图表真正能直接上手点、粘、敲。

### 下载

| 文件 | 体积 | 说明 |
|---|---|---|
| `Worktodolist.exe` | 3 721 216 B (3.55 MiB) | 绿色单文件，双击即用；需系统自带 WebView2 |
| `Worktodolist_1.0.3_x64-setup.exe` | 3 141 312 B (3.00 MiB) | NSIS 安装包，装到当前用户，附开始菜单/桌面快捷方式 |
| `SHA256SUMS.txt` | — | 上方两个文件的 SHA-256 校验和 |

### 答案流：先看结论，再看证据

原先工具是三个并列页签（`寿命` / `RTI` / `对比`），结果藏在页签后面，改一个数要先切页。现在是一条流水线：

- **页签收敛为两个**：`耐热指数` / `多材料对比`；外壳从工具箱切到工作台布局（`workbench`）。
- **结论卡置顶**：`RTI@20,000h`、`RTI@100,000h` 两张结论卡排在最上面，紧跟其下的就是**各温度下的 `t₅₀` 表**（同列、同宽），再往下是 `Ea` / `R²` 统计条——一列扫下来就是结论。
- **Arrhenius 图紧随结论**：寿命—温度拟合图（`图 2`）与结论卡同屏，不必下翻。
- **按温度展开证据**：各温度 `t₅₀` 表就在结论卡下方，每个温度一行，点开才展开该温度的衰减曲线（`图 1 · <T> °C 的衰减曲线…`）、数据点与拟合；收起时只留温度与结论摘要。
- **录入区默认收起**：数据录入/粘贴整段折叠在底部，首次展开后按需使用，不喧宾夺主。

### 实时计算，改数即出结果

模型层改为纯函数（`src/lib/rti/model.js`：`rowsFromDemo` / `emptyRows` / `groupRows` / `compute` / `legacyRows`），界面用 `useMemo` 实时重算——**改动任何一格数值，结论、曲线、拟合同时刷新**，不再需要点「推算」按钮。

### 寿命推算并入明细

原 `寿命` 页签（单一温度下推寿命）不再单列，改为**按温度展开的明细内联**：展开某温度即可看到该温度下的推算与分析，与衰减曲线、数据点同处一处。界面上也不再出现「原『寿命推算』页」这类回指旧版式的话——那一页已经不存在了，留下这种提示只会让新用户去找一个找不到的地方。

### 直接粘表、键盘录入

- **整段粘贴**：录入区支持从表格（Excel / 文本）直接粘贴，按温度合并而不是整段覆盖（合并弹窗可确认）。
- **行内格子粘贴**：数据网格的单元格支持行内粘贴多行多列，边粘边排布。
- **纯键盘录入**：`NumberCell` 支持键盘逐格录入与退格清空，不必来回点鼠标。

### 画布交互浮出水面

多材料对比页去掉右键这种隐藏手势：

- **点击即用**：左键点图上一点即固定该点，再点同一点取消；另有可见的「取消固定」按钮。
- **悬停读数**：常驻的读数浮标（`chip`）跟随悬停显示坐标与数值，固定时保持显示。

### 导出 / 导入改成 Excel（`.xlsx`）

原来右上角的「导出数据 / 导入数据」是 JSON —— 对着一份实验数据，用户真正想做的是"在 Excel 里改两格再喂回来"，而不是面对一段看不懂的 JSON。现在：

- **导出**：一个 `.xlsx` —— `耐热指数`（顶部是材料名称 / `P₀` 参数行，下面就是那张 `T` / `t` / 特性值录入表）、`推算结果`（有结果时才写：各温度 `t₅₀` / 回归参数 / `RTI` + 95%CI / `Ea`）、`多材料对比`（材料名 / 温度 / `t₅₀`）、`对比图设置`（温度轴上下限 + 对数纵轴）。
- **导出入口收敛成一个**：以前顶部「导出数据」、结果页「导出结果 CSV」、对比页「导出数据 CSV」三个出口并存 —— 其中对比页那个 CSV 与 `多材料对比` 表内容完全重复，命名又和顶部几乎同名。现在结果并进 `推算结果` 表，删掉页内两个 CSV 按钮，只剩顶部这一个 `.xlsx` 出口（页内保留「保存 PNG」）；`.xlsx` 里输入与结论同处一个文件，仍可回导。
- **另存为，不再默默进下载目录**：点「导出数据」或两页里的「保存 PNG」都弹原生「另存为」对话框，让用户自己挑位置与文件名（Tauri 侧走新增命令 `fs_save_as`，与选数据目录同一套 Rust 侧 dialog；浏览器侧退到 File System Access API 的 `showSaveFilePicker`，再不行才回落到默认下载）。用户取消 = 不保存、也不报"已导出"；保存失败才提示。
- **导入**：按**内容**认格式，不看扩展名 —— xlsx（ZIP 头 `PK`）走 Excel 通路；仍以 `{` 开头的**老 JSON 备份继续读得懂**，旧文件不作废。
- **零新增依赖**：`src/lib/rti/xlsx.js` 是自带的一只极简 xlsx 读写器（写用 store，读兼容 deflate，内含一段自带 inflate），所以"在 Excel 里打开另存过"的压缩文件也读得回来；数据与工作表的映射规则放在 `src/lib/rti/excel.js`。
- **读的一侧按内容找位置**：参数行被删、中间插了空行、表名被改，只要还认得出「老化温度 / 特性值」这行表头，数据就进得来；`excel.test.js` 钉住「导出 → 再导入 == 原样」。

### 构建链路：修掉「双击图标还是老版本」的真凶

双击桌面图标时，构建窗口会一闪就退出，启动器日志里只留一句 `rc=1`（实测 **0.3 秒**）。根因不在构建脚本，而在启动器怎么把子进程拉起来：桌面图标由 `pythonw` 运行（**没有控制台**），而弹可见构建窗口那条路径同时指定了 `stdin=DEVNULL`。Windows 只要指定了三个标准句柄中的任何一个，就要求**三个句柄全部**显式传下去 —— `pythonw` 的 `stdout`/`stderr` 本身是无效句柄，`cmd.exe` 于是在第一次输出时当场退出。从控制台手动跑 `python launch_todolist_tauri.py` 一切正常（有有效句柄），正是这个差异让它长期隐身。

- **修法**：可见构建窗口那条路径不再重定向任何标准句柄，子进程直接拿新建控制台自己的句柄（`CREATE_NEW_CONSOLE` + 不传 std）。QUIET 路径三个句柄都给全（stdout 落 `.todolist-build.log`），不受影响。
- **构建脚本自诊断**：每次构建都往 `.todolist-build.log` 写面包屑（开始时间 / 工作目录 / 实际解析到的 `npm` / 退出码）。窗口一闪就退出的失败，事后只能靠它追。
- **npm 兜底**：构建窗口继承的是 Explorer 缓存下来的 PATH，可能早于 Node 的安装。脚本找不到 `npm` 时按 `%USERPROFILE%\.workbuddy\...\node\versions\*` → `C:\Program Files\nodejs` → `C:\Program Files (x86)\nodejs` 依次回落到已知位置，再把该目录前置到 PATH。进不去 `todolist-gui`、或找不到 `package.json`，直接以退出码 3 / 2 中止并写明原因 —— 而不是落进 npm 的 `ENOENT` 里只留一个数。
- **失败弹窗摊开信息**：退出码、耗时、`.todolist-build.log` 末尾几行（去掉 ANSI 颜色）一并写进「构建失败」对话框；耗时不足 5 秒时直接点明「多半是构建窗口被立刻关掉，或 npm 没能起来」，并给出重试命令。

### 修复（2026-10-17 追加）

多材料对比图的交互与启动器的失败回退各修一批：

- **悬停只剩一个读数浮窗**：命中点旁原本既有画布内手绘的提示框、又有画布外的 DOM 读数片，内容几乎一样、彼此遮挡。现在画布这层只画十字准星与高亮圈，读数统一交给那一个 DOM 读数片。
- **点击「线」时高亮不再穿出坐标框**：拟合外推在温度两端可能远高于 / 低于 Y 轴，而加粗高亮线原先画在裁剪区外。现在与主绘图区一样裁进坐标框内。
- **X 轴温度标注放大并错层**：字号 13 → 15；相邻标注若干涉，则把**右侧**那条整行抬高一层（还挤就继续往上找空行），不再横向硬推 —— 硬推会让标注偏离它所指的那条竖线，读数跟着指错。
- **坐标框外不再冒出读数**：命中测试此前只看横向范围与到几何的距离，光标落在绘图区外的边距里（上方/右侧刻度那一圈）、或停在「被外推到 Y 轴之外」的拟合线段旁，也会冒出读数与十字准星 —— 读数还会画到坐标框外。现在只认绘图区之内、且确实看得见的命中：光标在框外直接没有反馈，拟合线先按 Y 轴上下限裁到可见段再参与命中。
- **重建失败也要把应用打开**：构建被中断（构建窗口被误关 / 按了 Ctrl+C，退出码 `0xC000013A`）或编译报错时，只要硬盘上还有上一次的产物，启动器就**照旧把它启动**并弹窗说明「现在跑的是上一次构建的版本，不含最新改动」。不再「问一句、答否就什么都不开」—— 那正是「双击图标没反应」的来源。`0xC000013A` 会单独点明是构建窗口被关，而不是把编译错误混为一谈。
- **改单测不再触发重建**：产物新鲜度判定忽略 `*.test.js` / `*.test.jsx` / `*.spec.js*` —— 它们不会被 vite 内嵌进 exe，改一个断言不该白等两分钟。

### 兼容与保留

- **存档键与版本不变**（`todolist.tool.rti.v1`，`stateVersion: 1`），旧数据不孤立：`applyIn` / `isValidArchive` 同时兼容旧结构（`life` + `rti.temps`）与新扁平结构（`rti.rows`）。
- **旧数据迁移**：优先把 `rti.temps` 摊平为行；仅当摊平后有效温度不足 2 个、且旧 `life` 有 ≥2 个点、温度不冲突时，才把 `life` 并为一个温度组。
- **既有能力一件不少**：PNG 导出、自动保存、粘贴导入照旧；导出统一走顶部那个 Excel（旧 JSON 备份仍可导入），页内 CSV 导出按上文并进 `推算结果` 表后移除。
- **基准值未动**：`t₅₀` 185→1329 / 170→3860 / 155→12,518 / 140→43,499 h；RTI@20,000h = 149.2 °C（95% CI 148.9–149.5）、RTI@100,000h = 130.5 °C（95% CI 130.0–131.1）；`Ea` = 122.2 kJ/mol、`R²` = 0.99997。

### 质量

- 单测 **358/358**；`test:guard` **19 文件 / 358 用例**全部跑到（含新增的 xlsx 读写与 Excel 映射两组用例，以及「推算结果只写不读」一组）。
- 浏览器端到端 `test:tools` **66/66**（含定位到 `.tool-pane` 的「无推算按钮」检查、行内粘贴用例）。
- `test:ui` 类名契约 **0 缺失** + 对比度 **90 组 0 失败**；`test:responsive` **24 档 286 断言 0 失败**。

## v1.0.2 · 2026-10-16

启动器自愈重建、列表选中语义与编辑浮窗、系统托盘与窗口置顶、侧栏可展开分组，并整体移除联网解析（应用运行期不再有任何出网请求）。**纯本地离线**：数据只存 `todo.txt` / `done.txt`，不联网。

### 下载

| 文件 | 体积 | 说明 |
|---|---|---|
| `Worktodolist.exe` | 3 708 416 B (3.54 MiB) | 绿色单文件，双击即用；需系统自带 WebView2 |
| `Worktodolist_1.0.2_x64-setup.exe` | 3 133 698 B (2.99 MiB) | NSIS 安装包，装到当前用户，附开始菜单/桌面快捷方式 |
| `SHA256SUMS.txt` | — | 上方两个文件的 SHA-256 校验和 |

### 启动器自愈：源码一改，双击图标即为新版

修掉反复出现的「改完代码，双击桌面图标还是老版本」。根因有两个，缺一不可：

- **前端在构建时被内嵌进 exe**：`Worktodolist.exe` 是前端 + Rust 壳的静态快照。启动器原本只负责「找到现有 exe 并拉起」，从不重建 —— 于是源码改了、exe 没改，图标自然还是旧版。
- **运行中的实例锁着 exe**：应用「关窗不退出」（收进托盘、进程常驻），exe 一直被占用。即使手动 `tauri build`，构建也会因无法覆盖被占用的文件而失败 —— 这是「明明重建了却还是老版」的第二个根因。

- **启动器自愈重建**：`launch_todolist_tauri.py` 现在会比较「会被内嵌进 exe 的源码」（`src/`、`src-tauri/src/`、`tauri.conf.json` 等）的最新修改时间与 exe 时间；过期或缺失时，**先停掉运行中的旧实例**，再重建，然后启动。双击图标拿到的永远是当前代码的版本，不必再手动构建。
- **可见构建窗口**：重建交给新的 `build_todolist_tauri.cmd`（`npm run build:app`，即 `tauri build --no-bundle`，只出 exe、不打 NSIS 安装包），弹窗显示 vite / cargo 进度；关掉窗口即中断构建。构建失败时回退询问是否仍用旧版启动，绝不静默退回旧版。
- **新增开关**：`--rebuild` 强制重建、`--no-build` 跳过重建直接开现有产物、`--quiet` 下构建输出落到 `.todolist-build.log`；`--status` 增列「产物新鲜度」。

### 列表交互与编辑浮窗

把"点开即编辑"改成更接近桌面资源管理器/邮件客户端的选中语义，并把编辑表单从右侧抽屉改成居中浮窗。

- **单击选中、双击编辑**：单击任务行只把它设为选中（浅色高亮块 + 左侧强调条），不再直接弹出编辑；双击才进入编辑。键盘路径不变（选中后按 `e` 或右键「编辑…」同样可开）。
- **↑ / ↓ 移动选中、回车编辑**：选中后按上下键把选中块沿列表顺序（「今天」视图按 逾期 → 今日 → 无日期）移动，到头即停不环绕；移动时该行自动滚入可视区并接管焦点，光标跟着选中块走。按回车即对选中任务打开编辑浮窗（等价于点 `e`）。焦点在按钮上时回车仍归按钮本身（如复选框的"完成"）。
- **回车即保存**：编辑浮窗内按回车直接确认保存（`Esc` 取消）。
- **@分类 / +标签 下拉候选**：两个字段右侧新增下拉箭头，展开的是 **todo.txt 里已保存**的分类 / 标签（带使用计数），点候选即勾选 / 取消；仍可继续手输，二者写回同一份值。
- **编辑任务改为浮窗**：原来的右侧抽屉换成屏幕居中的浮窗（配套遮罩），小屏下占满可用宽度。浮窗打开时列表的全局快捷键（空格 / e / n）停用，避免穿透到窗后。

### 系统托盘 + 窗口置顶

把「关窗」和「退出」拆成两件事，并补一个「总在最前」开关。

- **关闭不退出**：点窗口右上角的 X 不再结束进程，而是把窗口隐藏到系统托盘（通知区）。窗口是隐藏而非销毁，WebView 继续存活，09:00 提醒照常触发。
- **托盘菜单**：左键点托盘图标唤回窗口；右键弹出菜单——「显示主窗口」/「窗口置顶」（勾选项）/「退出」。
- **完全退出**：只有托盘菜单的「退出」才真正结束程序；退出前同样先走关窗握手让前端刷盘（3 秒兜底），不会丢掉防抖窗口里最后 200ms 的改动。
- **窗口置顶**：页签栏图钉按钮、应用菜单「窗口 → 窗口置顶」、托盘菜单勾选项三处入口，状态互通；开着置顶下次启动自动恢复（偏好存本机 localStorage）。
- **托盘图标只创建一次**：在 `setup` 里 build 一次，之后全程不 `set_icon` / 不 `set_visible`——通知区出现多个图标或图标闪烁，根因就是这两类操作；另外第二个实例在 single-instance 插件阶段就已退出，不会插入第二个图标。
- **启动器区分「已有实例」与「启动失败」**：关窗不退出会让应用常驻，此时再双击桌面图标，第二个实例会被单实例插件以退出码 0 结束并唤回已有窗口。启动器不再把这种「秒退、码 0」当成「缺少 WebView2」报错，只有非 0 退出码才提示；PID 文件也只记录真正活着的主实例。

### 侧栏「分类 / 项目」可展开分组

左侧边栏的「分类 / 项目」做成**可展开的分组**：默认展开、组内只列具体分类 / 项目名，点名称就把右侧主列表过滤到该项。侧栏只当"一眼可扫的目录"，任务列表归右侧主区。

### 移除联网解析

对话页只保留本地规则引擎，联网解析整体下线 —— 应用运行期不再有任何出网请求。

- **设置页改版**：不再有「联网解析」配置面板（地址 / Key / 超时 / 重试与「测试连接」自检全部移除），改为只读的「快捷键速查」（全局 / 列表页 / 对话页）；入口不变（顶栏齿轮 / 应用菜单 / Ctrl+,）。
- **链路清理**：删除 vite 的代理转发、Rust 壳的代理模块、浏览器侧的解析客户端与设置模块，以及随之作废的测试与 QA 脚本。
- **产物变瘦**：去掉 HTTP/TLS 依赖链后，release 单文件 **4.20 MB → 3.54 MiB**，NSIS 安装包 **3.30 MB → 2.99 MiB**。

### 界面文案精简

把界面上的解释性文字收拢到"必要才出现"：能靠控件本身看懂的，不再配一段话。

- **对话页**：移除顶部那条常驻的诊断状态条（「本地规则引擎 · 无网络请求」与「事件日志 N 条 · 最后 seq N」）——对使用者没有信息量；空状态的两句提示并成一句，输入框占位文案缩短。`useChatAgent` 里随之作废的 `logCount` / `lastSeq` 计数一并删除。
- **页签栏**：去掉右上角的 `todo.txt` 品牌字，页签栏只留三个页签与操作按钮。
- **工具页**：页头只留「名称 + 风险徽标」，去掉一排分类标签与整段说明（说明改挂到标题的悬停提示）；去掉左栏底部那条写给开发者的「怎么加新工具」。离线工具也不再逐个挂「不联网」徽标——整个应用已离线，重复声明只是噪音（`riskBadges` 只输出需要留意的项）。
- **设置页**：对话页分组的说明不再提"本地规则引擎 / 不联网"。

### 变更

- **列表项去符号前缀**：分组名由「@分类」「+项目」改为「分类」「项目」，条目由「@工作」「+回测」改为「工作」「回测」——只显示名称本身。符号仍只存在于 todo.txt 数据里（@ 仍是分类、+ 仍是项目），界面上不再重复。
- **只做两层**：`分类 / 项目`（可展开的分组）→ 组内的具体分类 / 项目名。点具体名称 = 右侧主列表过滤到该项（复用既有的 `@:名称` / `+:名称` 视图）。**不在侧栏里往下摊任务行** —— 上一版那一层（展开后列出该分类下的任务行）已去掉。
- **分组行整体可点**：`分类 / 项目` 行 = 展开箭头 + 组名，点击整行即展开 / 收起；箭头在展开时旋转 90° 并转为强调色。组名与条目同一字号（13px）的正文字体 + 半粗，靠字重区分层级，不再靠"变小变灰"。
- **分类 / 项目统一**：两类由同一个组件渲染、共用同一套类（`.sidebar-tree` / `.sidebar-group-toggle` / `.sidebar-caret` / `.sidebar-members`），字体、箭头、缩进完全一致。
- **默认展开**：首屏直接看到具体分类 / 项目，不必先点一下。
- **窄屏**：≤768px 时侧栏仍是横向过滤条，分组与组内条目横向排成一行（可横向滚动），侧栏高度塌成一条（实测 35px）。

### 质量

- 单测 **314/314**（新增 `displayOrder` 列表顺序 3 例；随侧栏摊任务行移除 `tasksByTag` 用例；随联网解析清理移除相关用例）。
- `test:ui` 类名契约 0 缺失 + 对比度 **90 组 0 失败**；`test:responsive` **24 档 286 断言 0 失败**；`test:settings`（快捷键速查）**全部通过**；`test:tools`（页头精简后的外壳契约）**63/63 全过**；`test:guard` 16 文件 / 314 用例全部跑到。

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


> 工具集 P1–P3 与 UI 重定调的历史交付说明、设计全文已在 v1.5.1 收尾清理中删除（其规则早被后续版本覆盖），需要溯源请 `git log -- docs/`。
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
- **刻意保留的"无消费者设施"**（不是遗漏）：`configStore.parseList`、`--ramp-1..5`（StatsTool 在用）、ToolShell 的 `instant` 版式（外壳契约三选一）。
- **条目 16「第三方脚本式工具注册」明确不做**：会击穿"数据主权优先"红线，且外部脚本无法纳入本仓 vitest 门禁。

### UI 重定调「信号仪表」（2026-10-08）

视觉调性整体换血：推翻 2026-10-06「贴近原生桌面工具」的拍板，改走 **候选 C「信号仪表」**（2026-10-07 三选一裁决）。**改动面只有 `index.css` §1 的令牌层**——组件禁裸值的红利兑现，所有组件零改动自动继承。

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
- 全门禁绿：`test` **288/288** · `test:guard` 13 文件 / 288 用例全跑到 · `test:ui` 类名契约 0 缺失 + 对比度 70 组 0 失败 · `test:responsive` 24 档 285 断言 0 失败 · `test:tools` 56/56 · `test:settings` 25/25 · 四个攻击脚本 46/46、95/95、35/35(+7 观察)、28/28。
- 构建 59 → **72 模块**，JS 245.62 → 249.79 kB（gzip 83.97 → 85.51），CSS 40.07 → 51.52 kB（gzip 7.50 → 9.20）。**`RtiTool` 打成独立 chunk 51.63 kB（gzip 19.54）** —— 不打开工具页就不会下载它。
- 新增图标 `toolbox`（2×2 方块）、`thermometer`（温度计），共 16 → **18 个**。
- 样式指南新增 `tools` 视图（渲染真实 `Tabs` + 真实 `ToolsPage`），共 15 个视图。

## v0.1.4 · 2026-10-06

设置集中化：联网解析那套参数从对话页里搬出来，独立成一张设置页。

### 新增

- **独立设置页**（`SettingsPage.jsx` + 设置模块）：服务地址 / Key / 单次超时 / 失败重试 / 启用开关五个参数集中一处。左边说明、右边字段，底部一条动作栏（保存 / 放弃改动 / 测试连接 / 清除配置）。设置不是工作流的一部分，所以它不占页签，而是一张覆盖式独立页面。
- **三个入口指向同一张页**：顶栏齿轮（打开时高亮）、`☰` 应用菜单里的「设置…」、全局 `Ctrl+,`；Esc 或「返回」退出。
- **草稿与已保存分离**：改动只活在设置页里，点保存才落盘；页头出现「未保存」标记，保存按钮此时才可用。「测试连接」故意测草稿值——填完先验证，再决定存不存。
- **超时与重试真正生效**：`timeoutMs` 3000–120000（默认 20000）、`maxRetries` 0–3（默认 1）。只对 5xx 与网络异常重试；4xx（Key 错 / 地址错）不重试——那种情况重试只会让用户白等。
- **配置变更订阅**：保存 / 清除后所有读取点一起刷新，所以设置页改完，对话页顶部那句「会不会联网、发往哪里」当场跟着变。

### 移除

- 对话页状态行里的「联网解析 · 开/关」按钮与整块配置面板全部删除，`index.css` 中的相关死样式一并清掉。状态行只保留一句"当前会不会联网"的明示。
- 旧配置不需要迁移：缺失字段由归一化逻辑补齐默认值。

### 修复

- **「清除配置」的禁用判据错了**：原先用「是否启用」当判据，于是"填了地址与 Key 但没勾启用"时按钮是禁用的——一份含明文 Key 的落盘配置因此永远删不掉。判据改为「本机是否存有配置」。
- **设置页打开时点顶栏页签像假死**：tab 切了但主内容仍被设置页覆盖。改为点页签即退出设置页；`focusAfterSwitch` 相应改成按帧重试，等目标组件挂载后再聚焦（原来是单次 `setTimeout`，在"先关设置页再聚焦"的时序下会落空）。

### 质量

- 单测 215 → **226**（新增 11 例：配置归一化的区间夹取、超时取值来自配置而非常量、5xx 重试到成功 / 4xx 不重试 / 网络异常重试 / `maxRetries=0` 只发一次、订阅通知与"订阅者抛异常不影响写入"）。
- 新增 **`npm run test:settings`**（`scripts/qa-settings.mjs`）：真实浏览器点真按钮的 UI 级验证 25 项——设置页结构完整、旧入口确实消失、保存真的落盘（含超时与重试）、跨组件同步、清除干净、390 宽单列无横向溢出。带 `--shots` 额外输出 `qa-artifacts/settings-*.png`。
- 全门禁绿：`test` 226/226 · `test:guard` 11 文件全跑到 · `test:ui` 类名契约 0 缺失 + 对比度 44 组 0 失败 · `test:responsive` 19 档 227 断言 0 失败 · 四个攻击脚本 46/46、95/95、35/35(+7 观察)、28/28 · `test:settings` 25/25。
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

联网解析检测工具 + preview 模式下代理缺口的修复。

### 修复

- **preview 模式下联网解析绕过本地代理**：`resolveEndpoint` 原本只看 `import.meta.env.DEV` 标志，而构建产物里 DEV 恒为 false——日常双击跑的 preview 会直连上游、被 CORS 拦截，代理在 preview 里配了也白配。改为「DEV 或本机回环来源」即走代理（`isLocalOrigin()`），与"应用永远由启动器服务在 localhost"的部署模型一致。

### 新增：联网解析检测（双层）

- **应用内「测试连接」按钮**（对话页 → 联网解析设置面板）：用真实请求路径发一条测试句，分档报告诊断结果——`config` 未配置 / `proxy` 代理拒绝内网目标（提示放行环境变量）/ `timeout` / `auth` Key 失效 / `endpoint` 地址错误 / `request` / `upstream` 服务商 5xx / `network` 不可达（含 CORS 提示）/ `format` 返回无法解析为有效意图 / `success` 成功并展示解析出的意图。测的是表单当前值，未保存也能测。
- **命令行回归**（QA 脚本）：不需要真实 Key——自动起 mock 上游 + 生产 preview，断言六件事：转发到达上游、路径拼接正确、Authorization 透传、目标头不泄漏、未放行内网目标 403、缺失目标头 403。这条脚本的存在理由：router 存量 bug 已证明「全绿测试 + 成功构建」发现不了配置层静默失效。

### 质量

- 测试基线 199 → **208 例全绿**（连接检测九个分档用例）。
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
- **联网代理修复 + 硬化**（评审 P2-2 + 存量 bug）：实测发现原实现的 `router` 选项在 vite/http-proxy 中**根本不存在**，联网解析代理自始至终返回 500（从未真正转发过）。已改为 `configure` 包装 `proxy.web` 按请求注入目标（读 http-proxy 源码确认每请求覆盖能力），dev/preview 共用。同时加固：只放行公网 http(s) 目标，回环/内网网段一律 403，可用环境变量显式放行本地服务。附回归测试（5 例）。
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
