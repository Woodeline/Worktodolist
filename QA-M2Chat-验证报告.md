# QA 验证报告 · M2-Chat 增量（聊天式 Agent 交互界面）

- 验证人：严过关（Yan，QA 工程师，独立验证，不复用工程师范刚的断言）
- 被验证对象：`C:\Users\王佐成\WorkBuddy\todolist\todolist-gui`（Vite 5 + React 18 + plain JS）
- 基准 today：`2026-10-01`（周四，本地时区 UTC+8）
- 数据源：`..\todo.txt`（9 行）/ `..\done.txt`（2 行），全程只读，未写入
- 运行环境：Node v22.22.2 / npm 10.9.7 / Git Bash
- 验证日期：2026-10-01

---

## 1. 结论

**PASS-with-issues**（缺陷 1 项已修复并回归通过；1 项非致命观察点未改；浏览器交互类未能验证）

- 独立复现工程师结论成立：**6 测试文件 / 81 用例全绿**，`npm run build` 成功。
- 独立攻击脚本 **95/95 通过**（覆盖时间词跨边界、误判、序号越界、正则特殊字符、极端输入、eventLog append-only/NDJSON/回放、undo(add) 逆操作、AC-C1~C10、快捷键开关）。
- 发现 **1 个真实源码缺陷（中低严重度）**：会话日志按 **UTC 日期** 归档，与读取端按 **本地日期** 不一致 → UTC+8 的 00:00–08:00 时段事件落盘到错误文件、刷新后无法回放。**判定修复成本低，已直接修复并回归通过。**
- 发现 **1 个非致命观察点**：动作词优先级导致个别查询句式被误判（无危险副作用），属设计取舍，仅报告不动手。
- 数据文件完整性：`todo.txt` 9 行 / `done.txt` 2 行，且与 M1 基线备份**逐字节一致**；`topydo ls` 正常。

---

## 2. 独立复现的真实输出

### 2.1 单元/回归测试

```
> vitest run
 ✓ src/lib/todoParser.test.js   (26 tests)
 ✓ src/lib/nlRules.test.js      (17 tests)
 ✓ src/lib/sortFilter.test.js   (11 tests)
 ✓ src/lib/eventLog.test.js      (8 tests)
 ✓ src/lib/actions.test.js      (11 tests)
 ✓ src/hooks/useTodoStore.test.js (8 tests)

 Test Files  6 passed (6)
      Tests  81 passed (81)
   Duration  3.70s
```

- 基线 45 用例（`useTodoStore` 8 + `sortFilter` 11 + `todoParser` 26）**一条未删、断言强度未下降**（与 M1 报告记载的 “3 files / 45 tests（37 原有 + 8 新增）” 数量吻合）。
- 新增 M2 用例 36 条（`nlRules` 17 + `eventLog` 8 + `actions` 11）→ 合计 81，与工程师报告一致。
- ⚠️ **环境抖动记录（非源码缺陷）**：在多次连续运行中，曾**偶发一次**出现 `Test Files 5 passed (5) / Tests 55 passed (55)`（缺 `todoParser.test.js` 的 26 条）。随后**直接重跑 5 次＋本轮共 8+ 次均为 `6 files / 81 tests`**。判定为沙箱 `%TEMP%` 偶发 EPERM 导致的 vitest 收集抖动（与主理人提示的环境坑一致），**重跑即恢复**，与本次改动无关。

### 2.2 构建

```
> vite build
✓ 50 modules transformed.
dist/index.html                   0.40 kB
dist/assets/index--lE5c0pH.css   15.60 kB
dist/assets/index-aMtrCkSU.js   203.07 kB
✓ built in 3.12s
```

### 2.3 独立攻击脚本

命令：`npm run test:attack-chat`
（= `node --import ./scripts/register-qa-loader.mjs ./scripts/qa-chat-attack.mjs`，脚本新增于 `scripts/qa-chat-attack.mjs`）

```
=== 汇总：95/95 通过，0 失败 ===
QA_CHAT_SUMMARY {"total":95,"passed":95,"failed":0,"failures":[]}
```

分节通过情况（全部 PASS）：

| 节 | 主题 | 关键结果 |
|---|---|---|
| 1 | extractDate 跨边界 | 今天→10-01、明天→10-02、后天→10-03、大后天→10-04、本周五→**10-02**、下周三→10-07、下下周三→10-14、3天后→10-04、2周后→10-15、10月8日→10-08、月底→10-31、下月初→11-01；**跨年** 12-31“明天”→2027-01-01；**跨月** 01-31“下月初”→2026-02-01 |
| 2 | 误判攻击 | 标题含“完成”时目标命中唯一；无目标“删除/延期”均低置信度要求澄清；有目标无时间“延后”→ fail 且 **updateTask 调用 0 次** |
| 3 | 序号越界 | 第0条/第99条/第-1条 → 均 `matches=0, low`，dispatch **不触碰任何任务**（status=fail）；第2条 → high 命中 |
| 4 | 关键词边界 | 0 命中/多命中→low；唯一→high；中文标点（，。/）被正确剥离；`.* ( [ \ $^ a\|b {2,3}` 等正则特殊字符 **均不抛异常且不执行** |
| 5 | 极端输入 | 空串/纯空格→unknown；null/undefined/number 不抛；1000 字无动作词→unknown；emoji 保留；换行/制表符归一化正确 |
| 6 | eventLog | append 前 4 条字节前缀不变；含 `\n \t " 中文 emoji \\` 载荷仍单行且逐字符还原；跨日分文件；seq 单调、ts 合法；replay 幂等且不改写输入、畸形事件不抛 |
| 7 | undo(add) | 新增→撤销文件行数 1→0；新增→完成→撤销无重复；新增→删除→撤销复原 1 条、再撤销移除；同标题两条 id 不同且 LIFO 正确；**fade 窗口内完成→撤销无幽灵**；空栈撤销不抛 |
| 8 | AC-C1~C10 | 见 §2.4，全部通过 |
| 6b | useChatAgent 端到端 | unknown / 多命中澄清 **均不产生任何 tool_call**；澄清回“2”后产生 tool_call；`replay(日志)` 正常 |
| 9 | useHotkeys | `enabled=true` 注册并在 n///空格/e 生效；`enabled=false` **不注册任何 keydown** |
| 10 | 日志时区回归 | 修复后，UTC `2026-09-30T18:00Z`（本地 10-01 02:00）事件正确落盘 `session-2026-10-01.ndjson` 且可回放 |

### 2.4 验收标准独立复现（AC，真实 store 驱动，today=2026-10-01）

| AC | 结论 | 证据 |
|---|---|---|
| C1 | PASS | `加一条 明天下午 交周报` → 落盘行 `2026-10-01 交周报 due:2026-10-02`，**不含 (B)** |
| C2 | PASS | `完成 回测报告` 唯一命中并写入 done（done 由 1→2，含新完成任务） |
| C3 | PASS | `完成 任务` → low + 多候选，澄清回复“2”正确选中第 2 个候选 |
| C4 | PASS | `把 回测报告 延到下周三` → due = **2026-10-07** |
| C5 | PASS | `标为高 回测报告` → priority = **A** |
| C6 | PASS | `有哪些任务` 回复逐行顺序 = 右侧快照顺序（9 条同序） |
| C7 | PASS | 事件日志落盘 + `replay(日志)` 重建（见 6b E1–E4） |
| C8 | PASS | 未识别输入（unknown）**不产生 tool_call**（日志仅 user/agent） |
| C10 | PASS | `撤销` → tool 名 `todo.undo`，调用真实 `store.undo` 1 次 |

### 2.5 静态与接线核查（读源码 + grep）

- **对话页签禁用全局快捷键**：`App.jsx:242` `enabled: tab === 'list'`，且初始 `tab='chat'`；`useHotkeys.js:7` `if (!enabled) return undefined`。对话页签下 `/`搜索、`n/e/空格` 全部失效（§2.3 第 9 节运行时验证）。`ChatPanel` 自行处理 `Ctrl+Z`(→agent.undo) 与 `Esc`。
- **两页签不串扰**：`App.jsx:270` 条件渲染，`list` 页签下 `ChatPanel` 卸载（其 keydown 监听随之移除）；`chat` 页签下 `useHotkeys` 不注册。
- **对话动作全部走 store 方法**：grep 确认 `actions.js` **无任何** `fileStore / writeFileText / serializeEntries / parseFile` 引用；`useChatAgent.js` 只从 `eventLog` 引入 `appendEvent/loadEvents/makeEvent/replay`（写的是独立的 `session-*.ndjson` 会话日志，**不碰 todo.txt/done.txt**）；`ChatPanel.jsx` 纯 UI 无文件访问。直接文件写入仅存在于 `useTodoStore.js`（经 `fileStore`）与 `eventLog.js`（会话日志），符合设计。

---

## 3. 缺陷清单

### 缺陷 #1 —— 会话日志按 UTC 日期归档，与本地读取日期不一致（**已修复**）

- **文件**：`src/lib/eventLog.js`（原 `tsToDate`，约 line 19–21）
- **严重程度**：低–中（仅影响聊天记录刷新回放，**不影响 todo.txt/done.txt 数据完整性**）
- **责任判定**：源码 Bug（写入端 vs 读取端日期口径不一致）
- **复现步骤**：
  1. 系统时区 UTC+8；
  2. 本地时间处于 00:00–08:00 之间（例如本地 `2026-10-01 02:00`，UTC = `2026-09-30T18:00Z`）；
  3. 在对话页发送任意指令 → 事件经 `makeEvent`（`ts = new Date().toISOString()`，UTC）落盘；
  4. 刷新页面 → `useChatAgent` 用**本地** `today = 2026-10-01` 调 `loadEvents(handle, '2026-10-01')`。
- **实际**：原始 `tsToDate` 直接 `ts.slice(0,10)` 取 **UTC** 日期 → 文件被命名为 `session-2026-09-30.ndjson`，与读取端的 `session-2026-10-01.ndjson` 不符 → 刷新后当天聊天记录**丢失/无法回放**。
- **期望**：写入文件名应与读取端一致地使用**本地日历日**。
- **修复**：`tsToDate` 改为按本地日历日归档（保持 `ts` 仍为 UTC ISO 以便排序）：
  ```js
  function tsToDate(ts) {
    const d = new Date(ts || '');
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  ```
- **回归**：修复后 `npm run test` **81/81**、`npm run test:attack-chat` **95/95**、`npm run build` 通过；攻击脚本第 10 节新增针对该场景的回归断言并 PASS。

### 缺陷 #2 —— 动作词优先级导致个别查询句式被误判（**观察点，未改动**）

- **文件**：`src/lib/nlRules.js`（`detectAction`：`complete` 判定 line 76 早于 `query` 判定 line 84）
- **严重程度**：低（**无危险副作用**）
- **复现**：输入 `有哪些任务已完成`（或形如“...完成...”的查询句）
- **实际**：`detectAction` 先命中 `完成` → intent = `complete`；随后剥离动作词后关键词 0 命中 → `confidence=low` → 走澄清（不执行任何动作）。
- **期望**：语义上属查询，应返回任务清单。
- **影响**：仅 UX 体验（用户需改写问法如“列出任务”），不会误完成/误删除任何任务（已由 §2.3 第 2/3 节确认低置信度不执行）。
- **未改动原因**：属触发词优先级的设计取舍，改动会牵动整套 `detectAction` 优先级与既有 17 条 nlRules 用例，属**架构级/需权衡**，按约定只报告不动手。建议后续由工程师范刚评估（例如：当整句以“有哪些/列出/查/看看”开头时优先判为 query）。

> 说明：攻击中“`把 X 延后`（无时间词）”表现为 `status=fail` 的工具卡片且未产生任何写副作用——这是**符合设计的拒绝执行**，非缺陷。

---

## 4. 未能验证的部分及原因

以下为**浏览器交互 / FSA 真实环境**相关，Node 无 DOM 环境下无法端到端验证（已用 `qa-react-shim` 覆盖其**逻辑层**：解析、决策、分发、事件日志、撤销链路；未覆盖真实渲染与真实文件系统）：

1. 真实 `File System Access API`：`showDirectoryPicker` 选目录、`queryPermission/requestPermission` 授权、`IndexedDB` 句柄持久化与页面重载恢复。
2. 真实 DOM 交互：顶栏「对话/列表」页签切换、`ChatPanel` 自动滚动、打字机逐字动画、`ToolCallCard` 折叠展开原始事件 JSON、输入框 `/` 指令提示面板点击、`↑` 历史回填、`Enter` 发送 / `Shift+Enter` 换行。
3. 窗口 `focus` 外部修改冲突检测弹窗、`resolveConflictKeepLocal/UseDisk` 真实落盘、每日备份 `backup/` 目录创建与 30 份裁剪。
4. 真实浏览器下快捷键与页签的联合行为（本文已在源码层面确认接线，并在替身环境验证 `enabled` 开关，但未做真实浏览器冒烟）。

**建议**：由主理人安排一次 Edge/Chrome 人工冒烟（打开数据目录 → 对话页发「加一条 明天 交周报」→ 观察右侧快照与 toast → 刷新验证记录回放 → 切到列表页验证快捷键恢复）。

---

## 5. 数据文件完整性确认

- `..\todo.txt`：**9 行**（521 字节）；与 M1 基线备份 `..\.qa-backup\todo.txt.orig` **逐字节一致**（`cmp` 通过）。
- `..\done.txt`：**2 行**（164 字节）；与 `..\.qa-backup\done.txt.orig` **逐字节一致**。
- `topydo ls` 正常输出 8 条（第 (E) 条 `t:2026-10-05` 阈值未到，被 topydo 默认隐藏，属预期行为）。
- 全部验证仅在内存替身/副本上进行，**未修改任何真实数据文件**。

---

## 附：本轮新增/改动文件

- 新增：`todolist-gui/scripts/qa-chat-attack.mjs`（独立攻击脚本，95 项断言）
- 修改：`todolist-gui/package.json`（新增 `test:attack-chat` 便捷脚本）
- 修改：`todolist-gui/src/lib/eventLog.js`（缺陷 #1 修复：会话文件按本地日历日归档）

复现命令：

```bash
npm run test            # 期望 6 files / 86 tests 全绿（第二轮后）
npm run build           # 期望构建成功
npm run test:attack-chat # 期望 95/95 通过
```

---

# 第二轮复验（针对「查询前缀优先 + query scope」修复）

- 触发：工程师范刚修复「有哪些任务已完成」被 complete 抢占的问题（`nlRules.detectAction` 新增查询强前缀 `QUERY_PREFIXES`，`parseIntent` query 分支新增 `scope`，`actions.runQuery` 新增 done 分支与 @分类过滤）。
- 基准 today：`2026-10-01`；环境：Node v22.22.2 / UTC+8。

## R2-1. 结论

**PASS-with-issues**：修复方向正确、done-scope 与跨日口径均验证通过；但在 §R2-4 发现 **1 项抢词缺陷（5/5 必备样例失败）**——属**既有 contains 规则**（非本轮新引入，见 R2-4 隔离证据），按主理人「先不要改产品代码」指示**仅报告未改**。

## R2-2. 三条命令真实输出

```
=== TEST ===
 Test Files  6 passed (6)
      Tests  86 passed (86)        # nlRules 17 → 22，+5
   Duration  3.56s

=== BUILD ===
✓ built in 2.99s（dist/assets/index-PWTVX1Sy.js 204.32 kB）

=== ATTACK-CHAT (round1) ===
QA_CHAT_SUMMARY {"total":95,"passed":95,"failed":0,"failures":[]}
```

> 另：本轮新增独立脚本 `npm run test:attack-chat2` →
> `QA_CHAT2_SUMMARY {"asserts":35,"passed":30,"failed":5,"observes":7}`
> （5 项失败即 R2-4 的抢词缺陷，脚本按主理人「必须仍是 add」的硬要求断言，故真实失败）。

## R2-3. 第 1 节逐项判定（复验修复与回归）

### A. done-scope 查询 —— 全部 PASS ✅

| 样例 | 判定 | 证据 |
|---|---|---|
| `有哪些任务已完成` | ✅ intent=query, **scope=done** | 非 complete、非澄清 |
| 端到端 dispatch | ✅ 真的返回 doneEntries 内容 | `共 2 条已完成任务：1. (B) 已完成的示例：编写安装配置指南 · 2026-09-29 完成 / 2. (A) …`；`count=2` |
| 不含活跃任务 | ✅ | reply 未出现「季报复核」 |
| `列出已完成` / `看看已完成的任务` / `已完成` | ✅ scope=done | — |
| done 为空 | ✅ | `还没有已完成的任务。`（status=ok） |
| `有哪些任务`（反向） | ✅ scope=active | 不受影响 |

### B. complete/delete 路径未被抢占 —— 全部 PASS ✅

`完成 回测报告`、`搞定 第2条`、`完成 第2条`、`完成 第9条`、`完成 任务清单整理`、`完成 查看报告`、`删除 列出 的任务`、`取消完成 回测报告`、`延期到 下周三 回测报告`、`标为高 回测报告` → `detectAction` 与 `intent` 均与期望一致；标题本身含「完成」时目标仍唯一命中。

### C. 查询前缀优先的抢词风险 —— 见 R2-4（1 项缺陷 + 4 项观察）

### D. 会话日志跨日边界（本地日期口径）—— 全部 PASS ✅

`tsToDate` 已改为本地日历日（`ts` 仍存 UTC ISO）。证据（本地 UTC+8）：

| 事件本地时间 | UTC ts | 归档文件 | 结果 |
|---|---|---|---|
| 2026-10-01 23:30 | `2026-10-01T15:30:00.000Z` | `session-2026-10-01.ndjson` | ✅ |
| 2026-10-02 00:30 | `2026-10-01T16:30:00.000Z` | `session-2026-10-02.ndjson` | ✅ |

两日分别 `loadEvents` 各回放 1 条；`ts` 字段仍为原始 UTC ISO（仅文件名按本地日期）。

## R2-4. 第 2 节逐条实测行为与建议规则

### 🔴 缺陷 R2-1（中）：带 add 前缀、标题含「查询动词」时被抢成 query

- **实测**（5/5 失败，`detectAction=query`，未生成 add）：

  | 输入 | 实测 detectAction | 期望 |
  |---|---|---|
  | `加一条 列出购物清单` | **query** | add |
  | `添加 看看装修方案` | **query** | add |
  | `新增 查看体检报告` | **query** | add |
  | `记一下 搜索优化方案` | **query** | add |
  | `加 查看统计` | **query** | add |

- **根因（已隔离证明，**非本轮新引入**）**：`nlRules.js` `detectAction` 中**句中 contains 型** query 规则（line 134 `/有哪些|列出|看看|看一下|查看|查一下|查查|搜索|待办|… /`）**早于** add 规则（line 135）。
  - `加一条 购物清单`（无查询动词）→ **add** ✅
  - `加一条 列出购物清单`（含「列出」）→ **query** ❌
  - 二者都以 `加一条` 开头（**不是**查询前缀），`isQueryPrefixed()` 为 false → 可证明新前缀规则不是触发者，问题出在**原有的句中 contains 规则**（round-1 报告中的原 line 84 即为此规则，位置未变）。
- **严重程度：中（非破坏性但明确影响可用性）**：任何标题含 `列出/看看/查看/查一下/查查/搜索/待办/逾期` 等词的正常新增都会失败，例如 `加一条 逾期账单提醒`、`加一条 搜索优化` 会被判成查询并返回活跃任务列表（用户以为"没加上"，实际是查询）。
- **建议规则（未改代码，供工程师范刚评估）**：
  1. 最小改动：把 add 触发词判定**提到句中 contains 型 query 规则之前**（即 add 显式前缀优先于句中查询词）；或
  2. 句中 contains 型 query 规则增加前置保护——**句中已在更早位置出现 add/delete/complete 触发词时不再判 query**；
  3. 保留新前缀规则（整句以查询词开头）不受影响——`列出 购物清单` 仍应判 query。

### 🟡 观察 R2-2（低）：纯查询前缀句的「关键词」被忽略

- `列出购物清单` / `看看装修方案` / `查一下体检报告` → 均判 **query(active)**，但 `runQuery` active 分支**只用 `@分类` 过滤，不使用残余关键词** → 返回**全部**活跃任务，而非按「购物清单 / 装修方案」过滤。
- `列出 完全不存在的任务名` → 回复 `共 9 条活跃任务：`（全部），**不是**「0 结果」。
- **是否误导**：轻度。用户以「列出X」表达"想看 X 相关"，却得到全量列表。
- **建议规则**：query 支持残余关键词过滤；若关键词过滤命中 0 且句中含疑似标题词，回复改为**澄清**「没找到匹配的『X』，你是要**查询**『X』还是**新建**一条『X』？」。

### 🟡 观察 R2-3（低）：`已完成 X` 前缀与 complete 语义歧义

- `已完成 回测报告` → **query(scope=done)**（因 `QUERY_PREFIXES` 含「已完成」，且 `DONE_MARKER_RE` 命中）。
- 用户若意图"把 回测报告 标记为完成"，会得到已完成列表而非完成动作。相较 `完成 X` 该写法较不自然，严重程度低。
- **建议规则**：「已完成」仅在**无明确命令目标**（无 第N条/#N/引号标题）且**句尾无疑似任务名**时才当作查询前缀；或将该前缀收敛为「已完成的」并要求其后为「任务」。

### 🟡 观察 R2-4（低）：用户可能想新建「以查询动词命名」的任务

- `列出购物清单`、`看看装修方案`、`查一下体检报告` 若用户本意是**新建**同名任务，会被判 query。
- 属「查询 vs 新建」命名歧义，是**设计取舍**：以查询动词开头天然更像查询。**建议**：结合 R2-2 的澄清规则一并处理（0 命中 → 澄清查询/新建）。**不单独改。**

> **明确的命令前缀未被抢（PASS）**：`删除 列出 的任务`→delete、`完成 查看报告`→complete、`勾掉 看看报告`→complete；`列出@工作`→query 且正确识别 `context=工作`；`列出 @投资`→context=投资。

## R2-5. 数据完整性（第二轮结束时）

- `..\todo.txt`：**9 行**；与 `..\.qa-backup\todo.txt.orig` **逐字节一致**。
- `..\done.txt`：**2 行**；与 `..\.qa-backup\done.txt.orig` **逐字节一致**。
- `topydo ls` 正常（8 条可见，(E) 阈值未到被隐藏属预期）。
- 全程未写入任何真实数据文件。

## R2-6. 本轮新增/改动文件

- 新增：`todolist-gui/scripts/qa-chat-attack2.mjs`（第二轮攻击脚本，35 断言 + 7 观察）
- 修改：`todolist-gui/package.json`（新增 `test:attack-chat2`）
- **未改动任何产品代码**（依主理人第二轮「先不要改产品代码」指示）

复现命令：

```bash
npm run test             # 6 files / 86 tests
npm run build            # 构建成功
npm run test:attack-chat # 95/95（第一轮脚本，回归不破）
npm run test:attack-chat2# 30/35 断言 + 7 观察（5 项失败 = R2-4 抢词缺陷）
```

---

# 第三轮：定点裁决 + 回归

- 触发：工程师范刚完成 R2-1（抢词）/ R2-2（关键词过滤 + 0 命中澄清闭环）修复，并（正确地）拒绝改动 QA 脚本。本轮由 QA 收口。

## R3-1. 结论

**PASS** ✅ —— C2c 自相矛盾断言已裁决；R2-1 / R2-2 独立复验通过；5 条既有命令 + 新增 attack3 全绿；数据完整。

## R3-2. 五条命令真实输出（+ attack3）

| 命令 | 结果 |
|---|---|
| `npm run test` | **Test Files 6 passed (6) / Tests 95 passed (95)** |
| `npm run build` | **✓ built in 2.87s** |
| `npm run test:attack-chat`（第一轮） | **95/95** |
| `npm run test:attack-chat2`（第二轮） | **35/35**（断言 35，观察 7） |
| `npm run test:attack`（M1） | **46/46** |
| `npm run test:attack-chat3`（第三轮，本轮新增） | **27/27** |

## R3-3. C2c 自相矛盾断言的裁决（由 QA 改，非工程师）

- **问题**：第二轮的 `qa-chat-attack2.mjs` 存在数学互斥的两条断言——`C1:197` 对输入 `加一条 列出购物清单` 断言 `=== 'add'`，而 `C2c` 对**同一输入**断言 `=== 'query'`（该断言在缺陷存在时成立、R2-1 修复后必然失败）。故原脚本 `35/35` 不可达。
- **处理**：将 C2c 从「断言 query（记录缺陷）」改为「**断言 add（回归守卫）**」，并在其上方新增注释记录缺陷历史（修复前该输入被判 query，导致标题含查询动词的新增全部失败，R2-1 已修复）。**未删除该断言**。
- **结果**：`npm run test:attack-chat2` = **35/35**（C1、C2b、C2c 三者现均断言 add，逻辑自洽）。

## R3-4. 第 2 节逐项判定（独立复验，未采信工程师自测）

### R2-1 抢词修复 —— PASS ✅

| 输入 | detectAction | intent | title（未被剥除） | 序列化行 |
|---|---|---|---|---|
| `加一条 列出购物清单` | add | add | `列出购物清单` | `2026-10-01 列出购物清单` |
| `添加 看看装修方案` | add | add | `看看装修方案` | — |
| `新增 查看体检报告` | add | add | `查看体检报告` | — |
| `记一下 搜索优化方案` | add | add | `搜索优化方案` | — |
| `加 查看统计` | add | add | `查看统计` | — |
| `加一条 逾期账单提醒` | add | add | `逾期账单提醒` | `2026-10-01 逾期账单提醒` |

### 反向：命令未被抢 —— PASS ✅

`完成 回测报告`→complete、`搞定 第2条`→complete、`删除 列出 的任务`→delete、`勾掉 看看报告`→complete、`延期到明天 回测报告`→postpone（**且 due=2026-10-02**）、`标为高 回测报告`→setPriority —— 全部正确，无一被判 query。

### 「已完成 X」三分支 —— PASS ✅

- `已完成` → **query(scope=done)**
- `已完成 回测报告`（残余词命中活跃任务）→ **complete**（matches 命中活跃任务，high）
- `有哪些任务已完成` → **query(scope=done)**，端到端返回 doneEntries 两条内容（`共 2 条已完成任务：`，含「安装 topydo…」「编写安装配置指南」）

### R2-2 关键词过滤 —— PASS ✅

- `列出 回测` → **仅 1 条**（标题含「回测」），非全部 9 条（注：任务(C) 的 `+回测` 是**项目标签**非标题，故不计入）
- `列出 @投资` → 仅 @投资 范围（1 条：带截止日的周线复盘）
- `列出@工作`（无空格）→ `context=工作`，仅 1 条（带上下文的任务）

### 0 命中澄清闭环（端到端，内存 fixture）—— PASS ✅

- `列出 完全不存在的任务名` → 澄清文案「没找到匹配「…」的任务。你是想新建一条「…」吗？」+ `pending{kind:'create'}`
- 回 **「是」** → **真的新建**同名任务：todo 行数 9→10，标题 = `完全不存在的任务名`，落盘 todo.txt 10 行
- 回 **「否」** → 取消，**不产生任何写入**（todo 9→9，文件 9 行）
- ⚠️ 全部在内存 fixture 上执行，真实 `todo.txt` 未被创建/修改（见 R3-6 校验）

## R3-5. 观察（非缺陷，code-verified + run-asserted）

- **I4 [观察] create 澄清中输入另一条命令**：处于「是否新建」澄清时若输入 `加一条 明天 交周报`，当前实现按“未确认”**取消**并回复「没有确认，已取消创建。…」，**不解析**该新命令（该次新增被丢弃，需重输）。严重程度：低（可重输；非静默数据错误）。建议：无法匹配 是/否 时，回落到正常解析当前输入。

## R3-6. 数据完整性（第三轮结束时）

- `..\todo.txt`：**9 行**；与 `..\.qa-backup\todo.txt.orig` **逐字节一致**。
- `..\done.txt`：**2 行**；与 `..\.qa-backup\done.txt.orig` **逐字节一致**。
- `topydo ls` 正常（8 条可见，(E) 阈值未到被隐藏属预期）。
- 所有澄清闭环/新建操作仅在内存 fixture 上执行，**真实数据零写入**。

## R3-7. 本轮改动文件

- 修改：`todolist-gui/scripts/qa-chat-attack2.mjs`（C2c 改为 add 回归守卫 + 缺陷历史注释）
- 新增：`todolist-gui/scripts/qa-chat-attack3.mjs`（25→27 断言：R2-1/R2-2/已完成三分支/0命中闭环）
- 修改：`todolist-gui/package.json`（新增 `test:attack-chat3`）
- **未改动任何产品代码**

复现命令（第三轮最终）：

```bash
npm run test              # 6 files / 95 tests
npm run build             # 构建成功
npm run test:attack-chat  # 95/95
npm run test:attack-chat2 # 35/35
npm run test:attack       # 46/46（M1 回归）
npm run test:attack-chat3 # 27/27
```


