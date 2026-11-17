# AGENTS.md

> **本文件是本项目对 AI 编码 Agent 的唯一权威规则源。**
> `.workbuddy/memory/MEMORY.md` 只是 WorkBuddy 的会话摘要（派生缓存）：**新增或修改约定一律写本文件**，不要往那里加规则；两处不一致时以本文件为准，并尽快把摘要同步过来。
> 面向人类的说明在根目录 `README.md` 与 `docs/`（索引见 `docs/README.md`）。

## 一句话定位

Tauri 2 + React 的本地待办清单。**根目录 `todo.txt` / `done.txt` 是唯一数据源**（topydo 兼容，一行一条），完全离线、不联网。前端在 `todolist-gui/src/`，Rust 壳在 `todolist-gui/src-tauri/`，说明文档在 `docs/`。Windows 为主（NSIS），macOS 附建。

## 工作目录与命令

所有 npm 命令都在 **`todolist-gui/`** 下执行，别在仓库根跑。Node 必须 22+（`package.json` 的 `engines`，用到 `node:fs` 的 `globSync`）。

```
cd todolist-gui
npm ci                  # macOS 上用 npm ci --force（package.json 有 win32 专用 esbuild 可选包）
npm test                # vitest run
npm run test:ui         # qa-css-check + qa-contrast + qa-typography + qa-hooks
npm run build           # vite build → dist/（会被 tauri build 内嵌进 exe）
```

**每次改动至少跑完上面后三行且全绿，再提交。**按改动范围追加：

| 动了什么 | 追加命令 |
|---|---|
| 测试文件、`src/lib` 下的纯函数 | `npm run test:guard` |
| 设置页 | `npm run test:settings` |
| 布局、窄边降级 | `npm run test:responsive` |
| 工具页 / 提议落盘链路 | `npm run test:tools`、`npm run test:attack` |

其余门禁脚本见 `todolist-gui/package.json` 的 `scripts`，不要自己另造一套校验。

## 三条红线（不可协商）

1. **纯文本是唯一数据源**：不换 SQLite / 二进制格式，不加联网同步。grep、git、topydo、脚本批量操作是立身之本。
2. **外部编辑器只能「检测」不能「上锁」**：兜底是原子写（tmp + rename）+ 前端 external change 冲突提示。
3. **外观 / 偏好不写进 `todo.txt`**：走 `configStore`（localStorage，一个能力一个键）。

## 数据模型（别合并的两组概念）

- `stableId`（`id:<6位base36>`，写进文本、永不变，供子任务 `parent:` / 重复 `rec:` / 备注引用）≠ 运行时 `task.id`（每次解析现算，服务 React key 与拖拽）。ID 分配在 `useTodoStore` 的 add/updateTask，**解析器保持纯函数**。
- `rec:` 三语义：以 `due` 为锚点推进（不是今天）；结果必须严格晚于今天；每月从 anchor 重算（防「31 号」被 2 月拽成 28 号）。下一次是**另一条任务**（新 id / 新 stableId，parentId 保留）。
- 标签策略：`id:` / `parent:` 非法值**丢弃**；`rec:` 非法值**留在 extraTags**。
- 重复预设只给**「从不 / 每日 / 每周 / 每月」四项**（`RECURRENCE_CHOICES`）。已有 `rec:mon`、`rec:+2w` 这类手写值由编辑浮窗动态补一个「当前值」选项，不能静默改成「从不」——精简下拉不等于可以丢数据。
- 备注存数据目录 `notes.md`（`## <stableId>` 分节），保存走「读 → 合并 → 写」，**删任务不删备注**。每日备份已覆盖 notes.md。

## 代码约定（从代码里推不出来的）

- 裸 `rgba()` / 裸 px 字号会被 `qa-css-check` 拦下：先在 `src/index.css` §1 加令牌，**明暗两套都要加**。8 档字阶数值已冻结。
- `qa-settings.mjs` 的分组清单是**严格顺序等式**（现为七节：列表外观 / 阅读密度 / 显示模式 / 数据 / 全局 / 列表页 / 日历），页头说明必须含「只读」（只读说的是三节快捷键速查）。「数据」节是页面上唯一带真动作的地方。
- **Hooks 数量每次渲染必须恒定**：不要在提前 `return null` 之后调 Hook；条件渲染拆子组件，初始态用 `useState(() => …)`。`main.jsx` 的 `AppBoundary` 不许摘。
- **JSX 子元素里的注释必须写 `{/* */}`**，写 `//` 会被当成文本节点渲染（曾画进任务行、撑坏布局，而 726 条单测全绿）。
- **Esc 是逐层退出**（2026-11-17）：编辑浮窗 / 日期弹层 / 右键菜单 / 日历浮层 / 设置页 / 工具工作态各自先消费；列表页与工具墙退到最外层才 `hideToTray(store.saveNow)`（Rust `app_hide_to_tray`，先刷盘再 `hide()`，与关窗托盘的收尾同一动作）。冲突弹窗是阻塞层，Esc 不藏窗。浏览器模式整体空转，不产生 IPC。
- 纯函数单测拦不住渲染错误：**改组件要补渲染测试**。
- 新增说明文档放 `docs/` 对应子目录，命名 `<YYYY-MM-DD>-<主题>.<ext>`，并更新 `docs/README.md` 索引 —— 索引不更新等于没归档。**根目录不放说明文档**（本文件是工具约定文件，属例外，因为编码 Agent 只在仓库根 / 就近目录自动发现它）。
- 版本号三处同步：`src-tauri/Cargo.toml`、`todolist-gui/package.json`、`src-tauri/tauri.conf.json`。**实际有五处**：两个 lock 文件（`package-lock.json` 的 root 两行、`Cargo.lock` 的 `worktodolist` 条目）也要一起改，否则 `npm ci` / `cargo` 会自说自话。
- **换行符由根目录 `.gitattributes` 钉成 LF**（`* text=auto eol=lf`，只有 `cmd`/`bat`/`ps1`/`vbs` 留 CRLF）：一批版式契约测试直接读 `index.css` / `*.jsx` 源码做字符串断言，Windows runner 的 `core.autocrlf` 把文件 checkout 成 CRLF，断言就全部落空。2026-11-16 因此让 v1.5.0 的 Windows 流水线挂了 4 个（macOS 全绿）—— 别删这个文件，也别在测试里靠 `\n` 去断言多行源码时忘了它会生效。
- **日期 / 时刻字段统一走 `src/components/DateField.jsx`**（值转换纯函数在 `src/lib/dateField.js`）：编辑浮窗 `due`/`rem`、提议弹窗、批量工具的日期操作值共用这一处；QuickAdd 内联 `due:`、中文指令、日历拖拽属不同交互范式，保持原样。**值形状锁死** `due: YYYY-MM-DD` / `rem: YYYY-MM-DDTHH:mm`，不许为加时刻去扩展纯文本标签。中文 locale、周一起始、roving tabindex 由 `@daypicker/react` 提供，外观一律用 `index.css` 令牌覆盖 `.rdp-*`；弹层用 `createPortal` 挂 `body`，避开 `.drawer-body` 的 `overflow-y: auto` 裁切，下方空间不足时翻到字段上方。

## UI 语言：工作登记簿（2026-11-07 定稿，11-06 那版作废）

可核对、安静、有刻度；签名是「行号 │ 源文本行」。**原文只出现在展示文件内容处**（写入行 / 纸页 / 语法提示），界面读数要让人读懂。设计全文与截图见 `docs/design/2026-11-07-UI全量重做-工作登记簿.html`。

- **少写说明，让布局自己说话**（avoid unnecessary secondary labels and descriptions. Let the layout do the explaining）：位置、分组、留白、对齐、缩进已经说清的关系，不要再叠一层二级标签、字段说明、辅助描述或提示文案；每留一行解释性文字，都要能说出它承担了哪项读数功能。例外：写入行 / 纸页 / 语法提示里展示的原文、必要的无障碍标签，以及门禁明确要求的文案（如设置页页头必须含「只读」）。
- 优先级（2026-11-15 定稿，旧「四档字阶徽章」与「3/2/1 枚感叹号」都作废）：**列表**＝标题最左边一枚**中空旗**，颜色就是档位 —— 高红 / 中橙 / 低蓝，「无」整枚不画（不留占位，但有固定 18px 旗标槽 `--flag-slot`，标题与下方读数行始终对齐）；**编辑设定界面**用「高 / 中 / 低 / 无」四个汉字按钮；**行内快捷旗标按钮点击 = 弹出「高 / 中 / 低 / 无」下拉**（红 / 橙 / 蓝 / 黑四枚旗样张 + 汉字）。档位单一真相源 `lib/priority.js`（`priorityClass`；`priorityBangs` 已删）→ `PriorityMark.jsx` 三形态：`badge`＝列表旗标（带 title/aria）、`flag`＝菜单样张（无提示）、`mark`＝日历 / 写入行的紧凑方块，类名 `prio-none|low|mid|high|other` 不变。`(A)/(B)/(C)` 只是 todo.txt 写法，留在 title / aria-label 里。D~Z 走 `prio-other`（次级墨色），不冒充三档。2026-11-17：编辑设定界面的选中档也跟列表旗同色，边框取 `--flag-*` 实色、底取 `--flag-*-soft`，字取对应实色（中档文字用同色相压深的 `--flag-mid-ink`，13px 对淡底需 ≥4.5），不再一律走 accent 绿；「无」保持中性。
- **颜色只编码状态**：逾期是整行唯一强色，accent 只表选中 / 今天 / 焦点。例外是用户自己打的记号：优先级旗标 `--flag-high|mid|low`（红 / 橙 / 蓝，列表里那一枚中空旗）。`--danger` 只给逾期与危险，`--prio-flag` 只留给日历 / 菜单里的紧凑记号，明暗各一套近似色，别再引新色系。第二处例外是**日历格子里 chip 的整块底色**（`--chip-*-bg`，2026-11-16 十五改）：那一格里没有字号 / 记号的余地，四档只能靠色相分开，见「日历与窄边降级」节。
- 字体两族：`--font-ui` 管文字、`--font-mono` 只管读数（另有 `--font-mono-cjk` 中文回退）。`--font-display/--font-body` 已删，不要引入；`600` 只给白名单选择器；字体取系统栈，**不打包 webfont**。
- 列表标题与侧栏条目（`.task-title` / `.nav-item`）字重用 `--fw-body`（400），与新建任务框提示文字同一口径：正文靠字号 / 颜色分层，**不靠加粗**；`--fw-emph`（500）只留给需要拎出来的小标签（组名、计数、按钮文字）。
- 图标 12/16/24、描边 1.5；圆角 4/6/8/12/16。**行高尺寸（`--nav-h` / `--row-h`）以 `src/index.css` §1 令牌层为唯一真相源**，本文件不复制数值（11-13 排查实测 `--nav-h` 已由 32 改为 26px，硬编码会漂移）。`--control-line` 是 WCAG 1.4.11 契约，别压淡。
- 活动栏底部（2026-11-14 二改定稿）：应用菜单 / 置顶 / 主题 **各一枚**按钮，**不单列「设置」按钮**（入口只在应用菜单，别把同一动作摆两处）。
  - **置顶**：开 = 图钉**实心**（`Icon` 透传 `fill="currentColor"` + `.tab.is-pinned` 把颜色提到 `--text`），关 = 描边；**不套底色块**（用户明确否掉了黑/白框：底色会把轨道读成一排开关按钮，实心图标自己就能表态）。`aria-pressed` 保留（它确实是开关）。
  - **主题只有一枚按钮**，点一次按 `THEME_CYCLE` 轮换 `auto → dark → light`，按钮画的图标是**当前档的记号**：auto＝显示器、dark＝太阳（点它回浅色）、light＝月亮（点它去深色），映射表 `THEME_ICONS`（真相源仍是 `lib/theme.js`）。它不是开关，所以不套实心底、不写 `aria-pressed`，只用 `data-mode` 标当前档；想直接落某一档走应用菜单「外观」。
  - `.tab.is-solid` 已删（置顶与主题都不再用实心底），别再引回来。
  - **图钉随轨旋转 45°**（2026-11-15 定）：`<Icon className="pin-tilt">`，`.pin-tilt { transform: rotate(45deg) }` 只转图形、不转按钮 —— 按钮命中区仍是正方 30/44，图标 16px 内视觉重心也在中心。别改成 `transform: rotate()` 加在 `.tab` 上：那会把 44px 命中区一起拧斜、和相邻按钮的间隙对不齐。
  - 轨内行距（2026-11-16 十七改）：`--rail-row-h` 与标题行同取 `--chrome-row-h`（31px），底部导航取它的 1.2 倍（37.2px，2026-11-17 增高 20%）；`.tab` 横条态比行高矮 1px（`--rail-tab-size` = `calc(var(--chrome-row-h) - 1px)`，即 30 见方），那 1px 留给选中条 / 边框。触屏的 44 兜底**只给宽屏竖轨**（平板左栏）；窄屏横向条仍按 31 走，见文末 coarse 段。
- 侧栏五入口（2026-11-15 定稿）：固定区从上到下＝**今日（check-circle）· 即将到期（calendar-clock）· 全部（grid）· 日历（calendar）· 日志（history，数据仍是 done 视图）**；**「收集箱」条目已取消**（`tasksForView` 的 inbox 分支保留，仅 UI 入口撤掉）；「分类 / 标签」分组保留在固定区下方。**日历不再是页眉切换控件**：页眉 `.mode-switch` 已移除，点侧栏「日历」＝ `App.pickMode('calendar')`（偏好照旧落 configStore、窄边覆盖语义不变）；点其余四个视图若正处日历模式要连带切回列表布局（否则"点了没反应"）。日历条目不占 `store.view`，日历照旧按当前视图取数；选中态互斥 —— 日历模式下四个视图条目全部熄灭。「即将到期」是纯函数 `sortFilter.js` 的 `upcoming` 视图（未完成 + 有 due 且严格晚于今天），**恒按截止日升序**（`compareUpcoming`），排序模式对它不生效。**父项在本屏时会把它的后代一并带进这一屏**（`subtasks.js#withDescendants`，仅无搜索词时）：子任务通常没有 due，不补进来就会出现「有展开箭头、点开是空的」。箭头的出现条件是「有子任务落在本屏」（`MainList.rowProps` 的 `kidInView`），不是「这条任务有子任务」—— 两套口径必须一致。开关钮图标是 `panel-left`（lucide），自绘 `panel-fold` 已删。
- 上下文条（2026-11-15 四改）：**左**＝面板开关 · 面包屑，**右**＝放大镜 · 排序；四枚控件全是 `.ctx-btn.ctx-btn-icon` 同一族（高 `--ctx-btn-h`＝26px、宽 26、悬停才浮底色），别给某一枚另写尺寸。列表/日历切换控件已从页眉撤走（入口只在侧栏与设置页「显示模式」）。
  - **搜索不常驻**：平时只有一枚放大镜，点它（或按 `/`、行右键菜单、应用菜单「搜索」）才挂出输入框。开关状态在 `App` 的 `searchOpen`（三处入口读同一份），输入框 `autoFocus` +「这一帧没挂上就下一帧聚焦」的兜底；**关闭时连关键词一起清空** —— 否则筛选还在、输入框却不见了，任务会凭空少一半。
  - **排序是一枚图标钮**，不是「排序 · 手动」那种文字按钮：自动＝`arrow-up-down`、手动＝`grip-vertical`（文件行序，可拖拽），当前档写在 `data-sort`。日历里不出这枚钮（那里恒按优先级·日期聚拢，按了没反应）。
  - **面包屑只留「我在哪」**：标题（+项目带色点）+「N 项」。不再有「/ 到期与逾期」「/ 分类过滤」「/ 只读投影」这类替布局解释自己的第二段。分类 / 标签视图只写名字，`@` / `+` 不跟着进标题（2026-11-17）。
- 底部两条已删（2026-11-14）：**今日概览条与状态栏整行移除**，`.workspace` 只有「上下文条 + 内容」两行。保存状态读数与「手动重载 / 切换目录」搬进设置页「数据」节 —— 主界面不再常驻这两颗按钮，但它们不能消失。
- 列表行结构（2026-11-15 十改）：**两行内容，但只有标题参与布局** —— 标题一行；读数行（截止日 / 完成日 / 子任务进度 / 备注 / 重复）折在标题下方、**绝对定位**在行底。行高由 `--row-h` 决定（九改：40→32，行距再收 20%；触屏兜底 44 不变），**纵向内边距归零** —— 32px 里要同时装下 14px 标题（行盒 17.5）与 11px 读数行（行盒 13），再别 3px 就必然撑破，一撑破就退回「行距跟着内容走」。改行高要**同时改 `lib/readingDensity.js` 的 `LIST_ROW_PX`**（三档 28/32/38），否则「没设置」的用户与设置页样张各说各话。三段固定列：复选框 `--cb-size`(18) · 正文 `1fr` · 行尾箭头槽 `--row-expand-w`(20)。**子任务行不吃这套版式**，它是单行的另一套（见本节最后一条）。
  - **行分隔线分两档**（2026-11-17）：主行 `--row-line`（比 `--border` 淡约 30%）+ `--row-line-halo` 的 2px 柔光；子任务行 `--row-line-child`，几乎不可见。连接线（`::before` / `::after`）仍用 `--border`，别把结构线和分隔线混成一条。
  - **读数行**：`position: absolute` + `left: calc(--row-pad + --cb-size + --sp-3 + --flag-slot)` 与标题正文对齐，右缘止于箭头槽左侧；截止日字号 `--fs-2xs`、颜色 `--muted`，**只有逾期换 `--danger`**（「今天」不再单独染色）。子任务进度是 `list-tree` 小记号 + `完成/总数`，只报数、不是按钮。
    - **读数行五段 + 竖线分节**（2026-11-16 十四改）：顺序固定 `日期 · 子任务 ｜ 分类 ｜ 标签 ｜ 重复 ｜ 提醒`，**整行统一 `--fs-2xs`（与日期同号）**，不再是「日期小、后面更小」。分组在 `TaskRow` 里构造 `metaGroups[]`，**空段不 push、段间才插 `.meta-sep`**（1px × 9px `--border-strong` 竖线，`aria-hidden`），所以竖线数恒等于「非空段数 − 1」—— 别写成固定 4 条再靠 CSS 藏，会留下孤立的线头。日期与子任务进度同属第一段（都是「这一行的状态戳」），不再单独分词。
    - **读数行也报归属**（2026-11-16）：分类（`.meta-ctx`）、标签（`.meta-tag`）、重复（`.meta-field` + ↻ + `describeRecurrence` 规则正文）、提醒（`.meta-field.is-time` + 钟 + `MM/DD HH:mm`）。**只写名字，不写 `@` / `+`** —— 那两个前缀是 todo.txt 的写法，不是界面读数；标签前面一枚 6px 色点（`--dot-edge` 描边，与侧栏圆点同源）。名字可能很长，每一枚各自 `max-width: 14ch` + 省略，不许把日期挤出这一行；`.meta-field` 自带 `--sp-1` 内间隙，`is-time` 走 `--font-mono`。子任务行没有读数行，自然也没有这些。
  - **读数行默认收起、悬停展开，且全程零重排**（十改）：收起态只有 `opacity: 0` + `translateY(2px)` + `pointer-events: none`（看不见时不能替这一行吃掉点击），`:hover` / `:focus-visible` 时 `opacity: 1`、`transform: none`；同时标题组 `.task-head` 走 `translateY(calc(var(--meta-lift) * -1))` 让位。**两处都只碰 transform / opacity，没有任何盒尺寸变化** —— 悬停时行高、行位置、相邻行一格不动。别退回 `max-height`：行高虽不变，但每帧都在改这一格的盒尺寸、整行重排，鼠标扫过列表与滚动时就发涩发闪（实测旧版正是这个观感）。取证口径：静止 vs 悬停的全部行 `top`/`height` 必须完全相同、`PerformanceObserver` 的 `layout-shift` 全程为 0（含连续滚动）。
  - **没有常驻例外**（八改定，十改沿用）：逾期行、带红旗的高优先级行、两者兼有的行，收放与普通行完全一致 —— 曾给逾期行开过 `.task-meta.is-pinned` 的后门，结果是「同是清单项，有的悬停才弹、有的一直摊着」，被读成功能只覆盖了一半。**状态（逾期 / 优先级 / 进度 / 备注 / 重复）只改颜色与记号，不改交互**。`@media (hover: none)` 一律常驻（读数行 `opacity: 1`、标题常驻上移）。**别把 `:focus-within` 加回来**：那会让快捷按钮跟着焦点闪（见下一条），日期要的是 `:focus-visible`。
    - **唯一的时间限定例外：重复任务的交接**（2026-11-16 十八改）。`.task-row.spawned` 在 `--dur-flash`（1.4s）内把读数行常驻展开、标题让位（`.task-row.spawned .task-meta` / `.task-row.spawned .task-head`，与悬停态同一对 opacity / transform，仍零重排）。原因：完成一条 `rec:` 任务时旧行淡出、下一条在**同一位置**长出来，标题 / 优先级 / 旗标 / 位置全同，唯一变的 `due` 恰好折在这行里 —— 不展开它，界面读起来就是「点了一下没消失，隔不到一秒又出现」（真实数据里能数到用户连点 8 次、`due` 被推到 8 天后，`done.txt` 留 8 条同日完成记录）。它是「状态 + 时间」双限定（只有刚生成的那一行、只有 1.4s），**不是某类行常驻**，别拿它当先例。store 的 `SPAWN_FLASH_MS` 与 `--dur-flash` 必须同步改；同时 toast 要报「已为你排到 X」（明天用人话，其余报完整日期），只说「已完成」等于没反馈。
  - **展开 / 收起只认行尾那枚三角箭头**（`button.row-expand`，收起＝朝下、展开＝原地 rotate 180°、`--dur-2` 过渡；`tabIndex=-1`）。**整行单击不再碰子列表** —— 父项行拿回普通行的点击语义（快双击进浮窗、慢双击改标题）。键盘走 `→` 展开 / `←` 收起（`handleRowKeyDown`），所以不必给箭头加一个 Tab 停靠点。收起态本身仍由 `hooks/useRowCollapse.js` 管理、在 `App` 里下发，**主列表渲染 / ↑↓ 导航 / 顶栏「共 N 项」三处必须读同一份**，纯视图状态、**不落盘**。**「今天」自 2026-11-16 起也启用**（那里以前强制 `depth: 0`、连箭头都没有，用户报的就是这条）。可见行过滤走纯函数 `lib/subtasks.js` 的 `filterCollapsed`：只认「父也在本屏」的层级，否则切视图 / 搜索只命中子任务时会把它连带隐藏、任务凭空消失。**子任务行双击不进任何编辑**，它的文本在浮窗子任务区里改。
    - **组头另有一枚一键展开 / 收起全部**（2026-11-17）：只挂在「全部任务 / 即将到期 / 收集箱」这类带计数的主组头右端（`.group-tail` 里、计数之后），图标是双箭头 `chevrons-down` / `chevrons-up`，文案在 `aria-label` / `title`。它调 `useRowCollapse` 的 `setAllCollapsed`，**与行尾箭头读同一份收起态**；只批量改本屏 `canExpandTask` 命中的 stableId，别把别的视图里收好的行一起翻掉。有任意一枚还收着就显示「展开全部」，全部摊开时才显示「收起全部」。
  - **子任务的可见性与层级都按「本屏」算**（2026-11-16 十九改）：`isVisibleToday` 只认任务自己的字段（无 `due` ＝ 今天要做），这条对**子任务**不成立 —— 它没有日期往往只是把排期交给了父任务。于是「父任务下周到期、子任务没日期」时子任务自己混进「今天」，而父任务不在这一屏，行带着缩进堆在分组末尾（真实数据里 7 条子任务整段挂在最后一条「出差报告」下面，用户报的「层级混乱」就是这条）。两条口径必须同时成立：
    - **可见性继承**：`lib/sortFilter.js#todayAdmitted` 在 `tasksForView` 里就把「祖先链不在本屏」的子任务挡掉，例外是它**自己就到期/逾期**（`due <= today`，凭自己的理由进来）。必须放在 `tasksForView` 而不是渲染层 —— 侧栏计数、底部导航、↑↓ 顺序都读它，"看得见几条"与"侧栏报几条"才不会分叉。**不是把任务藏掉**：它在「全部」「即将到期」里照旧挂在父任务下面。
    - **渲染层级只数本屏祖先**：列表行用 `lib/subtasks.js#depthWithin`，不再用 `depthOf`。`nestChildren` 在父不在本屏时会把子任务降级成顶层行（文档契约 ①），此时若仍按全表算 depth，就会画出「有缩进、上面却没有父」的孤行，视觉上像挂在前一条任务下面 —— 搜索、分类/标签视图同样中招。
    - `nestChildren` 同时改成**递归出场**：只推一层的话，三层嵌套里的孙辈会落进 `childIds` 却没人推出来，直接消失（父在、子也在，偏偏孙没了）。
  - **行内快捷按钮只在鼠标悬停该行时浮出**（`.task-row:hover .row-quick`）。`:focus-within` 那条已删 —— 用 ↑↓ 扫列表时右侧一团按钮跟着焦点闪，比没有更难用。按钮仍 `tabIndex=-1`（键盘走快捷键 + 右键菜单）。位置 `right: 行内边距 + 箭头槽宽 + 4`，**永远退到箭头左侧，两者不重叠**；第三列在没有箭头的行上也留空，于是所有行的按钮都在同一位置。
    - **四枚**（2026-11-16 加了编辑）：编辑（`store.openEditor`，与双击等价）/ 旗标（优先级四色下拉）/ 今天（到期日设为今天）/ 删除。
    - **优先级下拉开着时要钉住这组按钮**：菜单是挂在 body 上的浮层，鼠标一移过去就离开本行、`:hover` 立刻失效，按钮当场消失（用户在挑档位，"浮窗"却先跑了）。做法是行上加 `.is-quick-pinned`（`openAt(..., { onClose })` 回调里撤掉），**只碰 opacity / pointer-events**，选完 / Esc / 点外面时与菜单一起收。
    - **优先级下拉用紧凑档** `variant: 'compact'` → `.ctx-menu.is-compact`，宽 92px（标准 184 的一半）：标准宽度是按「复制任务文本」这类长标签定的，四枚小旗撑那么宽只会显得空。
  - **空格不再完成**（2026-11-17）：列表页的完成入口只剩勾选框与右键菜单，`useHotkeys` 不接 `onToggle`；勾选框提示、右键菜单角标、设置页速查都已撤下。日历日期格上的空格仍是「选中日期」，两条语义别混。
  - **子任务行是另一套版式**（2026-11-15 七改，`.task-row.is-child` + `.child-body`）：**单行**，只有复选框 + 标题 —— 读数行（日期 / 完成日 / 进度 / 备注 / 重复）与优先级旗标在 `TaskRow` 里就**不渲染**（不是 CSS 藏起来），悬停**不浮出 `.row-quick`、不挂任何原生 `title`**（子任务行连勾选框的原生提示都去掉，只留 `aria-label`）。版式差异：行高 `--row-child-h`（主行 − 6px，默认 26）比主行矮一档、复选框 `--cb-child`(14) 配 12px 正文（对勾 mask 同步缩到 9px）、两列网格 `var(--cb-child) minmax(0,1fr)`、缩进 28px、字号 `--fs-list-child` + `--muted`。`.child-body` **必须显式 `flex-direction: row`**：`.task-body` 是 column，只改 `align-items: center` 会得到「水平居中、左右不成对」的标题（踩过）。触屏档（`pointer: coarse`）子行回到 44px 行高，勾选框外扩另调到 `inset: -16.5px` 才够 44 命中。
    - **连接线是树形，不是一条通高竖线**（2026-11-17）：`.task-row.is-child::before` 是竖脊，x 对齐**父任务复选框圆心**（`--row-pad + --cb-size / 2`）；`::after` 是每行一段短肘线，指向子任务复选框左缘并留 5px 呼吸。`MainList` 的 `markChildRuns` 按渲染顺序给连续子行打 `.is-child-first` / `.is-child-last`：末行竖脊收到行中腰，单子行竖脊自然归零、只留一个「L」。**别再退回旧版那条从行顶通到行底、x 还落在 `--row-pad + 13px` 的无主竖线** —— 它既不对齐父勾选框也不对齐子勾选框，就是用户点名的「太丑」。
  - 行的「上一次点击」是**模块级共享**的 `lastRowClick`，不能是每行一份的 `useRef`：否则「点父项 A → 点子任务 B → 回点 A」时 A 的 ref 还停在 t1，第二次点 A 会被算成快双击、凭空打开编辑浮窗。
  - 编辑浮窗宽度恒为 `--edit-window-w`（392px），窄边不改 `100%`；`max-width:100%` 只在物理放不下的极窄视口兜底。**`min-width:0` + `flex:0 0 var(--edit-window-w)` 锁住宽度**，内容的 min-content 不得把窗口撑宽。优先级 + 重复同一行（`2fr 1fr`），截止日期 + 提醒时刻同一行。
  - **编辑浮窗内部版式（2026-11-17）**：标题 14px / 400；头部 / 主体 / 底栏左内边距统一 `--row-pad`，标题输入框水平 padding 归零；除标题外全部 13px（与优先级选项同号）。底栏固定 `--drawer-actions-h`（39.9px，比旧 57px 少 30%）、按钮 `--drawer-action-h`（25.6px，少 20%），`.drawer-actions .btn` 的 min-height 要一起写，压过粗指针的 44px 兜底。备注按钮增高 20% 到 26.3px、去铅笔图标；备注容器必须写 `.edit-window .field-note`，裸 `.field-note` 会被后面的 `.field { display:block }` 盖掉、gap 失效。分类 / 标签用 `.tag-input` 一体化容器（边框归容器，`tag-toggle` 是 28px 无边框图标钮）。子任务行 26px、勾选框 16px 圆环、行内编辑 24px；行内编辑选择器必须带 `.edit-window` 前缀，压过 `.field input` 的 32px 全局高度，否则点开编辑又会把浮窗顶高。
  - 日期界面读数统一 `YYYY/MM/DD`（`lib/dateField.js` 的 `formatDateShort`），落盘仍是 ISO 形状；字段旁不摆清除 X，清除只在 `DateField` 弹层底部。
  - 备注区只有一个「添加备注 / 编辑备注 / 完成」按钮，不再叠「备注」文字标签；子任务区上方与备注之前各一条 `.field-sep`，子任务进度线与读数同行。
  - **旗标（`star:`）的图形入口已全部退场**（列表行 / 编辑浮窗标题栏 / 行内快捷按钮）：旗标此后只表示优先级，同一行再摆第二支红旗会让人分不清"哪支是急、哪支是标记"。**数据不删**：解析、写回、`form.starred` 透传都保留，只是界面上不再有开关。

## 日历与窄边降级

- 日历是**列表的第二种显示模式**（不是第四个页签），模式存 `configStore` 键 `worktodolist.list-mode.v1`，三处入口读同一份。
- **日历页只剩网格**（2026-11-15 定稿，参考 Tasks 的日历）：顶部快录框、右侧日详情栏、无日期托盘、跨日区间条**全部删除**（`lib/taskRange.js` 一并删）。任务只在**自己那一天**以 chip 出现（最多 3 条 + `+N`）。**别再把这些加回来**：多日条要新的区间纯函数与车道算法，是这一版明确砍掉的东西。
- **chip 只有标题 + 一档底色 + 一条同族墨条**（2026-11-16 十六改定稿）：**高＝红 / 中＝橙 / 低＝蓝 / 无＝灰**，令牌 `--chip-{high,mid,low,none}-{bg,fg}`（明暗两套），D~Z 与「无」同灰。**左缘有一条 2px 墨条，颜色取该档的 `-fg`**（浅色主题＝同族深色；深色主题 fg 本身是亮色，条也就变亮 —— 不必另造令牌）：用 `.cal-chip::before` + `--chip-bar` / `--chip-bar-w` 画，**不用 `border-left`**（会挤动文字）**也不用 `box-shadow`**（会跟悬停的内描边打架）。于是「一条 chip 只有一档色」：淡的做底、深的做条。项目色点（`cal-chip-dot`）仍然删除，**这是用户明确否掉的一项**（11px 的格里装不下三种记号）。**「无」档的灰必须比日期格底色（`surface` / 周末 `surface-2` / 跨月 `bg`）明显更深**，这是用户点名的「周末格 chip 与格子混色」问题，`qa-contrast.mjs` 里有两条 ≥1.12 的明度差守卫。日志（已完成）根本不再进日历，所以 `.cal-done` 那一支已整条删除（2026-11-16 二十改）；窄屏 8px 色块也关掉墨条（块本身就是记号）。
  - chip **可拖**（拖到别的格子 = 改 `due`，走纯函数 `dropReschedule`，同一天 / 拖回原处都是零写入），悬停给一层内描边 + `cursor: grab`；拖动中的 chip 带 `.is-dragging`，落点格带 `.is-drop`。**不挂 click**：点 chip 等于点这一格（弹当天浮层），再叠一层 onClick 没有新语义。
  - **没有只读态**（二十改）：日历里的每一条都是未完成的活，都能拖、都能改期。曾经的 `.cal-stats-ro` / `.cal-chip.cal-done` / 浮层「只读、无添加入口」三件套是给「日志按完成日锚定」用的，现在一并删除。
- **点日期格 = 弹「当天任务」浮层**（`components/CalendarDayPopover.jsx`）：有任务 → 列表（复用 `TaskRow`，勾完成 / 双击编辑 / 右键菜单都在）+ 底部一颗「添加任务」；没任务 → 直接进添加态（输入框已就位并聚焦）。浮层只有一种形态（没有只读分支，见上）。写入走 `store.addTask(`${text} due:<date>`)` —— 与手敲 `due:` 完全等价，**不另造写入路径**；用户自己写了 `due:` 就以他写的为准。
  - **浮层是"小窗口"，不是气泡**（2026-11-16 十五改）：右上角有**置顶**图钉（开＝实心 + `.cal-pop-pin.is-on` + `.cal-pop.is-pinned` 外框），**拖标题栏可移动**（`pointerdown` 起手，move / up 挂 window —— 挂在标题栏上会在指针离开后被丢掉），位置夹在窗口内留 8px。置顶的那一下把当前位置冻结成屏幕坐标（`pos`），之后**点外面 / 翻月 / 切选中日都不再关它**，因此可以同时开好几天的浮层并排看。未置顶的同一时刻只留一块，且仍跟着锚点自动落位。
  - **列表行走 `TaskRow` 的 `minimal`**：只报标题 —— 日期 / 分类 / 标签 / 重复 / 提醒的读数行整块不渲染，悬停也不浮快捷按钮。理由：这一行的日期就是它所在的那一天，再报一次是噪声；浮出来的按钮会盖住相邻行、把浮层读成另一个界面。根元素带 `.is-minimal`，**浮层里 `.task-head` 恒 `transform: none`**（十六改）：没有读数行可让位，再把全站的悬停上移照搬过来，就只剩「鼠标一扫整行跳一下」。
  - **浮层行高是主列表的 70%**（十六改）：`.cal-pop .task-row` 用 `min-height: calc(var(--row-h) * 0.7)` 收行距（32 → 22.4），**不在浮层里重定义 `--row-h`** —— 那是全站行距的唯一真相源，覆盖它会连带改掉密度设置与设置页样张。
  - **列表与页脚之间不许有缝**：`.cal-pop-rows` 只留上留白，末行由 `.cal-pop-rows > .task-row:last-child { border-bottom: 0 }` 去掉下边框，页脚那条 `border-top` 是唯一分隔。旧版「末行线 + 4px 空白 + 页脚线」叠成两条线夹一条缝，看着像页脚没接上。
  - 浮层是 `createPortal` 挂 `body` 的临时视图，状态刻意留在 `CalendarView` 内、**不进 store**（不是持久状态）。SSR 渲染不了 portal，所以展示层拆成可测的 `DayPanel`。
  - 落点走纯函数 `lib/placement.js#computeDayPopoverPlacement`（先量后放：挂载后按 `scrollHeight` 重算一次），贴格 +4px、末行上翻、右缘夹回、窄屏收宽、矮窗收缩。点亮被点的格子用 `.cal-cell.is-open`（inset 2px accent）。
  - 收起入口集中在 `CalendarView` 一处：点外面（document `mousedown`，只收未置顶的）、Esc（capture + `stopPropagation`，只收最上面一块；**编辑浮窗开着时让给它**）、窗口 `resize`、翻月 / 键盘移日。**滚动不再一律关掉** —— 事件 target 落在任一 `.cal-pop` 里就跳过（浮层里滚轮 / 拖右侧滚动条在 Windows 上会被旧版当成"滚了页面"而把浮层关掉，这是本轮修的 bug）。关的时候**只在焦点本来就在浮层里时**把焦点还给格子，否则会抢走用户刚点的别处。
  - **点邻月的灰格 = 先翻月、再开浮层**（`pendingPopRef`）：那批格子会被整体换掉，锚点必须在新格子上重新量，否则浮层会浮在旧格子腾出来的空位上。别简化成「灰格只翻月不开」—— 用户点它就是想看那一天。
  - 日历里的「新建任务」（`n` 键 / 右键菜单 / 应用菜单）不再是往快录框塞 `due:`，而是发 `addSignal={date, seq}` 让浮层直接进添加态；`seq` 保证"同一天再点一次新建"也是一次新信号。
- 语义：选中日是唯一真相（月份派生、42 格）。**日历只有一份数据来源**（`lib/calendar.js#calendarSource`，2026-11-16 二十改）：
  - 取 `todo.txt` 的**全部未完成**任务（与「全部」列表同一批）—— 切分类 / 标签 / 今日都不该让某一天凭空少几条（十五改）。
  - **日志（`done.txt`）不参与投影**：已完成记录锚的是完成日，画进日历会把"这天要做什么"和"这天做完了什么"混成一张格子，还会把已完成条目读成待办。`calendarSource` 连 `doneEntries` / `view` 这两个形参都不再接收，函数签名就是这条边界的护栏；从「日志」视图切进日历时，`App` 会把视图一并落回「全部」（否则面包屑写日志、格子画别的）。日志只在「日志」页看。
  - 搜索是显式动作，仍在 `projectionForMonth` 里生效。交互语义放纯函数 `lib/calendar.js`（项目无 jsdom，**别为此装 DOM 依赖**）。
- 门禁口径：`qa-settings.mjs` 的日历段是「只剩网格（无快录框 / 右栏 / 托盘 / 区间条）+ 首屏不弹浮层 + 点有任务日弹列表 + 点空日期直接进添加态 + 点邻月灰格翻月并在新格子上弹出（量锚点是否重算）」；`qa-responsive.mjs` 量宽度分配与无溢出。`CalendarView.test.jsx` 里有一条「旧结构不得回流」的断言，删旧代码时别把它一起删掉；十五改另加了「置顶钮 / minimal 行 / 接缝样式 / chip 底色令牌」四组契约。
- **显示模式是持久化偏好，永不因窗口宽度改写**。窄边只是渲染层覆盖（`lib/layoutMode.js`）：`override > 窄边降级 > preferredMode`，进入 `<480`、退出 `>560` 滞回，用 `ResizeObserver` 观测 `<main>` 而非 `window.innerWidth`。
- **窄屏（`max-width: 768px`）不显示侧栏与侧栏开关**（2026-11-15 定）。旧版那套「侧栏转横向过滤条 + 页眉最左留开关」的规则**整段删除**，`TopBar` 的开关加 `.panel-toggle` 类在窄屏 `display: none`。分类 / 标签的筛选入口改为底部导航的「标签」按钮（见下条）—— 别把横向过滤条加回来，它和底部导航是两套并存的导航，窄屏上会挤成三条。
- **窄屏底部导航**（`components/BottomNav.jsx` + `index.css` §10，2026-11-15 定）：四枚**纯图标**按钮 —— 今日 / 即将到期 / 全部 / 标签（`check-circle` · `calendar-clock` · `grid` · `tag`），文字只在 `aria-label` 与 `title` 里；中间用 `.bnav-labels::before` 一道竖分隔线（对应稿子里的「｜」）隔开视图与标签。选中态是固定 **24px 居中短横线**（`.bnav-item.active::after`）—— 别用百分比宽度：600px 档会横成一条盖过图标。
  - **它是网格里独立的一行，不是 `position: fixed` 浮层**：`.app` 的 `grid-template-rows` 末位是 `auto`，导航自己占 `grid-row: 3`（带标题栏时 `4`），列表只在 `.workspace` 里滚。因此「清单再多也不被按钮压住」是结构保证，不需给 `main` 补 `padding-bottom`（`fixed` + 补偿的做法滚到底仍会有行从条子后面滑过）。
  - 整条高 `--bottomnav-h` = `calc(var(--chrome-row-h) * 1.2)`（37.2px，2026-11-17 按用户要求增高 20%），比标题行 / 横向页签条高一档；按钮 `flex: 1 1 0` 均分整宽、`height: 100%`。**不硬撑 44 的触屏线** —— 与横向页签条同一取舍（命中区就是整枚按钮本身，宽度由均分兜住）。底栏必须始终是页签条的 1.2 倍，别再写回同高。
  - 「标签」点击**从窗口下沿往上弹**：`useContextMenu().openAt(r.left, r.top, items, { place: 'above' })`，落点计算在纯函数 `lib/placement.js` 的 `computeMenuPlacement`（菜单底沿对齐按钮顶沿）。菜单分组「分类 `@`」/「列表 `+`」，只有 `+列表` 带色点，当前项打勾，空态一条 disabled 的「还没有分类或列表」。选具体标签会连带把日历拉回列表布局（否则"点了没反应"）。
  - 只在 `tab === 'list'` 且未打开设置页时渲染；日历模式下它照旧在，用来切回列表 / 换标签。
- **外壳行高是同一条令牌**（2026-11-16 十七改定稿，2026-11-17 底栏加高）：`--chrome-row-h` = 31px 为标题行 / 横向页签条的唯一口径，`--titlebar-h` / `--rail-row-h` 写成 `var(--chrome-row-h)`，`--rail-tab-size` 是 `calc(var(--chrome-row-h) - 1px)`；`--bottomnav-h` 是 `calc(var(--chrome-row-h) * 1.2)`（37.2px，用户要求的 +20%）。**标题行与页签条必须同高，底部导航固定为它们的 1.2 倍**：窄窗里标题行 31 与页签条 31 叠在顶上、底部导航 37.2 压在底边，比例一歪整列骨架就看得出往一边偏。改高度只动 `--chrome-row-h` 一行，别在各处各写数字（历史：44 / 44 / 无 → 35 / 31 / 48 → 31 / 31 / 37.2）。
  红绿灯必须成对改：31px 行对应 `tauri.conf.json` 的 `trafficLightPosition` `{ "x": 16, "y": 18 }`。依据是同一条经验关系「灯中心 ≈ y − 2.25」（旧值 `y:24` 在 44px 行里实测灯占 15..28.5、中心 21.75，肉眼居中；35px 用 `y:20`）；31px 行要中心 15.5 → `y = 17.75`，取 18。`qa-responsive.mjs` 与 `BottomNav.test.jsx` 都会断言这个数。

## 构建 / 出包

- `src-tauri/rust-toolchain.toml` 钉了 windows-msvc 通道，**别改**；macOS 构建用 `RUSTUP_TOOLCHAIN=stable-aarch64-apple-darwin` 覆盖（`build-mac.sh --install` 已处理），cargo 在 `~/.cargo/bin`。
- 常规出包：`npm run tauri:build`（exe + NSIS 安装包）；只出 exe：`npm run build:app`。**本机 `.bin` 软链可能缺失**，此时改用 `node node_modules/@tauri-apps/cli/tauri.js build`，别改脚本去绕。
- 验证装进去的前端：在二进制里找 `index-<hash>.css|js` 与 `dist/assets/` 比对。前端明文搜不到属正常；NSIS 安装包是自解压压缩包，验收用主 exe。
- git 走代理推送易报 HTTP2 framing / 502；远端真实状态用 `gh api` 判，别信 `git ls-remote`。

## 验证界面改动

`styleguide.html?view=list` 渲染真实组件；抹掉 `.sg-nav`、清零 padding 即产品界面。列表子任务层级（`is-child`）在各视图都生效（2026-11-16 起「今天」也有）；演示数据里 `t10` 带两个子任务、父项逾期，所以 `?view=list` 与 `?view=list-all` 都能看到展开箭头。`t14`（父，`due` 在将来）+ `t15`（子，无日期）是**可见性继承**的样张：`?view=list` 里它不出现、`?view=list-all` 里挂在父任务下面 —— 这就是 2026-11-16 十九改要守住的那条。

本机无 Playwright：Chrome `--headless=new --no-sandbox` + CDP，Vite 监听 `[::1]:15181`（用 `localhost`），截图要 `env -u HTTP_PROXY -u HTTPS_PROXY`。门禁用 `EDGE=/tmp/unslop/chrome-qa SG_BASE=http://localhost:15181`。

深色截图**不要**往 localStorage 塞 `'dark'`（`configStore` 存 `{mode}` 对象，脏值退回 auto），要用 CDP `Emulation.setEmulatedMedia` 模拟 `prefers-color-scheme: dark`；**明暗都显式钉死**，否则 macOS 自动外观会随昼夜改变条件，新旧截图不可比。

## 边界：必须先问 / 绝不能做

- 不要动用户数据：`todo.txt`、`done.txt`、`notes.md`、`backup/` 里的内容，除非明确要求。
- 不要删 `.workbuddy/` 目录（项目数据，不是缓存）。
- 不要引入 SQLite / 二进制数据源 / 联网同步 / webfont / jsdom，不要把偏好写回 `todo.txt`。
- 不要改 `rust-toolchain.toml` 的通道，不要绕过门禁脚本（改判定阈值来「修」红灯等于没修）。
- 对外动作（推送远端、发布、发邮件、删除仓库外文件）先确认再执行。
