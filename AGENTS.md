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
- 纯函数单测拦不住渲染错误：**改组件要补渲染测试**。
- 新增说明文档放 `docs/` 对应子目录，命名 `<YYYY-MM-DD>-<主题>.<ext>`，并更新 `docs/README.md` 索引 —— 索引不更新等于没归档。**根目录不放说明文档**（本文件是工具约定文件，属例外，因为编码 Agent 只在仓库根 / 就近目录自动发现它）。
- 版本号三处同步：`src-tauri/Cargo.toml`、`todolist-gui/package.json`、`src-tauri/tauri.conf.json`。**实际有五处**：两个 lock 文件（`package-lock.json` 的 root 两行、`Cargo.lock` 的 `worktodolist` 条目）也要一起改，否则 `npm ci` / `cargo` 会自说自话。
- **换行符由根目录 `.gitattributes` 钉成 LF**（`* text=auto eol=lf`，只有 `cmd`/`bat`/`ps1`/`vbs` 留 CRLF）：一批版式契约测试直接读 `index.css` / `*.jsx` 源码做字符串断言，Windows runner 的 `core.autocrlf` 把文件 checkout 成 CRLF，断言就全部落空。2026-11-16 因此让 v1.5.0 的 Windows 流水线挂了 4 个（macOS 全绿）—— 别删这个文件，也别在测试里靠 `\n` 去断言多行源码时忘了它会生效。
- **日期 / 时刻字段统一走 `src/components/DateField.jsx`**（值转换纯函数在 `src/lib/dateField.js`）：编辑浮窗 `due`/`rem`、提议弹窗、批量工具的日期操作值共用这一处；QuickAdd 内联 `due:`、中文指令、日历拖拽属不同交互范式，保持原样。**值形状锁死** `due: YYYY-MM-DD` / `rem: YYYY-MM-DDTHH:mm`，不许为加时刻去扩展纯文本标签。中文 locale、周一起始、roving tabindex 由 `@daypicker/react` 提供，外观一律用 `index.css` 令牌覆盖 `.rdp-*`；弹层用 `createPortal` 挂 `body`，避开 `.drawer-body` 的 `overflow-y: auto` 裁切，下方空间不足时翻到字段上方。

## UI 语言：工作登记簿（2026-11-07 定稿，11-06 那版作废）

可核对、安静、有刻度；签名是「行号 │ 源文本行」。**原文只出现在展示文件内容处**（写入行 / 纸页 / 语法提示），界面读数要让人读懂。设计全文与截图见 `docs/design/2026-11-07-UI全量重做-工作登记簿.html`。

- **少写说明，让布局自己说话**（avoid unnecessary secondary labels and descriptions. Let the layout do the explaining）：位置、分组、留白、对齐、缩进已经说清的关系，不要再叠一层二级标签、字段说明、辅助描述或提示文案；每留一行解释性文字，都要能说出它承担了哪项读数功能。例外：写入行 / 纸页 / 语法提示里展示的原文、必要的无障碍标签，以及门禁明确要求的文案（如设置页页头必须含「只读」）。
- 优先级（2026-11-15 定稿，旧「四档字阶徽章」与「3/2/1 枚感叹号」都作废）：**列表**＝标题最左边一枚**中空旗**，颜色就是档位 —— 高红 / 中橙 / 低蓝，「无」整枚不画（不留占位，但有固定 18px 旗标槽 `--flag-slot`，标题与下方读数行始终对齐）；**编辑设定界面**用「高 / 中 / 低 / 无」四个汉字按钮；**行内快捷旗标按钮点击 = 弹出「高 / 中 / 低 / 无」下拉**（红 / 橙 / 蓝 / 黑四枚旗样张 + 汉字）。档位单一真相源 `lib/priority.js`（`priorityClass`；`priorityBangs` 已删）→ `PriorityMark.jsx` 三形态：`badge`＝列表旗标（带 title/aria）、`flag`＝菜单样张（无提示）、`mark`＝日历 / 写入行的紧凑方块，类名 `prio-none|low|mid|high|other` 不变。`(A)/(B)/(C)` 只是 todo.txt 写法，留在 title / aria-label 里。D~Z 走 `prio-other`（次级墨色），不冒充三档。
- **颜色只编码状态**：逾期是整行唯一强色，accent 只表选中 / 今天 / 焦点。例外是用户自己打的记号：优先级旗标 `--flag-high|mid|low`（红 / 橙 / 蓝，列表里那一枚中空旗）。`--danger` 只给逾期与危险，`--prio-flag` 只留给日历 / 菜单里的紧凑记号，明暗各一套近似色，别再引新色系。
- 字体两族：`--font-ui` 管文字、`--font-mono` 只管读数（另有 `--font-mono-cjk` 中文回退）。`--font-display/--font-body` 已删，不要引入；`600` 只给白名单选择器；字体取系统栈，**不打包 webfont**。
- 列表标题与侧栏条目（`.task-title` / `.nav-item`）字重用 `--fw-body`（400），与新建任务框提示文字同一口径：正文靠字号 / 颜色分层，**不靠加粗**；`--fw-emph`（500）只留给需要拎出来的小标签（组名、计数、按钮文字）。
- 图标 12/16/24、描边 1.5；圆角 4/6/8/12/16。**行高尺寸（`--nav-h` / `--row-h`）以 `src/index.css` §1 令牌层为唯一真相源**，本文件不复制数值（11-13 排查实测 `--nav-h` 已由 32 改为 26px，硬编码会漂移）。`--control-line` 是 WCAG 1.4.11 契约，别压淡。
- 活动栏底部（2026-11-14 二改定稿）：应用菜单 / 置顶 / 主题 **各一枚**按钮，**不单列「设置」按钮**（入口只在应用菜单，别把同一动作摆两处）。
  - **置顶**：开 = 图钉**实心**（`Icon` 透传 `fill="currentColor"` + `.tab.is-pinned` 把颜色提到 `--text`），关 = 描边；**不套底色块**（用户明确否掉了黑/白框：底色会把轨道读成一排开关按钮，实心图标自己就能表态）。`aria-pressed` 保留（它确实是开关）。
  - **主题只有一枚按钮**，点一次按 `THEME_CYCLE` 轮换 `auto → dark → light`，按钮画的图标是**当前档的记号**：auto＝显示器、dark＝太阳（点它回浅色）、light＝月亮（点它去深色），映射表 `THEME_ICONS`（真相源仍是 `lib/theme.js`）。它不是开关，所以不套实心底、不写 `aria-pressed`，只用 `data-mode` 标当前档；想直接落某一档走应用菜单「外观」。
  - `.tab.is-solid` 已删（置顶与主题都不再用实心底），别再引回来。
  - **图钉随轨旋转 45°**（2026-11-15 定）：`<Icon className="pin-tilt">`，`.pin-tilt { transform: rotate(45deg) }` 只转图形、不转按钮 —— 按钮命中区仍是正方 30/44，图标 16px 内视觉重心也在中心。别改成 `transform: rotate()` 加在 `.tab` 上：那会把 44px 命中区一起拧斜、和相邻按钮的间隙对不齐。
  - 轨内行距（2026-11-15）：`--rail-row-h`＝31px（原 44 × 0.7），横向页签条同用这一档；`.tab` 横条态 30 见方（`--rail-tab-size`），触屏再兜底到 44 命中（`@media (pointer: coarse)` 单独压 `min-height`，别改令牌，否则桌面行距跟着变）。
- 侧栏五入口（2026-11-15 定稿）：固定区从上到下＝**今日（check-circle）· 即将到期（calendar-clock）· 全部（grid）· 日历（calendar）· 日志（history，数据仍是 done 视图）**；**「收集箱」条目已取消**（`tasksForView` 的 inbox 分支保留，仅 UI 入口撤掉）；「分类 / 列表」分组保留在固定区下方。**日历不再是页眉切换控件**：页眉 `.mode-switch` 已移除，点侧栏「日历」＝ `App.pickMode('calendar')`（偏好照旧落 configStore、窄边覆盖语义不变）；点其余四个视图若正处日历模式要连带切回列表布局（否则"点了没反应"）。日历条目不占 `store.view`，日历照旧按当前视图取数；选中态互斥 —— 日历模式下四个视图条目全部熄灭。「即将到期」是纯函数 `sortFilter.js` 的 `upcoming` 视图（未完成 + 有 due 且严格晚于今天），**恒按截止日升序**（`compareUpcoming`），排序模式对它不生效。开关钮图标是 `panel-left`（lucide），自绘 `panel-fold` 已删。
- 上下文条（2026-11-15 四改）：**左**＝面板开关 · 面包屑，**右**＝放大镜 · 排序；四枚控件全是 `.ctx-btn.ctx-btn-icon` 同一族（高 `--ctx-btn-h`＝26px、宽 26、悬停才浮底色），别给某一枚另写尺寸。列表/日历切换控件已从页眉撤走（入口只在侧栏与设置页「显示模式」）。
  - **搜索不常驻**：平时只有一枚放大镜，点它（或按 `/`、行右键菜单、应用菜单「搜索」）才挂出输入框。开关状态在 `App` 的 `searchOpen`（三处入口读同一份），输入框 `autoFocus` +「这一帧没挂上就下一帧聚焦」的兜底；**关闭时连关键词一起清空** —— 否则筛选还在、输入框却不见了，任务会凭空少一半。
  - **排序是一枚图标钮**，不是「排序 · 手动」那种文字按钮：自动＝`arrow-up-down`、手动＝`grip-vertical`（文件行序，可拖拽），当前档写在 `data-sort`。日历里不出这枚钮（那里恒按优先级·日期聚拢，按了没反应）。
  - **面包屑只留「我在哪」**：标题（+项目带色点）+「N 项」。不再有「/ 到期与逾期」「/ 分类过滤」「/ 只读投影」这类替布局解释自己的第二段。
- 底部两条已删（2026-11-14）：**今日概览条与状态栏整行移除**，`.workspace` 只有「上下文条 + 内容」两行。保存状态读数与「手动重载 / 切换目录」搬进设置页「数据」节 —— 主界面不再常驻这两颗按钮，但它们不能消失。
- 列表行结构（2026-11-15 十改）：**两行内容，但只有标题参与布局** —— 标题一行；读数行（截止日 / 完成日 / 子任务进度 / 备注 / 重复）折在标题下方、**绝对定位**在行底。行高由 `--row-h` 决定（九改：40→32，行距再收 20%；触屏兜底 44 不变），**纵向内边距归零** —— 32px 里要同时装下 14px 标题（行盒 17.5）与 11px 读数行（行盒 13），再别 3px 就必然撑破，一撑破就退回「行距跟着内容走」。改行高要**同时改 `lib/readingDensity.js` 的 `LIST_ROW_PX`**（三档 28/32/38），否则「没设置」的用户与设置页样张各说各话。三段固定列：复选框 `--cb-size`(18) · 正文 `1fr` · 行尾箭头槽 `--row-expand-w`(20)。**子任务行不吃这套版式**，它是单行的另一套（见本节最后一条）。
  - **读数行**：`position: absolute` + `left: calc(--row-pad + --cb-size + --sp-3 + --flag-slot)` 与标题正文对齐，右缘止于箭头槽左侧；截止日字号 `--fs-2xs`、颜色 `--muted`，**只有逾期换 `--danger`**（「今天」不再单独染色）。子任务进度是 `list-tree` 小记号 + `完成/总数`，只报数、不是按钮。
  - **读数行默认收起、悬停展开，且全程零重排**（十改）：收起态只有 `opacity: 0` + `translateY(2px)` + `pointer-events: none`（看不见时不能替这一行吃掉点击），`:hover` / `:focus-visible` 时 `opacity: 1`、`transform: none`；同时标题组 `.task-head` 走 `translateY(calc(var(--meta-lift) * -1))` 让位。**两处都只碰 transform / opacity，没有任何盒尺寸变化** —— 悬停时行高、行位置、相邻行一格不动。别退回 `max-height`：行高虽不变，但每帧都在改这一格的盒尺寸、整行重排，鼠标扫过列表与滚动时就发涩发闪（实测旧版正是这个观感）。取证口径：静止 vs 悬停的全部行 `top`/`height` 必须完全相同、`PerformanceObserver` 的 `layout-shift` 全程为 0（含连续滚动）。
  - **没有常驻例外**（八改定，十改沿用）：逾期行、带红旗的高优先级行、两者兼有的行，收放与普通行完全一致 —— 曾给逾期行开过 `.task-meta.is-pinned` 的后门，结果是「同是清单项，有的悬停才弹、有的一直摊着」，被读成功能只覆盖了一半。**状态（逾期 / 优先级 / 进度 / 备注 / 重复）只改颜色与记号，不改交互**。`@media (hover: none)` 一律常驻（读数行 `opacity: 1`、标题常驻上移）。**别把 `:focus-within` 加回来**：那会让快捷按钮跟着焦点闪（见下一条），日期要的是 `:focus-visible`。
  - **展开 / 收起只认行尾那枚三角箭头**（`button.row-expand`，收起＝朝下、展开＝原地 rotate 180°、`--dur-2` 过渡；`tabIndex=-1`）。**整行单击不再碰子列表** —— 父项行拿回普通行的点击语义（快双击进浮窗、慢双击改标题）。键盘走 `→` 展开 / `←` 收起（`handleRowKeyDown`），所以不必给箭头加一个 Tab 停靠点。收起态本身仍由 `hooks/useRowCollapse.js` 管理、在 `App` 里下发，**主列表渲染 / ↑↓ 导航 / 顶栏「共 N 项」三处必须读同一份**，纯视图状态、**不落盘**，「今天」视图不启用。可见行过滤走纯函数 `lib/subtasks.js` 的 `filterCollapsed`：只认「父也在本屏」的层级，否则切视图 / 搜索只命中子任务时会把它连带隐藏、任务凭空消失。**子任务行双击不进任何编辑**，它的文本在浮窗子任务区里改。
  - **行内快捷按钮只在鼠标悬停该行时浮出**（`.task-row:hover .row-quick`）。`:focus-within` 那条已删 —— 用 ↑↓ 扫列表时右侧一团按钮跟着焦点闪，比没有更难用。按钮仍 `tabIndex=-1`（键盘走快捷键 + 右键菜单）。位置 `right: 行内边距 + 箭头槽宽 + 4`，**永远退到箭头左侧，两者不重叠**；第三列在没有箭头的行上也留空，于是所有行的按钮都在同一位置。
  - **子任务行是另一套版式**（2026-11-15 七改，`.task-row.is-child` + `.child-body`）：**单行**，只有复选框 + 标题 —— 读数行（日期 / 完成日 / 进度 / 备注 / 重复）与优先级旗标在 `TaskRow` 里就**不渲染**（不是 CSS 藏起来），悬停**不浮出 `.row-quick`、不挂任何原生 `title`**（子任务行连勾选框的「完成（空格）」提示都去掉，只留 `aria-label`）。版式差异：行高 `--row-child-h`（主行 − 6px，默认 26）比主行矮一档、复选框 `--cb-child`(14) 配 12px 正文（对勾 mask 同步缩到 9px）、两列网格 `var(--cb-child) minmax(0,1fr)`、缩进 28px、字号 `--fs-list-child` + `--muted`。`.child-body` **必须显式 `flex-direction: row`**：`.task-body` 是 column，只改 `align-items: center` 会得到「水平居中、左右不成对」的标题（踩过）。触屏档（`pointer: coarse`）子行回到 44px 行高，勾选框外扩另调到 `inset: -16.5px` 才够 44 命中。
  - 行的「上一次点击」是**模块级共享**的 `lastRowClick`，不能是每行一份的 `useRef`：否则「点父项 A → 点子任务 B → 回点 A」时 A 的 ref 还停在 t1，第二次点 A 会被算成快双击、凭空打开编辑浮窗。
  - 编辑浮窗宽度恒为 `--edit-window-w`（392px），窄边不改 `100%`；`max-width:100%` 只在物理放不下的极窄视口兜底。优先级 + 重复同一行（`2fr 1fr`），截止日期 + 提醒时刻同一行。
  - 日期界面读数统一 `YYYY/MM/DD`（`lib/dateField.js` 的 `formatDateShort`），落盘仍是 ISO 形状；字段旁不摆清除 X，清除只在 `DateField` 弹层底部。
  - 备注区只有一个「添加备注 / 编辑备注 / 完成」按钮，不再叠「备注」文字标签；子任务区与它之间一条 `.field-sep`，子任务进度线与读数同行。
  - **旗标（`star:`）的图形入口已全部退场**（列表行 / 编辑浮窗标题栏 / 行内快捷按钮）：旗标此后只表示优先级，同一行再摆第二支红旗会让人分不清"哪支是急、哪支是标记"。**数据不删**：解析、写回、`form.starred` 透传都保留，只是界面上不再有开关。

## 日历与窄边降级

- 日历是**列表的第二种显示模式**（不是第四个页签），模式存 `configStore` 键 `worktodolist.list-mode.v1`，三处入口读同一份。
- **日历页只剩网格**（2026-11-15 定稿，参考 Tasks 的日历）：顶部快录框、右侧日详情栏、无日期托盘、跨日区间条、HTML5 拖拽改期**全部删除**（`lib/taskRange.js` 一并删）。任务只在**自己那一天**以 chip 出现（最多 3 条 + `+N`），chip 是纯读数（无 click / draggable / 右键）—— 格子的单击已经有明确含义（看这一天），chip 上再挂动作只会和它打架。**别再把这些加回来**：多日条要新的区间纯函数与车道算法，拖拽要跨格命中判定，都是这一版明确砍掉的东西。
- **点日期格 = 弹「当天任务」浮层**（`components/CalendarDayPopover.jsx`）：有任务 → 列表（复用 `TaskRow`，勾完成 / 双击编辑 / 右键菜单都在）+ 底部一颗「添加任务」；没任务 → 直接进添加态（输入框已就位并聚焦）。只读（已完成视图）→ 只有列表、没有添加入口。写入走 `store.addTask(`${text} due:<date>`)` —— 与手敲 `due:` 完全等价，**不另造写入路径**；用户自己写了 `due:` 就以他写的为准。
  - 浮层是 `createPortal` 挂 `body` 的临时视图，状态刻意留在 `CalendarView` 内、**不进 store**（不是持久状态）。SSR 渲染不了 portal，所以展示层拆成可测的 `DayPanel`。
  - 落点走纯函数 `lib/placement.js#computeDayPopoverPlacement`（先量后放：挂载后按 `scrollHeight` 重算一次），贴格 +4px、末行上翻、右缘夹回、窄屏收宽、矮窗收缩。点亮被点的格子用 `.cal-cell.is-open`（inset 2px accent）。
  - 收起四入口：点外面（document `mousedown`）、Esc（capture + `stopPropagation`，别顺手清搜索词）、窗口 `resize` / `scroll`、翻月 / 键盘移日。关的时候**只在焦点本来就在浮层里时**把焦点还给格子，否则会抢走用户刚点的别处。
  - **点邻月的灰格 = 先翻月、再开浮层**（`pendingPopRef`）：那批格子会被整体换掉，锚点必须在新格子上重新量，否则浮层会浮在旧格子腾出来的空位上。别简化成「灰格只翻月不开」—— 用户点它就是想看那一天。
  - 日历里的「新建任务」（`n` 键 / 右键菜单 / 应用菜单）不再是往快录框塞 `due:`，而是发 `addSignal={date, seq}` 让浮层直接进添加态；`seq` 保证"同一天再点一次新建"也是一次新信号。
- 语义：选中日是唯一真相（月份派生、42 格）；「今天」在日历里放宽为全部未完成；已完成按完成日期锚定且只读。交互语义放纯函数 `lib/calendar.js`（项目无 jsdom，**别为此装 DOM 依赖**）。
- 门禁口径：`qa-settings.mjs` 的日历段是「只剩网格（无快录框 / 右栏 / 托盘 / 区间条）+ 首屏不弹浮层 + 点有任务日弹列表 + 点空日期直接进添加态 + 点邻月灰格翻月并在新格子上弹出（量锚点是否重算）」；`qa-responsive.mjs` 量宽度分配与无溢出。`CalendarView.test.jsx` 里有一条「旧结构不得回流」的断言，删旧代码时别把它一起删掉。
- **显示模式是持久化偏好，永不因窗口宽度改写**。窄边只是渲染层覆盖（`lib/layoutMode.js`）：`override > 窄边降级 > preferredMode`，进入 `<480`、退出 `>560` 滞回，用 `ResizeObserver` 观测 `<main>` 而非 `window.innerWidth`。
- **窄屏（`max-width: 768px`）不显示侧栏与侧栏开关**（2026-11-15 定）。旧版那套「侧栏转横向过滤条 + 页眉最左留开关」的规则**整段删除**，`TopBar` 的开关加 `.panel-toggle` 类在窄屏 `display: none`。分类 / 列表的筛选入口改为底部导航的「标签」按钮（见下条）—— 别把横向过滤条加回来，它和底部导航是两套并存的导航，窄屏上会挤成三条。
- **窄屏底部导航**（`components/BottomNav.jsx` + `index.css` §10，2026-11-15 定）：四枚**纯图标**按钮 —— 今日 / 即将到期 / 全部 / 标签（`check-circle` · `calendar-clock` · `grid` · `tag`），文字只在 `aria-label` 与 `title` 里；中间用 `.bnav-labels::before` 一道竖分隔线（对应稿子里的「｜」）隔开视图与标签。选中态是固定 **24px 居中短横线**（`.bnav-item.active::after`）—— 别用百分比宽度：600px 档会横成一条盖过图标。
  - **它是网格里独立的一行，不是 `position: fixed` 浮层**：`.app` 的 `grid-template-rows` 末位是 `auto`，导航自己占 `grid-row: 3`（带标题栏时 `4`），列表只在 `.workspace` 里滚。因此「清单再多也不被按钮压住」是结构保证，不需给 `main` 补 `padding-bottom`（`fixed` + 补偿的做法滚到底仍会有行从条子后面滑过）。
  - 整条高 `--bottomnav-h`＝48px，即触屏命中区；按钮 `flex: 1 1 0` 均分整宽、`height: 100%`。
  - 「标签」点击**从窗口下沿往上弹**：`useContextMenu().openAt(r.left, r.top, items, { place: 'above' })`，落点计算在纯函数 `lib/placement.js` 的 `computeMenuPlacement`（菜单底沿对齐按钮顶沿）。菜单分组「分类 `@`」/「列表 `+`」，只有 `+列表` 带色点，当前项打勾，空态一条 disabled 的「还没有分类或列表」。选具体标签会连带把日历拉回列表布局（否则"点了没反应"）。
  - 只在 `tab === 'list'` 且未打开设置页时渲染；日历模式下它照旧在，用来切回列表 / 换标签。
- **外壳行高**（2026-11-15）：`--titlebar-h` 44→35px（−20%）；macOS 红绿灯同步上移，`tauri.conf.json` 的 `trafficLightPosition` 由 `y:24` 改 `y:20` —— 两处**必须成对改**，否则灯会偏出标题行的中线。依据是同一条经验关系「灯中心 ≈ y − 2.25」（旧值 `y:24` 在 44px 行里实测灯占 15..28.5、中心 21.75，肉眼居中）；35px 行要中心 17.5 → `y = 19.75`，取 20。

## 构建 / 出包

- `src-tauri/rust-toolchain.toml` 钉了 windows-msvc 通道，**别改**；macOS 构建用 `RUSTUP_TOOLCHAIN=stable-aarch64-apple-darwin` 覆盖（`build-mac.sh --install` 已处理），cargo 在 `~/.cargo/bin`。
- 常规出包：`npm run tauri:build`（exe + NSIS 安装包）；只出 exe：`npm run build:app`。**本机 `.bin` 软链可能缺失**，此时改用 `node node_modules/@tauri-apps/cli/tauri.js build`，别改脚本去绕。
- 验证装进去的前端：在二进制里找 `index-<hash>.css|js` 与 `dist/assets/` 比对。前端明文搜不到属正常；NSIS 安装包是自解压压缩包，验收用主 exe。
- git 走代理推送易报 HTTP2 framing / 502；远端真实状态用 `gh api` 判，别信 `git ls-remote`。

## 验证界面改动

`styleguide.html?view=list` 渲染真实组件；抹掉 `.sg-nav`、清零 padding 即产品界面。列表子任务层级（`is-child`）只在非「今天」视图生效（`App.jsx` 对 `view === 'today'` 强制 `depth: 0`），要看层级用 `?view=list-all`。

本机无 Playwright：Chrome `--headless=new --no-sandbox` + CDP，Vite 监听 `[::1]:15181`（用 `localhost`），截图要 `env -u HTTP_PROXY -u HTTPS_PROXY`。门禁用 `EDGE=/tmp/unslop/chrome-qa SG_BASE=http://localhost:15181`。

深色截图**不要**往 localStorage 塞 `'dark'`（`configStore` 存 `{mode}` 对象，脏值退回 auto），要用 CDP `Emulation.setEmulatedMedia` 模拟 `prefers-color-scheme: dark`；**明暗都显式钉死**，否则 macOS 自动外观会随昼夜改变条件，新旧截图不可比。

## 边界：必须先问 / 绝不能做

- 不要动用户数据：`todo.txt`、`done.txt`、`notes.md`、`backup/` 里的内容，除非明确要求。
- 不要删 `.workbuddy/` 目录（项目数据，不是缓存）。
- 不要引入 SQLite / 二进制数据源 / 联网同步 / webfont / jsdom，不要把偏好写回 `todo.txt`。
- 不要改 `rust-toolchain.toml` 的通道，不要绕过门禁脚本（改判定阈值来「修」红灯等于没修）。
- 对外动作（推送远端、发布、发邮件、删除仓库外文件）先确认再执行。
